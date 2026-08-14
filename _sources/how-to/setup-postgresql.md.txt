# Setup PostgreSQL Database

**How to deploy PostgreSQL for Mailu using either a simple Helm chart or production-grade CloudNativePG.**

## Problem

Mailu requires a PostgreSQL database for storing user accounts, domains, aliases, and configuration. You need to deploy PostgreSQL before deploying Mailu.

## Solution Options

Choose the approach that matches your needs:

| Approach | Use Case | HA | Backups | Complexity |
|----------|----------|----|---------| -----------|
| **Bitnami PostgreSQL** | Development, testing, small deployments | Optional | Manual | Low |
| **CloudNativePG (CNPG)** | Production, HA required | Built-in | Automatic | Medium |

## Option 1: Bitnami PostgreSQL (Simple)

### Prerequisites

- Helm 3 installed
- Kubernetes cluster with persistent storage

### Step 1: Add Bitnami Helm Repository

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

### Step 2: Create Values File

Create `postgres-values.yaml`:

```yaml
# Bitnami PostgreSQL configuration for Mailu

auth:
  database: mailu
  username: mailu
  password: "CHANGE_ME_SECURE_PASSWORD"  # Change this!
  postgresPassword: "CHANGE_ME_ADMIN_PASSWORD"  # Change this!

primary:
  persistence:
    enabled: true
    size: 20Gi
    storageClass: longhorn  # Your storage class

  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 1Gi

  # Optional: Configure backups
  # initdb:
  #   scripts:
  #     setup_backup.sh: |
  #       #!/bin/bash
  #       # Backup configuration here

metrics:
  enabled: true
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
```

**Security note**: Generate secure passwords:
```bash
# Generate random passwords
MAILU_DB_PASSWORD=$(openssl rand -base64 32)
POSTGRES_ADMIN_PASSWORD=$(openssl rand -base64 32)

echo "Mailu DB password: $MAILU_DB_PASSWORD"
echo "PostgreSQL admin password: $POSTGRES_ADMIN_PASSWORD"

# Update values file with these passwords
```

### Step 3: Install PostgreSQL

```bash
# Create namespace
kubectl create namespace postgres

# Install PostgreSQL
helm install postgres bitnami/postgresql \
  --namespace postgres \
  --values postgres-values.yaml

# Wait for pod to be ready
kubectl wait --for=condition=ready pod -n postgres -l app.kubernetes.io/name=postgresql --timeout=300s
```

### Step 4: Verify Installation

```bash
# Check pod status
kubectl get pods -n postgres

# Test database connection
kubectl exec -n postgres postgres-postgresql-0 -- \
  psql -U mailu -d mailu -c "SELECT version();"
```

### Step 5: Get Connection Details

```bash
# Get service name (for Mailu configuration)
kubectl get svc -n postgres

# Service name will be: postgres-postgresql
# Connection string: postgres-postgresql.postgres.svc.cluster.local:5432
```

### Step 6: Create Kubernetes Secret for Mailu

```bash
# Create secret with database credentials
kubectl create secret generic postgres-credentials \
  --namespace=mailu \
  --from-literal=username="mailu" \
  --from-literal=password="$MAILU_DB_PASSWORD"
```

### Configure Mailu to Use This Database

In your CDK8S `MailuChart` configuration:

```typescript
database: {
  type: 'postgresql',
  postgresql: {
    host: 'postgres-postgresql.postgres.svc.cluster.local',
    port: 5432,
    database: 'mailu',
    secretName: 'postgres-credentials',
    secretKeys: {
      username: 'username',
      password: 'password',
    },
  },
}
```

---

## Option 2: CloudNativePG (Production)

### Prerequisites

- CloudNativePG operator installed
- S3-compatible storage for backups (optional but recommended)
- Kubernetes cluster with persistent storage

### Step 1: Install CloudNativePG Operator

```bash
# Add CNPG Helm repository
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update

# Install operator
helm install cnpg-operator cnpg/cloudnative-pg \
  --namespace cnpg-system \
  --create-namespace

# Verify operator is running
kubectl get pods -n cnpg-system
```

### Step 2: Create PostgreSQL Cluster

Create `postgres-cluster.yaml`:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: postgres
  namespace: postgres
spec:
  instances: 3  # High availability with 3 replicas

  postgresql:
    parameters:
      max_connections: "200"
      shared_buffers: "256MB"
      effective_cache_size: "1GB"
      maintenance_work_mem: "64MB"
      checkpoint_completion_target: "0.9"
      wal_buffers: "16MB"
      default_statistics_target: "100"
      random_page_cost: "1.1"
      effective_io_concurrency: "200"

  bootstrap:
    initdb:
      database: mailu
      owner: mailu
      secret:
        name: postgres-app

  storage:
    size: 20Gi
    storageClass: longhorn

  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 1Gi

  # Monitoring
  monitoring:
    enablePodMonitor: true

  # Connection pooler (recommended)
  enableSuperuserAccess: true

  # Automatic backup to S3 (optional but recommended)
  # backup:
  #   barmanObjectStore:
  #     destinationPath: s3://backup-bucket/postgres-mailu/
  #     endpointURL: https://s3.your-region.amazonaws.com
  #     s3Credentials:
  #       accessKeyId:
  #         name: s3-credentials
  #         key: access-key-id
  #       secretAccessKey:
  #         name: s3-credentials
  #         key: secret-access-key
  #     wal:
  #       compression: gzip
  #   retentionPolicy: "30d"

---
apiVersion: v1
kind: Secret
metadata:
  name: postgres-app
  namespace: postgres
type: kubernetes.io/basic-auth
stringData:
  username: mailu
  password: "CHANGE_ME_SECURE_PASSWORD"  # Change this!
```

**Generate secure password**:
```bash
MAILU_DB_PASSWORD=$(openssl rand -base64 32)
echo "Mailu DB password: $MAILU_DB_PASSWORD"

# Update password in postgres-cluster.yaml
```

### Step 3: Create Connection Pooler (Recommended)

Create `postgres-pooler.yaml`:

```yaml
apiVersion: postgresql.cnpg.io/v1
kind: Pooler
metadata:
  name: postgres-pooler
  namespace: postgres
spec:
  cluster:
    name: postgres

  instances: 2  # Multiple pooler instances for HA
  type: rw  # Read-write pooler

  pgbouncer:
    poolMode: session
    parameters:
      max_client_conn: "1000"
      default_pool_size: "25"

  template:
    metadata:
      labels:
        app: postgres-pooler
    spec:
      containers:
      - name: pgbouncer
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 128Mi
```

### Step 4: Deploy PostgreSQL

```bash
# Create namespace
kubectl create namespace postgres

# Apply cluster configuration
kubectl apply -f postgres-cluster.yaml

# Wait for cluster to be ready (may take 2-3 minutes)
kubectl wait --for=condition=Ready cluster -n postgres postgres --timeout=600s

# Apply pooler (optional but recommended)
kubectl apply -f postgres-pooler.yaml

# Verify cluster status
kubectl get cluster -n postgres
kubectl get pods -n postgres
```

### Step 5: Verify Installation

```bash
# Check cluster status
kubectl describe cluster -n postgres postgres

# Test database connection (via pooler)
kubectl exec -n postgres postgres-1 -- \
  psql -U mailu -d mailu -c "SELECT version();"

# Check replication status
kubectl exec -n postgres postgres-1 -- \
  psql -U postgres -c "SELECT * FROM pg_stat_replication;"
```

### Step 6: Get Connection Details

```bash
# List services
kubectl get svc -n postgres

# Services available:
# - postgres-rw (read-write service, direct to primary)
# - postgres-r (read-only service, load balanced across replicas)
# - postgres-pooler (connection pooler, recommended)

# Use pooler for best performance and connection management
```

### Configure Mailu to Use CNPG

In your CDK8S `MailuChart` configuration:

```typescript
database: {
  type: 'postgresql',
  postgresql: {
    host: 'postgres-pooler',  // Use pooler service
    // or: host: 'postgres-rw',  // Direct to primary
    port: 5432,
    database: 'mailu',
    secretName: 'postgres-app',  // CNPG auto-generated secret
    secretKeys: {
      username: 'username',
      password: 'password',
    },
  },
}
```

**Note**: CNPG automatically creates the `postgres-app` secret. You can reference it directly in Mailu configuration.

---

## Configure Automatic Backups (CNPG Only)

### Prerequisites for S3 Backups

Create S3 credentials secret:

```bash
kubectl create secret generic s3-credentials \
  --namespace=postgres \
  --from-literal=access-key-id="YOUR_S3_ACCESS_KEY" \
  --from-literal=secret-access-key="YOUR_S3_SECRET_KEY"
```

### Enable Scheduled Backups

Add to `postgres-cluster.yaml`:

```yaml
spec:
  # ... existing spec ...

  backup:
    barmanObjectStore:
      destinationPath: s3://backup-bucket/postgres-mailu/
      endpointURL: https://s3.your-region.amazonaws.com
      s3Credentials:
        accessKeyId:
          name: s3-credentials
          key: access-key-id
        secretAccessKey:
          name: s3-credentials
          key: secret-access-key
      wal:
        compression: gzip
        maxParallel: 2
    retentionPolicy: "30d"

  # Schedule daily backups at 2 AM
  scheduledBackup:
  - name: daily-backup
    schedule: "0 2 * * *"
    backupOwnerReference: self
```

Apply changes:
```bash
kubectl apply -f postgres-cluster.yaml

# Trigger manual backup to test
kubectl cnpg backup postgres -n postgres
```

---

## Comparison: Bitnami vs CNPG

### Bitnami PostgreSQL

**Pros**:
- ✅ Simple setup with Helm
- ✅ Familiar Helm chart configuration
- ✅ Quick deployment (< 2 minutes)
- ✅ Good for development/testing

**Cons**:
- ❌ No built-in HA (single instance by default)
- ❌ Manual backup configuration
- ❌ Limited automation
- ❌ No connection pooling

**Best for**: Development, testing, small deployments, learning

### CloudNativePG

**Pros**:
- ✅ Native Kubernetes operator
- ✅ Built-in HA (3 replicas)
- ✅ Automatic failover
- ✅ Continuous backup to S3
- ✅ Point-in-time recovery (PITR)
- ✅ Connection pooling (PgBouncer)
- ✅ Rolling updates
- ✅ Declarative configuration

**Cons**:
- ❌ More complex setup
- ❌ Requires operator installation
- ❌ Longer initial deployment time
- ❌ More moving parts to understand

**Best for**: Production, HA requirements, large deployments, critical workloads

---

## Troubleshooting

### Bitnami PostgreSQL Issues

**Pod not starting**:
```bash
# Check pod status
kubectl describe pod -n postgres postgres-postgresql-0

# Check logs
kubectl logs -n postgres postgres-postgresql-0

# Common causes:
# - PVC not bound (storage class issue)
# - Resource limits too low
# - Init scripts failing
```

**Cannot connect to database**:
```bash
# Verify service exists
kubectl get svc -n postgres postgres-postgresql

# Test connection from pod
kubectl run -it --rm debug --image=postgres:15 --restart=Never -- \
  psql -h postgres-postgresql.postgres.svc.cluster.local -U mailu -d mailu

# Check password is correct
kubectl get secret -n postgres postgres-postgresql -o jsonpath='{.data.password}' | base64 -d
```

### CloudNativePG Issues

**Cluster not becoming ready**:
```bash
# Check cluster status
kubectl describe cluster -n postgres postgres

# Check operator logs
kubectl logs -n cnpg-system -l app.kubernetes.io/name=cloudnative-pg

# Check pod logs
kubectl logs -n postgres postgres-1
```

**Backup failing**:
```bash
# Check backup status
kubectl get backup -n postgres

# Check S3 credentials
kubectl get secret -n postgres s3-credentials -o yaml

# Test S3 connectivity
kubectl exec -n postgres postgres-1 -- \
  barman-cloud-wal-archive --test s3://backup-bucket/postgres-mailu/
```

**Pooler connection issues**:
```bash
# Check pooler status
kubectl get pooler -n postgres
kubectl logs -n postgres -l app=postgres-pooler

# Test direct connection (bypass pooler)
kubectl exec -n postgres postgres-1 -- \
  psql -U mailu -d mailu -c "SELECT 1;"
```

---

## Monitoring and Maintenance

### Check Database Size

```bash
# Bitnami
kubectl exec -n postgres postgres-postgresql-0 -- \
  psql -U postgres -c "SELECT pg_size_pretty(pg_database_size('mailu'));"

# CNPG
kubectl exec -n postgres postgres-1 -- \
  psql -U postgres -c "SELECT pg_size_pretty(pg_database_size('mailu'));"
```

### Check Active Connections

```bash
kubectl exec -n postgres <pod-name> -- \
  psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"
```

### Vacuum Database (Maintenance)

```bash
kubectl exec -n postgres <pod-name> -- \
  psql -U postgres -d mailu -c "VACUUM ANALYZE;"
```

---

## Migration Between Solutions

### Migrate from Bitnami to CNPG

1. **Backup Bitnami database**:
```bash
kubectl exec -n postgres postgres-postgresql-0 -- \
  pg_dump -U postgres -d mailu > mailu-backup.sql
```

2. **Deploy CNPG cluster** (follow Option 2 above)

3. **Restore to CNPG**:
```bash
cat mailu-backup.sql | kubectl exec -i -n postgres postgres-1 -- \
  psql -U postgres -d mailu
```

4. **Update Mailu configuration** to point to CNPG

5. **Test and verify**, then remove Bitnami deployment

---

## See Also

- [Manage Secrets](manage-secrets.md) - Creating database credential secrets
- [Setup Redis](setup-redis.md) - Deploy Redis for Mailu
- [Quick Start](../tutorials/01-quick-start.md) - Deploy Mailu with database
- [Backup and Restore](backup-restore.md) - Database backup strategies
- [CloudNativePG Documentation](https://cloudnative-pg.io/documentation/) - Official CNPG docs
- [Bitnami PostgreSQL Chart](https://github.com/bitnami/charts/tree/main/bitnami/postgresql) - Helm chart docs
