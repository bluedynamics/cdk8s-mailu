# Scale Resources

**How to adjust CPU and memory resources for Mailu components.**

## Problem

You need to increase or decrease resource requests and limits for Mailu components based on your workload, user count, or cluster capacity.

## Solution

The `MailuChart` accepts a `resources` configuration object that allows you to customize CPU and memory for each component. If not specified, components use sensible defaults from the component specifications.

## Understanding Resource Configuration

**Resource Requests**: Guaranteed resources allocated to the pod. Used for scheduling decisions.

**Resource Limits**: Maximum resources the pod can use. Prevents runaway resource consumption.

**Best Practice**: Set requests to typical usage and limits to 2-3x requests to allow bursting.

## Scale a Single Component

Adjust resources for a specific component (e.g., Dovecot for high IMAP load):

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

  resources: {
    dovecot: {
      requests: {
        cpu: '500m',      // Increased from default 200m
        memory: '2Gi',    // Increased from default 1Gi
      },
      limits: {
        cpu: '2000m',     // 4x request
        memory: '4Gi',    // 2x request
      },
    },
  },
});

app.synth();
```

## Scale Multiple Components

Adjust resources for all heavy components in a high-load deployment:

```typescript
resources: {
  // Front (Nginx) - handles all incoming connections
  front: {
    requests: { cpu: '200m', memory: '512Mi' },
    limits: { cpu: '1000m', memory: '1Gi' },
  },

  // Dovecot - memory-intensive for IMAP
  dovecot: {
    requests: { cpu: '500m', memory: '2Gi' },
    limits: { cpu: '2000m', memory: '4Gi' },
  },

  // Postfix - CPU-intensive for SMTP
  postfix: {
    requests: { cpu: '300m', memory: '1Gi' },
    limits: { cpu: '1000m', memory: '2Gi' },
  },

  // Rspamd - spam filtering
  rspamd: {
    requests: { cpu: '200m', memory: '1Gi' },
    limits: { cpu: '1000m', memory: '2Gi' },
  },

  // Admin - lightweight
  admin: {
    requests: { cpu: '100m', memory: '256Mi' },
    limits: { cpu: '500m', memory: '512Mi' },
  },
},
```

## Component-Specific Scaling Guidelines

### Dovecot (IMAP/POP3)

**Memory-intensive** - scales with concurrent user connections and mailbox operations.

**Small deployment** (< 50 users):
```typescript
dovecot: {
  requests: { cpu: '200m', memory: '1Gi' },
  limits: { cpu: '1000m', memory: '2Gi' },
}
```

**Medium deployment** (50-500 users):
```typescript
dovecot: {
  requests: { cpu: '500m', memory: '2Gi' },
  limits: { cpu: '2000m', memory: '4Gi' },
}
```

**Large deployment** (500+ users):
```typescript
dovecot: {
  requests: { cpu: '1000m', memory: '4Gi' },
  limits: { cpu: '4000m', memory: '8Gi' },
}
```

### ClamAV (Antivirus)

**Very resource-intensive** - requires significant memory for virus signature database.

**Only if needed** (add to resources config):
```typescript
clamav: {
  requests: { cpu: '1000m', memory: '2Gi' },
  limits: { cpu: '4000m', memory: '4Gi' },
}
```

**Note**: ClamAV startup takes 5-10 minutes to download virus signatures. Consider if antivirus scanning is truly required for your use case.

### Postfix (SMTP)

**CPU-intensive** - scales with email throughput.

**High-volume mail server**:
```typescript
postfix: {
  requests: { cpu: '500m', memory: '1Gi' },
  limits: { cpu: '2000m', memory: '2Gi' },
}
```

### Rspamd (Spam Filter)

**Balanced workload** - CPU for filtering, memory for Bayes database.

**High spam volume**:
```typescript
rspamd: {
  requests: { cpu: '300m', memory: '1Gi' },
  limits: { cpu: '1500m', memory: '2Gi' },
}
```

## Apply Changes

After modifying resource configuration:

```bash
# Regenerate manifests
npm run synth

# Apply updated configuration
kubectl apply -f dist/mailu.k8s.yaml

# Watch pod restarts
kubectl get pods -n mailu -w
```

**Note**: Changing resource requests may cause pods to be rescheduled to different nodes with sufficient capacity.

## Verify Resource Usage

Check actual resource consumption to inform scaling decisions:

```bash
# Current resource usage
kubectl top pods -n mailu

# Per-component usage (sorted by memory)
kubectl top pods -n mailu --sort-by=memory

# Per-component usage (sorted by CPU)
kubectl top pods -n mailu --sort-by=cpu
```

**Recommended monitoring period**: Monitor for 24-48 hours covering peak usage times before adjusting resources.

## Troubleshooting

### Pod stuck in Pending state

**Symptom**: Pod shows `Pending` status with event "Insufficient memory" or "Insufficient cpu".

**Solution**: Either reduce resource requests or add more node capacity to the cluster.

```bash
# Check pod events
kubectl describe pod -n mailu <pod-name> | grep -A 10 Events
```

### OOMKilled pods

**Symptom**: Pod restarts with exit code 137, events show "OOMKilled".

**Solution**: Increase memory limits for the affected component.

```bash
# Check recent pod restarts
kubectl get pods -n mailu
kubectl describe pod -n mailu <pod-name> | grep -A 5 "Last State"
```

### CPU Throttling

**Symptom**: Application performance degraded, `kubectl top` shows CPU at limit.

**Solution**: Increase CPU limits to allow more bursting.

```bash
# Check if pod is hitting CPU limits
kubectl top pods -n mailu | grep <component-name>
```

## See Also

- [Component Specifications](../reference/component-specifications.md) - Default resource allocations
- [Customize Storage](customize-storage.md) - Adjust PVC sizes
- [Enable Optional Components](enable-optional-components.md) - Add/remove components
