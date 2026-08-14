# Setup Redis

**How to deploy Redis for Mailu session storage and caching.**

## Problem

Mailu requires Redis for session storage and caching. You need to deploy Redis before deploying Mailu.

## Solution

Deploy Redis using the Bitnami Helm chart. For most Mailu deployments, a simple single-instance Redis is sufficient since sessions can be regenerated if Redis fails.

## Prerequisites

- Helm 3 installed
- Kubernetes cluster
- Persistent storage (optional for session data)

## Step 1: Add Bitnami Helm Repository

```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update
```

## Step 2: Choose Deployment Mode

### Option A: Standalone (Recommended for Most Cases)

Simple single-instance Redis. Suitable for:
- Development and testing
- Small to medium deployments (< 500 users)
- Environments where brief session loss is acceptable

### Option B: Master-Replica (High Availability)

Master with read replicas. Use when:
- High availability is critical
- Large deployments (500+ users)
- Zero downtime required

### Option C: Sentinel (Automatic Failover)

Redis with Sentinel for automatic failover. Use when:
- Production critical workload
- Automatic failover required
- Multiple replicas with coordinator

---

## Deploy Standalone Redis (Recommended)

### Create Values File

Create `redis-values.yaml`:

```yaml
# Bitnami Redis configuration for Mailu
architecture: standalone

auth:
  enabled: false  # Mailu supports Redis without authentication (cluster-internal)
  # Or enable authentication:
  # enabled: true
  # password: "CHANGE_ME_SECURE_PASSWORD"

master:
  persistence:
    enabled: true  # Persist data (optional for sessions)
    size: 5Gi
    storageClass: longhorn

  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 256Mi

  # Disable persistence if sessions-only (faster, but data lost on restart)
  # persistence:
  #   enabled: false

metrics:
  enabled: true
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
```

### Install Redis

```bash
# Create namespace
kubectl create namespace redis

# Install Redis
helm install redis bitnami/redis \
  --namespace redis \
  --values redis-values.yaml

# Wait for pod to be ready
kubectl wait --for=condition=ready pod -n redis -l app.kubernetes.io/name=redis --timeout=300s
```

### Verify Installation

```bash
# Check pod status
kubectl get pods -n redis

# Test Redis connection
kubectl exec -n redis redis-master-0 -- redis-cli ping
# Should return: PONG

# Check Redis info
kubectl exec -n redis redis-master-0 -- redis-cli info server
```

### Get Connection Details

```bash
# Get service name
kubectl get svc -n redis

# Service name will be: redis-master
# Connection string: redis-master.redis.svc.cluster.local:6379
```

### Configure Mailu (No Authentication)

If Redis has `auth.enabled: false`:

```typescript
redis: {
  host: 'redis-master.redis.svc.cluster.local',
  port: 6379,
  // No secretName needed
}
```

### Configure Mailu (With Authentication)

If Redis has `auth.enabled: true`, create secret:

```bash
# Get Redis password from Helm release
REDIS_PASSWORD=$(kubectl get secret -n redis redis -o jsonpath='{.data.redis-password}' | base64 -d)

# Create secret for Mailu
kubectl create secret generic redis-password \
  --namespace=mailu \
  --from-literal=password="$REDIS_PASSWORD"
```

Configure in CDK8S:

```typescript
redis: {
  host: 'redis-master.redis.svc.cluster.local',
  port: 6379,
  secretName: 'redis-password',
  secretKey: 'password',
}
```

---

## Deploy Master-Replica Redis (High Availability)

### Create Values File

Create `redis-ha-values.yaml`:

```yaml
# Redis Master-Replica configuration
architecture: replication

auth:
  enabled: false  # Or true for authentication

replica:
  replicaCount: 2  # Number of read replicas

master:
  persistence:
    enabled: true
    size: 5Gi
    storageClass: longhorn

  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi

replica:
  persistence:
    enabled: true
    size: 5Gi
    storageClass: longhorn

  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi

metrics:
  enabled: true
```

### Install Redis HA

```bash
helm install redis bitnami/redis \
  --namespace redis \
  --values redis-ha-values.yaml

# Wait for all pods
kubectl wait --for=condition=ready pod -n redis -l app.kubernetes.io/name=redis --timeout=300s
```

### Verify Replication

```bash
# Check master
kubectl exec -n redis redis-master-0 -- redis-cli info replication

# Should show:
# role:master
# connected_slaves:2

# Check replica
kubectl exec -n redis redis-replicas-0 -- redis-cli info replication

# Should show:
# role:slave
# master_host:redis-master-0
```

### Configure Mailu with HA Redis

Use the master service for writes:

```typescript
redis: {
  host: 'redis-master.redis.svc.cluster.local',  // Write to master
  port: 6379,
}
```

**Note**: Mailu connects to master for both reads and writes. Read replicas are used automatically by the Redis client for load balancing.

---

## Deploy Redis Sentinel (Automatic Failover)

### Create Values File

Create `redis-sentinel-values.yaml`:

```yaml
# Redis Sentinel configuration
sentinel:
  enabled: true
  replicas: 3  # Sentinel instances (odd number recommended)

  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      cpu: 200m
      memory: 128Mi

master:
  persistence:
    enabled: true
    size: 5Gi

  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi

replica:
  replicaCount: 2
  persistence:
    enabled: true
    size: 5Gi

  resources:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 512Mi

auth:
  enabled: false  # Or true
  sentinel: false  # Sentinel auth (usually false for internal cluster)

metrics:
  enabled: true
```

### Install Redis Sentinel

```bash
helm install redis bitnami/redis \
  --namespace redis \
  --values redis-sentinel-values.yaml

kubectl wait --for=condition=ready pod -n redis -l app.kubernetes.io/name=redis --timeout=600s
```

### Verify Sentinel

```bash
# Check Sentinel status
kubectl exec -n redis redis-node-0 -- \
  redis-cli -p 26379 sentinel master mymaster

# Should show master details and number of slaves and sentinels
```

### Configure Mailu with Sentinel

```typescript
redis: {
  host: 'redis.redis.svc.cluster.local',  // Sentinel service
  port: 6379,  // Redis port (Sentinel handles failover)
  // Sentinel configuration in Mailu is automatic with standard Bitnami setup
}
```

---

## Persistence Considerations

### With Persistence (Default)

**Pros**:
- Session data survives pod restarts
- Cached data persists
- Better for production

**Cons**:
- Requires PVC storage
- Slower restarts (load data from disk)

### Without Persistence

**Pros**:
- Faster pod restarts
- No storage overhead
- Simpler setup

**Cons**:
- All sessions lost on restart (users must re-login)
- Cache data regenerated on restart

**When to disable persistence**: Development/testing where session loss is acceptable.

```yaml
master:
  persistence:
    enabled: false
```

---

## Monitoring Redis

### Check Memory Usage

```bash
kubectl exec -n redis redis-master-0 -- \
  redis-cli info memory | grep used_memory_human
```

### Check Connected Clients

```bash
kubectl exec -n redis redis-master-0 -- \
  redis-cli info clients | grep connected_clients
```

### Check Hit Rate

```bash
kubectl exec -n redis redis-master-0 -- \
  redis-cli info stats | grep keyspace
```

### Monitor Keys

```bash
# Count keys
kubectl exec -n redis redis-master-0 -- \
  redis-cli dbsize

# List all keys (be careful in production!)
kubectl exec -n redis redis-master-0 -- \
  redis-cli --scan

# List Mailu session keys
kubectl exec -n redis redis-master-0 -- \
  redis-cli --scan --pattern "session:*"
```

---

## Scaling Redis

### Increase Memory

Edit `redis-values.yaml`:

```yaml
master:
  resources:
    requests:
      memory: 512Mi  # Increased
    limits:
      memory: 1Gi    # Increased
```

Apply changes:

```bash
helm upgrade redis bitnami/redis \
  --namespace redis \
  --values redis-values.yaml

# Pod will restart with new resources
kubectl rollout status statefulset -n redis redis-master
```

### Add More Replicas (HA Mode)

Edit `redis-ha-values.yaml`:

```yaml
replica:
  replicaCount: 3  # Increased from 2
```

Apply:

```bash
helm upgrade redis bitnami/redis \
  --namespace redis \
  --values redis-ha-values.yaml
```

---

## Troubleshooting

### Pod not starting

```bash
# Check pod status
kubectl describe pod -n redis redis-master-0

# Check logs
kubectl logs -n redis redis-master-0

# Common causes:
# - PVC not bound (check storage class)
# - Resource limits too low
# - Port already in use
```

### Cannot connect to Redis

```bash
# Test from another pod
kubectl run -it --rm redis-test --image=redis:7 --restart=Never -- \
  redis-cli -h redis-master.redis.svc.cluster.local ping

# Should return: PONG

# Check service
kubectl get svc -n redis
```

### Authentication errors

```bash
# Get Redis password
kubectl get secret -n redis redis -o jsonpath='{.data.redis-password}' | base64 -d

# Test with password
kubectl exec -n redis redis-master-0 -- \
  redis-cli -a "<password>" ping
```

### High memory usage

```bash
# Check memory stats
kubectl exec -n redis redis-master-0 -- \
  redis-cli info memory

# Check key distribution
kubectl exec -n redis redis-master-0 -- \
  redis-cli --bigkeys

# Flush keys if needed (CAREFUL - deletes all data!)
# kubectl exec -n redis redis-master-0 -- redis-cli FLUSHALL
```

### Replication lag (HA mode)

```bash
# Check replica status
kubectl exec -n redis redis-replicas-0 -- \
  redis-cli info replication | grep master_link_status

# Should show: master_link_status:up

# Check lag
kubectl exec -n redis redis-replicas-0 -- \
  redis-cli info replication | grep master_repl_offset
```

---

## Performance Tuning

### Optimize for Session Storage

Mailu primarily uses Redis for short-lived session data:

```yaml
master:
  configuration: |-
    # Optimize for session storage
    maxmemory 256mb
    maxmemory-policy allkeys-lru  # Evict least recently used keys
    save ""  # Disable snapshotting if persistence disabled
```

### Connection Pooling

Redis handles connections efficiently. Typical settings:

```yaml
master:
  configuration: |-
    maxclients 1000
    timeout 300
```

---

## Redis vs Alternatives

### Why Redis for Mailu?

- ✅ Fast in-memory storage
- ✅ Built-in expiration (TTL) for sessions
- ✅ Simple key-value model
- ✅ Low resource overhead
- ✅ Widely supported

### Could You Use Memcached?

No, Mailu requires Redis specifically. Mailu uses Redis-specific features like:
- Key expiration (TTL)
- Hash data structures
- Pub/sub (for certain operations)

---

## Cleanup and Removal

### Uninstall Redis

```bash
# Uninstall Helm release
helm uninstall redis --namespace redis

# Delete PVCs (data will be lost!)
kubectl delete pvc -n redis -l app.kubernetes.io/name=redis

# Delete namespace
kubectl delete namespace redis
```

**Warning**: This deletes all session data. Users will need to re-login to Mailu.

---

## See Also

- [Setup PostgreSQL](setup-postgresql.md) - Deploy database for Mailu
- [Manage Secrets](manage-secrets.md) - Creating Redis password secrets
- [Quick Start](../tutorials/01-quick-start.md) - Deploy Mailu with Redis
- [Component Specifications](../reference/component-specifications.md) - Redis requirements
- [Bitnami Redis Chart](https://github.com/bitnami/charts/tree/main/bitnami/redis) - Official Helm chart docs
