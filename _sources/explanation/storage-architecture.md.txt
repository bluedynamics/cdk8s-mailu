# Storage Architecture

**Understanding persistent storage requirements and configuration in cdk8s-mailu deployments.**

## Introduction

cdk8s-mailu components require persistent storage for:
- **Mail data**: User mailboxes (largest storage requirement)
- **Configuration state**: DKIM keys, learned spam patterns, virus signatures
- **Operational queues**: Mail queues, temporary files
- **Application data**: Database, Roundcube attachments, calendars/contacts

This document explains what each component stores, sizing recommendations, and storage class considerations.

## Storage Components Overview

| Component | Storage Type | Purpose | Typical Size | Growth Rate |
|-----------|--------------|---------|--------------|-------------|
| **Admin** | PVC | DKIM keys, admin data | 1-5Gi | Low (static) |
| **Postfix** | PVC | Mail queue, spool files | 5-20Gi | Medium (transient) |
| **Dovecot** | PVC | User mailboxes (emails) | 50-500Gi | High (user dependent) |
| **Rspamd** | PVC | Learned spam patterns | 1-5Gi | Low (limited by bayes expiry) |
| **ClamAV** | PVC | Virus signature database | 2-5Gi | Low (signatures rotate) |
| **Webmail** | PVC | Roundcube session data | 1-5Gi | Low (session expiry) |
| **WebDAV** | PVC | Calendars and contacts | 5-50Gi | Medium (user dependent) |

**External Storage** (not in cdk8s-mailu scope):
- **PostgreSQL**: Admin database, user accounts, domains, aliases (managed separately)
- **Redis**: Caching, rate limiting state (ephemeral, can use emptyDir)

## Component Storage Details

### Admin Storage

**What is stored**:
- **DKIM private keys**: One key per domain (RSA 2048-bit, ~1.6KB each)
- **Admin instance data**: Configuration state, logs
- **SQLite database** (if not using PostgreSQL): User accounts, domains, aliases

**Size calculation**:
- 100 domains × 2KB DKIM keys = 200MB
- SQLite database (if used): 100-500MB for thousands of users
- Logs and state: 100-500MB
- **Recommended minimum**: 1Gi
- **Typical deployment**: 2-5Gi

**Growth pattern**:
- Mostly static after initial setup
- DKIM keys only added when new domains are created
- SQLite grows slowly with user/domain additions

**Access pattern**:
- Low I/O (read DKIM keys on message signing)
- Not performance-critical

**StorageClass considerations**:
- Standard HDD storage acceptable
- No need for high-IOPS SSD
- Backup recommended (losing DKIM keys breaks DKIM signatures)

### Postfix Storage

**What is stored**:
- **Mail queue**: Outgoing and deferred messages awaiting delivery
- **Spool directory**: Temporary files during message processing
- **Postfix state**: Queue manager state, TLS session cache

**Size calculation**:
- Active queue: Typically <100MB (messages deliver quickly)
- Deferred queue: Can grow to 1-10GB if remote servers are down
- **Recommended minimum**: 5Gi
- **High-volume sites**: 20Gi

**Growth pattern**:
- Highly variable (depends on delivery success rate)
- Grows when remote mail servers are unreachable
- Shrinks as deferred messages are retried and delivered
- Queue should drain to near-zero in healthy operation

**Access pattern**:
- High I/O during message processing
- Many small files (one per queued message)
- Random read/write access

**StorageClass considerations**:
- SSD recommended for high-volume sites (>10k messages/day)
- Low-latency storage improves queue processing speed
- HDD acceptable for low-volume (<1k messages/day)
- Backup not critical (queued messages are transient)

### Dovecot Storage

**What is stored**:
- **User mailboxes**: All received emails for all users
- **Mail indexes**: Dovecot index files for fast IMAP access
- **Mailbox metadata**: Folder subscriptions, flags, seen state

**Size calculation** (most critical sizing decision):
- **Per-user estimate**: 1-10GB (varies widely by usage)
- **Example**: 100 users × 5GB average = 500GB
- **Growth**: 100-500MB per user per year (typical)
- **Overhead**: Indexes add ~5-10% to mail size
- **Recommended**: Start with 2-3× current mail size for growth

**Growth pattern**:
- Continuous linear growth (users receive mail daily)
- Rate depends on user behavior and retention policies
- Can implement quota limits to control growth

**Access pattern**:
- High I/O (IMAP clients sync frequently)
- Mix of sequential (reading messages) and random (searching)
- Index files heavily accessed

**StorageClass considerations**:
- **SSD strongly recommended** (IMAP performance critical)
- High IOPS needed for responsive webmail/IMAP
- Consider tiered storage: Hot (SSD) + Cold (HDD archive)
- **Backup essential** (user mail is irreplaceable)
- Snapshots recommended for quick recovery

**Special considerations**:
- **Largest storage consumer** in Mailu deployment
- Plan for 3-5 year growth horizon
- Monitor closely and expand proactively
- Consider retention policies to limit growth

### Rspamd Storage

**What is stored**:
- **Bayes spam classifier**: Learned tokens from spam/ham training
- **Fuzzy hashes**: Spam signatures for fuzzy matching
- **Statistics**: Spam detection statistics and metadata

**Size calculation**:
- Bayes database: 500MB - 2GB (depends on training corpus)
- Fuzzy storage: 100-500MB
- Statistics and logs: 100-500MB
- **Recommended minimum**: 2Gi
- **Typical deployment**: 5Gi

**Growth pattern**:
- Grows initially as spam/ham is learned
- Stabilizes after training (bayes token expiry limits size)
- Old tokens are expired automatically (typically 30-90 days)

**Access pattern**:
- High read I/O during spam scanning
- Low write I/O (only on learning/updates)
- Sequential reads (token lookups)

**StorageClass considerations**:
- SSD beneficial but not critical
- Fast reads improve spam scanning speed
- HDD acceptable for low-volume sites
- Backup recommended (losing training means relearning)

### ClamAV Storage (Optional Component)

**What is stored**:
- **Virus signature database**: ClamAV definitions (updated daily)
- **Temporary scan files**: Extracted attachments during scanning

**Size calculation**:
- Signature database: 1-3GB (compressed)
- Temporary files: 100-500MB (transient)
- **Recommended minimum**: 3Gi
- **Typical deployment**: 5Gi

**Growth pattern**:
- Signature database grows slowly (~100MB/year)
- Daily updates replace old signatures
- Size relatively stable

**Access pattern**:
- High read I/O during virus scanning
- Sequential reads (scanning attachments)
- Daily write for signature updates

**StorageClass considerations**:
- SSD improves scan speed (reduces mail delay)
- HDD acceptable for small deployments
- Backup not critical (signatures can be re-downloaded)

### Webmail Storage (Optional Component)

**What is stored**:
- **Roundcube database** (if not using PostgreSQL): Sessions, preferences, cache
- **Temporary files**: Attachment uploads during composition
- **Session data**: Active user sessions

**Size calculation**:
- SQLite database: 100-500MB
- Session data: 100MB per 1000 concurrent users
- Temporary files: 100-500MB
- **Recommended minimum**: 2Gi
- **Typical deployment**: 5Gi

**Growth pattern**:
- Grows with number of active sessions
- Session data expires (typically 24-72 hours)
- Size relatively stable after initial growth

**Access pattern**:
- Medium I/O (session reads/writes)
- Random access (session lookups)

**StorageClass considerations**:
- SSD improves webmail responsiveness
- HDD acceptable for low-concurrency (<100 users)
- Backup not critical (sessions are transient)

### WebDAV Storage (Optional Component)

**What is stored**:
- **CalDAV data**: User calendars, events, todos
- **CardDAV data**: Contact books, vcards
- **Radicale database**: Collection metadata, sync tokens

**Size calculation**:
- Per-user estimate: 10-100MB (calendars + contacts)
- **Example**: 100 users × 50MB = 5GB
- **Recommended minimum**: 5Gi
- **Typical deployment**: 10-50Gi

**Growth pattern**:
- Grows with user calendar/contact data
- Slower than email growth (calendars are smaller)
- Historical events accumulate over time

**Access pattern**:
- Low-medium I/O (sync on schedule changes)
- Random access (event lookups)

**StorageClass considerations**:
- HDD acceptable (CalDAV/CardDAV not latency-sensitive)
- SSD beneficial for large deployments (>500 users)
- **Backup recommended** (user data is valuable)

## Configuration in cdk8s-mailu

### Storage Configuration Interface

Storage is configured in the `MailuChartConfig.storage` section:

```typescript
import { MailuChart } from '@example/cdk8s-mailu';

new MailuChart(app, 'mailu', {
  // ... other config
  storage: {
    // Global default storage class
    storageClass: 'longhorn',

    // Per-component overrides
    admin: {
      size: '2Gi',
      storageClass: 'longhorn',  // Optional override
    },
    postfix: {
      size: '10Gi',
    },
    dovecot: {
      size: '200Gi',  // Largest allocation
      storageClass: 'longhorn-ssd',  // Use faster storage
    },
    rspamd: {
      size: '5Gi',
    },

    // Optional components (only used if enabled)
    clamav: {
      size: '5Gi',
    },
    webmail: {
      size: '3Gi',
    },
    webdav: {
      size: '20Gi',
    },
  },
});
```

### Storage Class Selection

**Global default** (`storage.storageClass`):
- Applied to all components unless overridden
- Example: `'longhorn'`, `'standard'`, `'gp2'`

**Per-component override** (`storage.dovecot.storageClass`):
- Useful for tiered storage (SSD for Dovecot, HDD for others)
- Example: High-performance SSD for Dovecot, standard HDD for Admin

**Example tiered storage**:
```typescript
storage: {
  storageClass: 'longhorn',  // Default: Standard HDD

  dovecot: {
    size: '500Gi',
    storageClass: 'longhorn-ssd',  // Override: Fast SSD
  },
  postfix: {
    size: '20Gi',
    storageClass: 'longhorn-ssd',  // Override: Fast SSD
  },

  // Other components use default 'longhorn' HDD
  admin: { size: '2Gi' },
  rspamd: { size: '5Gi' },
}
```

### Default Sizes (if not specified)

cdk8s-mailu uses these defaults when storage size is not configured:

- Admin: `1Gi`
- Postfix: `10Gi`
- Dovecot: `50Gi` (⚠️ likely too small for production)
- Rspamd: `2Gi`
- ClamAV: `3Gi`
- Webmail: `2Gi`
- WebDAV: `5Gi`

**Recommendation**: Always explicitly set storage sizes (don't rely on defaults).

## Sizing Recommendations by Deployment Size

### Small Deployment (1-50 users)

```typescript
storage: {
  storageClass: 'standard',
  admin: { size: '2Gi' },
  postfix: { size: '5Gi' },
  dovecot: { size: '50Gi' },      // 1GB per user
  rspamd: { size: '2Gi' },
  webmail: { size: '2Gi' },
  webdav: { size: '5Gi' },
}
```

**Total**: ~66Gi

### Medium Deployment (50-500 users)

```typescript
storage: {
  storageClass: 'longhorn',
  admin: { size: '5Gi' },
  postfix: { size: '10Gi' },
  dovecot: { size: '250Gi', storageClass: 'longhorn-ssd' },  // 500MB per user
  rspamd: { size: '5Gi' },
  clamav: { size: '5Gi' },
  webmail: { size: '5Gi' },
  webdav: { size: '25Gi' },
}
```

**Total**: ~305Gi (250Gi SSD, 55Gi HDD)

### Large Deployment (500-5000 users)

```typescript
storage: {
  storageClass: 'longhorn',
  admin: { size: '10Gi' },
  postfix: { size: '50Gi', storageClass: 'longhorn-ssd' },
  dovecot: { size: '2000Gi', storageClass: 'longhorn-ssd' },  // 400MB per user
  rspamd: { size: '10Gi' },
  clamav: { size: '5Gi' },
  webmail: { size: '10Gi' },
  webdav: { size: '100Gi' },
}
```

**Total**: ~2185Gi (2050Gi SSD, 135Gi HDD)

## Storage Best Practices

### 1. Plan for Growth

- **Dovecot**: Allocate 2-3× current mail size
- **Postfix**: Size for 3-7 days of deferred queue
- **Monitor usage**: Set alerts at 70% capacity
- **Expand proactively**: Before hitting 85% full

### 2. Use Appropriate Storage Classes

- **Critical performance**: Dovecot, Postfix → SSD
- **Moderate performance**: Rspamd, ClamAV → SSD or fast HDD
- **Low performance**: Admin, Webmail, WebDAV → HDD

### 3. Implement Backup Strategy

**Essential backups**:
- Dovecot mailboxes (user mail data)
- Admin DKIM keys
- WebDAV calendars/contacts

**Nice-to-have backups**:
- Rspamd learned patterns
- PostgreSQL database

**Not needed**:
- Postfix queue (transient)
- ClamAV signatures (can re-download)
- Webmail sessions (ephemeral)

### 4. Retention Policies

Implement policies to control growth:
- **User quotas**: Limit per-user mailbox size
- **Auto-expunge**: Delete trash/spam after 30 days
- **Archive policies**: Move old mail to cheaper storage tiers

### 5. Monitoring and Alerts

Monitor these metrics:
- PVC usage percentage (alert at 70%)
- Growth rate (predict when expansion needed)
- IOPS saturation (indicates need for faster storage)

```bash
# Check PVC usage
kubectl get pvc -n mailu
kubectl exec -n mailu <dovecot-pod> -- df -h /mail

# Monitor IOPS (if storage supports metrics)
kubectl top pod -n mailu --containers
```

## Troubleshooting

### PVC Full (Out of Space)

**Symptoms**:
- Mail delivery failures
- Dovecot errors: "Not enough disk space"
- Postfix queue buildup

**Immediate fix**:
1. Identify full PVC:
   ```bash
   kubectl exec -n mailu <pod> -- df -h
   ```
2. Clean temporary files:
   ```bash
   # Postfix queue
   kubectl exec -n mailu <postfix-pod> -- postqueue -p | grep -c "^[A-F0-9]"

   # Dovecot indexes (can regenerate)
   kubectl exec -n mailu <dovecot-pod> -- rm -rf /mail/*/dovecot.index*
   ```
3. Expand PVC (if storage class supports it):
   ```bash
   kubectl patch pvc dovecot-pvc -n mailu -p '{"spec":{"resources":{"requests":{"storage":"300Gi"}}}}'
   ```

**Long-term fix**:
- Implement user quotas
- Enable auto-expunge policies
- Plan capacity expansion

### Slow Mail Access (Performance Issues)

**Symptoms**:
- Slow IMAP sync
- Webmail timeouts
- Message delivery delays

**Check**:
1. Verify storage class performance:
   ```bash
   kubectl get pvc -n mailu -o jsonpath='{.items[*].spec.storageClassName}'
   ```
2. Check IOPS limits (cloud providers):
   - AWS EBS: Throughput based on volume size
   - Azure Disk: IOPS tier selection
3. Monitor pod I/O wait:
   ```bash
   kubectl exec -n mailu <dovecot-pod> -- iostat -x 1 10
   ```

**Fix**:
- Migrate to faster storage class (SSD)
- Increase PVC size (some classes scale IOPS with size)
- Optimize Dovecot indexes (rebuild corrupted indexes)

### PVC Not Binding

**Symptoms**: Pod stuck in Pending, PVC shows "Pending"

**Check**:
1. Verify storage class exists:
   ```bash
   kubectl get storageclass
   ```
2. Check provisioner logs:
   ```bash
   kubectl logs -n kube-system -l app=<provisioner-name>
   ```
3. Verify node resources (some storage requires specific node features)

**Fix**:
- Correct storage class name typo
- Install storage provisioner if missing
- Check node selectors/taints

## See Also

- [Configuration Options Reference](../reference/configuration-options.md) - Complete storage config API
- [Architecture Overview](architecture.md) - How components interact
- [Backup and Restore](../how-to/backup-restore.md) - Backup procedures
- [Monitoring](../how-to/monitoring.md) - Storage metrics and alerts
