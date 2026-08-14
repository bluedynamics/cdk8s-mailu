# Backup and Restore

**How to protect your Mailu data with backups and recover from failures.**

## Problem

You need to protect email data, user accounts, configuration, and DKIM keys from hardware failures, human errors, or disasters. You also need a tested procedure to restore service after data loss.

## Solution

Implement a comprehensive backup strategy covering PostgreSQL database, PersistentVolumes (mailboxes), and Kubernetes configuration. Test restore procedures regularly to ensure backups are viable.

## What to Backup

### Critical Data (Must Backup)

| Component | Data | Backup Method | Frequency | Priority |
|-----------|------|---------------|-----------|----------|
| **PostgreSQL** | User accounts, domains, aliases | pg_dump | Daily | **Critical** |
| **Dovecot PVC** | User mailboxes (email content) | Volume snapshots | Daily | **Critical** |
| **Admin PVC** | DKIM keys, config | Volume snapshots | Weekly | **High** |
| **Rspamd PVC** | Spam learning data | Volume snapshots | Weekly | Medium |

### Optional Data (Nice to Backup)

| Component | Data | Priority |
|-----------|------|----------|
| Postfix PVC | Mail queue (temporary) | Low (self-healing) |
| ClamAV PVC | Virus signatures (re-downloadable) | Low |
| Webdav PVC | Calendars, contacts | Medium |

### Configuration (Version Control)

| Component | Backup Method |
|-----------|---------------|
| CDK8S source code | Git repository |
| Generated manifests | Git repository |
| Kubernetes secrets | Encrypted backup or external secret manager |

## Backup PostgreSQL Database

### Manual Database Backup

Create a one-time database backup:

```bash
# Dump entire database
kubectl exec -n postgres postgres-1 -- \
  pg_dump -U postgres -d mailu --clean --if-exists \
  > mailu-db-backup-$(date +%Y%m%d-%H%M%S).sql

# Compress for storage
gzip mailu-db-backup-*.sql
```

**Backup size**: Typically 1-10MB for small deployments, scales with user count.

### Automated Database Backups

Create a CronJob for daily database backups:

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: mailu-db-backup
  namespace: mailu
spec:
  schedule: "0 2 * * *"  # Daily at 2 AM
  jobTemplate:
    spec:
      template:
        spec:
          serviceAccountName: mailu-backup
          containers:
          - name: backup
            image: postgres:15
            command:
            - /bin/bash
            - -c
            - |
              set -e
              BACKUP_FILE="/backups/mailu-db-$(date +%Y%m%d-%H%M%S).sql"
              pg_dump -h postgres-rw -U mailu -d mailu --clean --if-exists > "$BACKUP_FILE"
              gzip "$BACKUP_FILE"
              echo "Backup completed: ${BACKUP_FILE}.gz"

              # Cleanup backups older than 30 days
              find /backups -name "mailu-db-*.sql.gz" -mtime +30 -delete
            env:
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: postgres-app
                  key: password
            volumeMounts:
            - name: backups
              mountPath: /backups
          volumes:
          - name: backups
            persistentVolumeClaim:
              claimName: mailu-db-backups
          restartPolicy: OnFailure
```

**Prerequisites**: Create PVC for backup storage:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mailu-db-backups
  namespace: mailu
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi  # Adjust based on retention period
  storageClassName: longhorn
```

### CloudNativePG Automated Backups

If using CloudNativePG (CNPG), configure S3 backups in the PostgreSQL cluster:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: postgres
  namespace: postgres
spec:
  instances: 3
  storage:
    size: 20Gi

  backup:
    barmanObjectStore:
      destinationPath: s3://backup-bucket/postgres-mailu/
      s3Credentials:
        accessKeyId:
          name: s3-credentials
          key: access-key
        secretAccessKey:
          name: s3-credentials
          key: secret-key
      wal:
        compression: gzip
        maxParallel: 2
    retentionPolicy: "30d"

  # Daily full backup at 2 AM
  scheduledBackup:
  - name: daily-backup
    schedule: "0 2 * * *"
    backupOwnerReference: self
    target: primary
```

**Advantages**: Point-in-time recovery (PITR), automatic WAL archiving, off-site storage.

## Backup PersistentVolumes

### Longhorn Volume Snapshots

If using Longhorn storage, create volume snapshots:

#### Manual Snapshot

```bash
# Snapshot Dovecot mailboxes
kubectl create -f - <<EOF
apiVersion: longhorn.io/v1beta2
kind: VolumeSnapshot
metadata:
  name: dovecot-snapshot-$(date +%Y%m%d)
  namespace: longhorn-system
spec:
  volume: mailu-dovecot-pvc-xxx  # Get from: kubectl get pv
EOF

# List snapshots
kubectl get volumesnapshot -n longhorn-system
```

#### Automated Recurring Snapshots

Configure Longhorn RecurringJob for automatic snapshots:

```yaml
apiVersion: longhorn.io/v1beta2
kind: RecurringJob
metadata:
  name: mailu-daily-snapshot
  namespace: longhorn-system
spec:
  cron: "0 3 * * *"  # Daily at 3 AM
  task: "snapshot"
  retain: 7  # Keep 7 daily snapshots
  concurrency: 2
  labels:
    app: mailu
```

Apply to Dovecot PVC:

```bash
# Label PVC for automatic snapshots
kubectl label pvc -n mailu mailu-dovecot-pvc recurring-job.longhorn.io/mailu-daily-snapshot=enabled
```

#### Longhorn Backup to S3

Configure Longhorn backup target for off-site backups:

```bash
# Set S3 backup target (via Longhorn UI or kubectl)
kubectl patch settings.longhorn.io -n longhorn-system backup-target --type=merge -p '{"value":"s3://backup-bucket@region/"}'

# Create backup from snapshot
kubectl create -f - <<EOF
apiVersion: longhorn.io/v1beta2
kind: Backup
metadata:
  name: dovecot-backup-$(date +%Y%m%d)
  namespace: longhorn-system
spec:
  snapshotName: dovecot-snapshot-YYYYMMDD
  labels:
    app: mailu
    component: dovecot
EOF
```

### Velero Cluster Backups

For full cluster-level backups, use [Velero](https://velero.io/):

```bash
# Install Velero with S3 backend
velero install \
  --provider aws \
  --bucket mailu-backups \
  --secret-file ./credentials-velero \
  --backup-location-config region=us-east-1

# Backup Mailu namespace
velero backup create mailu-backup-$(date +%Y%m%d) \
  --include-namespaces mailu \
  --default-volumes-to-fs-backup

# Schedule daily backups
velero schedule create mailu-daily \
  --schedule="0 2 * * *" \
  --include-namespaces mailu \
  --default-volumes-to-fs-backup \
  --ttl 720h  # 30 days retention
```

## Backup Kubernetes Secrets

**Warning**: Secrets contain sensitive data. Encrypt backups and store securely.

### Manual Secret Backup

```bash
# Export all Mailu secrets
kubectl get secrets -n mailu -o yaml > mailu-secrets-backup-$(date +%Y%m%d).yaml

# Encrypt with GPG
gpg --symmetric --cipher-algo AES256 mailu-secrets-backup-*.yaml

# Store encrypted file securely (off-site)
```

### Sealed Secrets

Use [Sealed Secrets](https://github.com/bitnami-labs/sealed-secrets) for safe secret storage in git:

```bash
# Install Sealed Secrets controller
kubectl apply -f https://github.com/bitnami-labs/sealed-secrets/releases/latest/download/controller.yaml

# Create sealed secret
kubectl create secret generic mailu-secrets \
  --from-literal=secret-key="..." \
  --dry-run=client -o yaml | \
  kubeseal -o yaml > sealed-secret-mailu.yaml

# Commit sealed secret to git (safe - encrypted)
git add sealed-secret-mailu.yaml
git commit -m "Add Mailu sealed secret"
```

## Restore Procedures

### Restore PostgreSQL Database

#### Full Database Restore

```bash
# Stop Mailu pods to prevent write conflicts
kubectl scale deployment -n mailu mailu-admin --replicas=0
kubectl scale deployment -n mailu mailu-front --replicas=0

# Drop and recreate database (CAUTION: deletes current data)
kubectl exec -n postgres postgres-1 -- psql -U postgres -c "DROP DATABASE mailu;"
kubectl exec -n postgres postgres-1 -- psql -U postgres -c "CREATE DATABASE mailu OWNER mailu;"

# Restore from backup
gunzip < mailu-db-backup-20250110.sql.gz | \
  kubectl exec -i -n postgres postgres-1 -- psql -U postgres -d mailu

# Restart Mailu pods
kubectl scale deployment -n mailu mailu-admin --replicas=1
kubectl scale deployment -n mailu mailu-front --replicas=1
```

#### CloudNativePG Point-in-Time Recovery

Restore CNPG cluster to specific timestamp:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: postgres-restored
  namespace: postgres
spec:
  instances: 3

  bootstrap:
    recovery:
      source: postgres-backup
      recoveryTarget:
        targetTime: "2025-01-10 14:00:00"  # Restore to this timestamp

  externalClusters:
  - name: postgres-backup
    barmanObjectStore:
      destinationPath: s3://backup-bucket/postgres-mailu/
      s3Credentials:
        accessKeyId:
          name: s3-credentials
          key: access-key
        secretAccessKey:
          name: s3-credentials
          key: secret-key
```

### Restore PersistentVolumes

#### Longhorn Volume Restore

Restore from Longhorn snapshot:

```bash
# Method 1: Restore from snapshot (creates new PVC)
kubectl create -f - <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mailu-dovecot-restored
  namespace: mailu
spec:
  dataSource:
    name: dovecot-snapshot-20250110
    kind: VolumeSnapshot
    apiGroup: longhorn.io
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 200Gi
  storageClassName: longhorn
EOF

# Method 2: Restore from backup (Longhorn UI)
# 1. Go to Longhorn UI → Backup
# 2. Find backup: dovecot-backup-20250110
# 3. Click "Restore" → creates new volume
# 4. Create PVC pointing to restored volume
```

Update deployment to use restored PVC:

```bash
# Edit deployment to reference new PVC
kubectl edit deployment -n mailu mailu-dovecot

# Change:
#   volumes:
#   - name: mail
#     persistentVolumeClaim:
#       claimName: mailu-dovecot-restored  # Updated
```

#### Velero Namespace Restore

Restore entire Mailu namespace from Velero backup:

```bash
# List available backups
velero backup get

# Restore from specific backup
velero restore create mailu-restore-$(date +%Y%m%d) \
  --from-backup mailu-backup-20250110

# Monitor restore progress
velero restore describe mailu-restore-YYYYMMDD
kubectl get pods -n mailu -w
```

### Restore Kubernetes Secrets

```bash
# Decrypt secret backup
gpg --decrypt mailu-secrets-backup-20250110.yaml.gpg > secrets.yaml

# Apply secrets
kubectl apply -f secrets.yaml

# Clean up decrypted file
rm secrets.yaml
```

## Disaster Recovery Scenarios

### Scenario 1: Accidental Email Deletion

**Symptoms**: User reports missing emails.

**Recovery**:
1. Restore Dovecot PVC from most recent snapshot (before deletion)
2. Mount restored volume to temporary pod
3. Extract deleted user's mailbox
4. Copy mailbox to production Dovecot pod

```bash
# Create recovery pod with restored PVC
kubectl run -n mailu dovecot-recovery \
  --image=alpine --command -- sleep infinity
kubectl set volumes pod/dovecot-recovery -n mailu \
  --add --name=mail-restored \
  --claim-name=mailu-dovecot-restored

# Copy mailbox
kubectl exec -n mailu dovecot-recovery -- \
  tar czf /tmp/user-mailbox.tar.gz /mail/user@example.com

kubectl cp -n mailu dovecot-recovery:/tmp/user-mailbox.tar.gz ./user-mailbox.tar.gz

# Extract to production pod
kubectl cp -n mailu ./user-mailbox.tar.gz mailu-dovecot-xxx:/tmp/
kubectl exec -n mailu mailu-dovecot-xxx -- \
  tar xzf /tmp/user-mailbox.tar.gz -C /
```

### Scenario 2: Database Corruption

**Symptoms**: Admin UI errors, authentication failures.

**Recovery**:
1. Stop all Mailu pods
2. Restore database from most recent backup
3. Restart Mailu pods
4. Verify user can login

*(See "Restore PostgreSQL Database" section above)*

### Scenario 3: Complete Cluster Failure

**Symptoms**: Entire cluster lost (hardware failure, cloud provider issue).

**Recovery** (assumes Velero backups to external S3):
1. Build new Kubernetes cluster
2. Install Velero
3. Restore Mailu namespace from backup
4. Update DNS to point to new cluster
5. Verify email flow

```bash
# On new cluster
velero install --provider aws --bucket mailu-backups ...

velero restore create mailu-disaster-recovery \
  --from-backup mailu-backup-20250110

kubectl get pods -n mailu -w
```

## Backup Verification

**Critical**: Test backups regularly to ensure they work!

### Monthly Backup Test Procedure

1. **Restore to test environment**:
```bash
# Create test namespace
kubectl create namespace mailu-test

# Restore from production backup
velero restore create mailu-test-restore \
  --from-backup mailu-backup-latest \
  --namespace-mappings mailu:mailu-test
```

2. **Verify data integrity**:
```bash
# Check database
kubectl exec -n mailu-test mailu-admin-xxx -- \
  python3 -c "from mailu import db; db.init_app(); print('DB OK')"

# Check mailbox
kubectl exec -n mailu-test mailu-dovecot-xxx -- \
  ls -lh /mail/
```

3. **Test functionality**:
- Login to admin UI
- Login to webmail
- Send test email
- Receive test email

4. **Document results**:
```bash
echo "Backup test $(date): PASSED" >> backup-test-log.txt
```

5. **Clean up**:
```bash
kubectl delete namespace mailu-test
```

## Backup Storage Recommendations

### 3-2-1 Backup Rule

Follow the 3-2-1 backup strategy:

- **3 copies** of data (production + 2 backups)
- **2 different media types** (local PVC + S3)
- **1 off-site copy** (different datacenter/region)

### Example Backup Architecture

```
Production Mailu
    ↓
┌─────────────────────────────────────┐
│ Primary Backups (Same Cluster)     │
│ - Longhorn snapshots (7 days)      │
│ - Database dumps on PVC             │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Secondary Backups (S3, Same Region)│
│ - Longhorn backups to S3            │
│ - CNPG WAL archives                 │
│ - Velero backups (30 days)          │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│ Tertiary Backups (S3, Other Region)│
│ - Cross-region S3 replication       │
│ - Long-term archives (1 year)       │
└─────────────────────────────────────┘
```

### Retention Policies

| Backup Type | Frequency | Retention | Storage |
|-------------|-----------|-----------|---------|
| Longhorn snapshots | Daily | 7 days | Local (Longhorn) |
| Database dumps | Daily | 30 days | PVC + S3 |
| Longhorn backups | Weekly | 90 days | S3 (same region) |
| Velero backups | Daily | 30 days | S3 (same region) |
| Long-term archives | Monthly | 1 year | S3 (cross-region) |

## Backup Monitoring

Set up alerts for backup failures:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: backup-monitoring
  namespace: monitoring
data:
  alerts.yaml: |
    groups:
    - name: mailu-backups
      rules:
      - alert: MailuBackupFailed
        expr: kube_job_status_failed{namespace="mailu", job_name=~"mailu-db-backup-.*"} > 0
        for: 10m
        annotations:
          summary: "Mailu database backup failed"
          description: "Backup job {{ $labels.job_name }} failed"

      - alert: MailuNoRecentBackup
        expr: time() - max(kube_job_completion_time{namespace="mailu", job_name=~"mailu-db-backup-.*"}) > 86400
        annotations:
          summary: "No Mailu backup in 24 hours"
```

## See Also

- [Upgrade Mailu](upgrade-mailu.md) - Always backup before upgrading
- [Component Specifications](../reference/component-specifications.md) - Storage requirements
- [Longhorn Documentation](https://longhorn.io/docs/) - Volume snapshots and backups
- [Velero Documentation](https://velero.io/docs/) - Cluster-level backups
- [CloudNativePG Documentation](https://cloudnative-pg.io/documentation/) - PostgreSQL backups
