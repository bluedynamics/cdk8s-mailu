# Customize Storage

**How to adjust PersistentVolumeClaim sizes and storage classes for Mailu components.**

## Problem

You need to customize storage sizes for mailboxes, queues, and other persistent data based on your expected user count, email volume, or available storage classes.

## Solution

The `MailuChart` accepts a `storage` configuration object that controls PVC sizes and storage classes for each component. Configure a global storage class and override sizes per component.

## Understanding Storage Requirements

Different Mailu components have different storage needs:

| Component | Purpose | Typical Size | Growth Rate |
|-----------|---------|--------------|-------------|
| **Dovecot** | User mailboxes (largest) | 50-500Gi | 1-5GB per active user |
| **Postfix** | Mail queue | 5-10Gi | Temporary, self-cleaning |
| **Rspamd** | Spam learning data | 5Gi | Slow growth |
| **Admin** | DKIM keys, config | 5Gi | Minimal growth |
| **ClamAV** | Virus signatures | 5Gi | Periodic updates |
| **Webdav** | Calendars, contacts | 5-20Gi | 50-200MB per user |

## Set Global Storage Class

Configure a default storage class for all components:

```typescript
import { App } from 'cdk8s';
import { MailuChart } from 'cdk8s-mailu';

const app = new App();

new MailuChart(app, 'mailu', {
  namespace: 'mailu',
  domain: 'example.com',
  hostnames: ['mail.example.com'],
  subnet: '10.42.0.0/16',

  // ... other config ...

  storage: {
    storageClass: 'longhorn',  // Applied to all components
  },
});

app.synth();
```

**Common storage classes**:
- `longhorn` - Longhorn distributed storage (recommended for production)
- `local-path` - K3s default local storage (testing only)
- `standard` - Cloud provider default
- `gp2`, `gp3` - AWS EBS
- `pd-standard`, `pd-ssd` - GCP Persistent Disk

## Customize Component Storage Sizes

### Small Deployment (< 50 users)

Minimal storage footprint for personal or small team use:

```typescript
storage: {
  storageClass: 'longhorn',

  admin: { size: '5Gi' },      // Default
  postfix: { size: '5Gi' },    // Default
  dovecot: { size: '50Gi' },   // ~1GB per user
  rspamd: { size: '5Gi' },     // Default
},
```

### Medium Deployment (50-500 users)

Scale mailbox storage for more users:

```typescript
storage: {
  storageClass: 'longhorn',

  admin: { size: '5Gi' },
  postfix: { size: '10Gi' },    // Larger queue for volume
  dovecot: { size: '200Gi' },   // ~4GB per user average
  rspamd: { size: '10Gi' },     // More spam learning data
},
```

### Large Deployment (500+ users)

Production-scale storage with capacity planning:

```typescript
storage: {
  storageClass: 'longhorn',

  admin: { size: '10Gi' },
  postfix: { size: '20Gi' },
  dovecot: { size: '1000Gi' },  // Plan for 2GB per user
  rspamd: { size: '20Gi' },
},
```

## Override Storage Class Per Component

Use different storage classes for different performance tiers:

```typescript
storage: {
  // Default storage class (standard tier)
  storageClass: 'longhorn',

  // High-performance storage for mailboxes (SSD-backed)
  dovecot: {
    size: '200Gi',
    storageClass: 'longhorn-fast',  // Override with faster class
  },

  // Standard storage for queues and caches
  postfix: { size: '10Gi' },  // Uses default 'longhorn'
  rspamd: { size: '10Gi' },   // Uses default 'longhorn'
},
```

**Use cases for per-component storage classes**:
- Fast SSDs for Dovecot mailboxes (high IOPS)
- Standard disks for Postfix queue (temporary data)
- Cheaper storage for backups

## Enable Optional Component Storage

When enabling optional components, configure their storage:

```typescript
components: {
  clamav: true,
  webdav: true,
},

storage: {
  storageClass: 'longhorn',

  // Required for enabled optional components
  clamav: { size: '10Gi' },  // Virus signature database
  webdav: { size: '20Gi' },  // Calendars and contacts
},
```

## Expand Existing PVCs

**Important**: PVC sizes can be increased but **never decreased**. Shrinking requires deleting and recreating the PVC (data loss).

### Step 1: Update configuration

Increase the size in your CDK8S configuration:

```typescript
storage: {
  storageClass: 'longhorn',
  dovecot: { size: '500Gi' },  // Increased from 200Gi
},
```

### Step 2: Regenerate and apply

```bash
# Regenerate manifests with new size
npm run synth

# Apply changes
kubectl apply -f dist/mailu.k8s.yaml
```

### Step 3: Verify expansion

```bash
# Check PVC status
kubectl get pvc -n mailu

# Verify new size (should show RESIZING or new size)
kubectl describe pvc -n mailu mailu-dovecot-pvc
```

**Note**: The storage class must support volume expansion (`allowVolumeExpansion: true`). Check with:

```bash
kubectl get storageclass <storage-class-name> -o yaml | grep allowVolumeExpansion
```

## Storage Performance Optimization

### Longhorn Replica Configuration

For Longhorn storage, consider replica settings based on data criticality:

**High availability** (mailboxes):
- 3 replicas across nodes
- Use `longhorn` storage class with 2-3 replicas

**Standard reliability** (queues, caches):
- 2 replicas
- Use default `longhorn` storage class

**Single replica** (temporary data):
- 1 replica
- Lower storage overhead
- Not recommended for mailboxes

**Note**: Replica configuration is set at the storage class level, not per-PVC.

### Monitor Storage Usage

Track storage consumption to plan capacity:

```bash
# Check PVC usage
kubectl get pvc -n mailu

# Detailed usage per pod
kubectl exec -n mailu <dovecot-pod-name> -- df -h /mail

# Check available capacity on nodes (Longhorn)
kubectl get nodes.longhorn.io -n longhorn-system
```

Set up monitoring alerts at 70% and 85% capacity thresholds.

## Troubleshooting

### PVC stuck in Pending

**Symptom**: PVC shows `Pending` status, pod cannot start.

**Solution**: Check storage class exists and has available capacity.

```bash
# Check PVC status
kubectl describe pvc -n mailu <pvc-name>

# Check storage class
kubectl get storageclass

# Check node storage capacity (Longhorn)
kubectl get nodes.longhorn.io -n longhorn-system
```

### PVC expansion not working

**Symptom**: PVC size unchanged after applying new configuration.

**Solution**: Verify storage class supports expansion:

```bash
# Check storage class expansion support
kubectl get storageclass <storage-class-name> -o jsonpath='{.allowVolumeExpansion}'

# If false, expansion is not supported
# Alternative: Create new PVC with larger size and migrate data
```

### Out of storage space

**Symptom**: Pods show disk pressure, writes failing.

**Immediate fix**: Increase PVC size (see expansion section above).

**Long-term**:
- Set up storage monitoring and alerting
- Review mailbox quotas in Mailu admin UI
- Enable email compression in Dovecot
- Implement email retention policies

## Estimate Storage Requirements

### Calculating Dovecot mailbox storage

**Formula**: `Total Storage = (Active Users × Average MB per User × Growth Factor) + Buffer`

**Example** (100 users):
```
Active users: 100
Average per user: 3GB (typical)
Growth factor: 1.5 (50% growth over 2 years)
Buffer: 20% (for spikes)

Calculation: (100 × 3GB × 1.5) + 20% = 450GB × 1.2 = 540GB
Recommended: 600Gi PVC
```

### Monitoring actual usage

Deploy with initial estimates, then adjust based on actual usage:

```bash
# Check current mailbox usage
kubectl exec -n mailu <dovecot-pod> -- du -sh /mail

# Per-user breakdown (if accessible)
kubectl exec -n mailu <dovecot-pod> -- du -sh /mail/*
```

## See Also

- [Component Specifications](../reference/component-specifications.md) - Default storage sizes
- [Scale Resources](scale-resources.md) - Adjust CPU/memory
- [Enable Optional Components](enable-optional-components.md) - Add components requiring storage
