# Setup Prerequisites

**Complete guide for preparing your Kubernetes cluster before deploying Mailu.**

## Problem

Mailu requires several external services and infrastructure components to function. You need to install these prerequisites before deploying Mailu.

## Prerequisites Checklist

Before deploying Mailu, ensure you have:

### Required Infrastructure

- [ ] **Kubernetes cluster** (1.28+ recommended)
  - Minimum 3 worker nodes for HA
  - 8GB RAM, 4 CPU cores minimum
  - Internet connectivity for image pulls

- [ ] **Persistent storage** (ReadWriteOnce volumes)
  - Longhorn, local-path, cloud provider storage class
  - 100Gi+ available for mailboxes

- [ ] **Ingress controller** (Traefik recommended)
  - Ports 80, 443, 25, 587, 465, 993, 995 exposed
  - TLS certificate management (cert-manager)

### Required Services

- [ ] **PostgreSQL database** (12+)
  - Bitnami Helm chart (simple) or CloudNativePG (production)
  - See: [Setup PostgreSQL](setup-postgresql.md)

- [ ] **Redis cache** (6+)
  - Bitnami Helm chart
  - See: [Setup Redis](setup-redis.md)

### Required Configuration

- [ ] **DNS records** pointing to cluster ingress
  - `mail.example.com` → Cluster ingress IP
  - MX record for mail domain

- [ ] **Kubernetes secrets** for Mailu
  - Mailu secret key
  - Database credentials
  - Initial admin password
  - See: [Manage Secrets](manage-secrets.md)

---

## Quick Start Path

Follow these steps in order for a complete deployment:

### 1. Verify Cluster Readiness

```bash
# Check Kubernetes version
kubectl version

# Check available storage classes
kubectl get storageclass

# Check available resources
kubectl top nodes
```

### 2. Setup PostgreSQL

Choose deployment method based on your needs:

**Development/Testing** → Bitnami PostgreSQL (5 minutes):
```bash
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install postgres bitnami/postgresql \
  --namespace postgres --create-namespace \
  --set auth.database=mailu \
  --set auth.username=mailu \
  --set auth.password="$(openssl rand -base64 32)"
```

**Production** → CloudNativePG (10 minutes):
```bash
# Install operator
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm install cnpg cnpg/cloudnative-pg --namespace cnpg-system --create-namespace

# Deploy cluster (see setup-postgresql.md for full config)
kubectl apply -f postgres-cluster.yaml
```

📖 **Detailed guide**: [Setup PostgreSQL](setup-postgresql.md)

### 3. Setup Redis

Simple standalone Redis (3 minutes):

```bash
helm install redis bitnami/redis \
  --namespace redis --create-namespace \
  --set auth.enabled=false \
  --set master.persistence.size=5Gi
```

📖 **Detailed guide**: [Setup Redis](setup-redis.md)

### 4. Setup Ingress (Traefik)

If not already installed:

```bash
# Install Traefik
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik \
  --namespace traefik --create-namespace \
  --set ports.web.exposedPort=80 \
  --set ports.websecure.exposedPort=443 \
  --set ports.smtp.port=25 \
  --set ports.smtp.exposedPort=25 \
  --set ports.smtps.port=465 \
  --set ports.smtps.exposedPort=465 \
  --set ports.submission.port=587 \
  --set ports.submission.exposedPort=587 \
  --set ports.imaps.port=993 \
  --set ports.imaps.exposedPort=993 \
  --set ports.pop3s.port=995 \
  --set ports.pop3s.exposedPort=995
```

For Traefik with mail ports, create `traefik-values.yaml`:

```yaml
ports:
  web:
    port: 80
    exposedPort: 80
  websecure:
    port: 443
    exposedPort: 443
    tls:
      enabled: true
  # Mail protocol ports
  smtp:
    port: 25
    exposedPort: 25
    protocol: TCP
  submission:
    port: 587
    exposedPort: 587
    protocol: TCP
  smtps:
    port: 465
    exposedPort: 465
    protocol: TCP
  imaps:
    port: 993
    exposedPort: 993
    protocol: TCP
  pop3s:
    port: 995
    exposedPort: 995
    protocol: TCP

service:
  type: LoadBalancer  # or NodePort

ingressRoute:
  dashboard:
    enabled: false  # Enable if you want Traefik dashboard
```

Install with custom values:

```bash
helm install traefik traefik/traefik \
  --namespace traefik --create-namespace \
  --values traefik-values.yaml
```

**Get Ingress IP**:

```bash
kubectl get svc -n traefik traefik

# Note the EXTERNAL-IP for DNS configuration
```

### 5. Install cert-manager (TLS Certificates)

```bash
# Install cert-manager
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --set installCRDs=true
```

**Create Let's Encrypt issuer** (`letsencrypt-prod.yaml`):

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: your-email@example.com  # Change this!
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
    - http01:
        ingress:
          class: traefik
```

Apply:

```bash
kubectl apply -f letsencrypt-prod.yaml
```

### 6. Configure DNS

Point your domain to the cluster ingress:

```bash
# Get ingress IP
INGRESS_IP=$(kubectl get svc -n traefik traefik -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
echo "Configure DNS: mail.example.com → $INGRESS_IP"
```

**DNS Records to create**:

| Record Type | Name | Value | Priority |
|-------------|------|-------|----------|
| A | mail.example.com | `<INGRESS_IP>` | - |
| MX | example.com | mail.example.com | 10 |
| TXT | example.com | v=spf1 mx ~all | - |

**Verify DNS**:

```bash
# Check A record
dig +short mail.example.com

# Check MX record
dig +short MX example.com
```

### 7. Create Kubernetes Secrets

```bash
# Create Mailu secrets
kubectl create namespace mailu

kubectl create secret generic mailu-secrets \
  --namespace=mailu \
  --from-literal=secret-key="$(head -c 16 /dev/urandom | base64 | tr -d '=' | cut -c1-16)" \
  --from-literal=password="$(openssl rand -base64 32)"

# Database credentials (if using manual PostgreSQL)
kubectl create secret generic postgres-credentials \
  --namespace=mailu \
  --from-literal=username="mailu" \
  --from-literal=password="<from-postgres-setup>"
```

📖 **Detailed guide**: [Manage Secrets](manage-secrets.md)

### 8. Deploy Mailu

Create `mailu.ts`:

```typescript
import { App } from 'cdk8s';
import { MailuChart } from 'cdk8s-mailu';

const app = new App();

new MailuChart(app, 'mailu', {
  namespace: 'mailu',
  domain: 'example.com',
  hostnames: ['mail.example.com'],
  subnet: '10.42.0.0/16',  // Your Kubernetes pod CIDR
  timezone: 'UTC',

  database: {
    type: 'postgresql',
    postgresql: {
      host: 'postgres-pooler.postgres.svc.cluster.local',  // CNPG
      // or: 'postgres-postgresql.postgres.svc.cluster.local',  // Bitnami
      port: 5432,
      database: 'mailu',
      secretName: 'postgres-app',  // CNPG auto-generated
      // or secretName: 'postgres-credentials',  // Manual secret
      secretKeys: {
        username: 'username',
        password: 'password',
      },
    },
  },

  redis: {
    host: 'redis-master.redis.svc.cluster.local',
    port: 6379,
  },

  secrets: {
    mailuSecretKey: 'mailu-secrets',
    initialAdminPassword: 'mailu-secrets',
  },

  components: {
    webmail: true,
    clamav: false,  // Disable (high resources)
  },

  storage: {
    storageClass: 'longhorn',
    dovecot: { size: '50Gi' },
  },
});

app.synth();
```

Deploy:

```bash
npm run synth
kubectl apply -f dist/mailu.k8s.yaml

# Wait for pods to start
kubectl get pods -n mailu -w
```

### 9. Create Traefik IngressRoutes

See [Configure TLS](configure-tls.md) for complete IngressRoute configuration.

### 10. Verify Deployment

```bash
# Check all pods running
kubectl get pods -n mailu

# Test HTTPS access
curl -I https://mail.example.com/admin

# Login to admin UI
# https://mail.example.com/admin
# Username: admin@example.com
# Password: (from mailu-secrets)
```

📖 **Complete tutorial**: [Quick Start](../tutorials/01-quick-start.md)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  Traefik Ingress Controller (TLS Termination)               │
│  - HTTP/HTTPS (80, 443)                                     │
│  - Mail Protocols (25, 587, 465, 993, 995)                 │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ↓
┌─────────────────────────────────────────────────────────────┐
│  Mailu Front (Nginx)                                        │
│  - Protocol routing                                         │
│  - Authentication proxy                                     │
└─────┬───────────────────────┬───────────────┬───────────────┘
      │                       │               │
      ↓                       ↓               ↓
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Admin UI     │    │ Webmail      │    │ Mail Services│
│ (Flask)      │    │ (Roundcube)  │    │ (SMTP/IMAP)  │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────┬───────┴───────────────────┘
                   │
      ┌────────────┼────────────┐
      │            │            │
      ↓            ↓            ↓
┌──────────┐ ┌──────────┐ ┌──────────┐
│PostgreSQL│ │  Redis   │ │ PVCs     │
│ (Users)  │ │(Sessions)│ │(Mailbox) │
└──────────┘ └──────────┘ └──────────┘
```

---

## Resource Planning

### Minimum Cluster Requirements

**Development/Testing**:
- 1 node: 4 CPU, 8GB RAM, 50GB storage
- Storage class: local-path
- Database: SQLite or single-instance PostgreSQL
- Redis: Standalone

**Production (< 100 users)**:
- 3 nodes: 4 CPU, 8GB RAM, 100GB storage each
- Storage class: Longhorn (2 replicas)
- Database: CloudNativePG (3 replicas)
- Redis: Master-Replica

**Production (100-500 users)**:
- 5 nodes: 8 CPU, 16GB RAM, 200GB storage each
- Storage class: Longhorn (2 replicas)
- Database: CloudNativePG with backups
- Redis: Sentinel

### Storage Breakdown

| Component | Size | Purpose |
|-----------|------|---------|
| Dovecot mailboxes | 50-500Gi | User email storage (1-5GB per user) |
| PostgreSQL | 10-20Gi | User accounts, config |
| Redis | 5Gi | Sessions, cache |
| Admin data | 5Gi | DKIM keys, config |
| Postfix queue | 5-10Gi | Mail queue |
| Rspamd | 5Gi | Spam learning |

**Total storage needed**: 80Gi minimum, 550Gi+ for large deployments

---

## Troubleshooting Prerequisites

### Cannot pull images

```bash
# Check internet connectivity
kubectl run test --image=nginx --rm -it -- curl -I google.com

# Check image pull secrets if using private registry
kubectl get secrets -n mailu
```

### Storage class not found

```bash
# List available storage classes
kubectl get storageclass

# If none exist, install storage provider
# Longhorn example:
kubectl apply -f https://raw.githubusercontent.com/longhorn/longhorn/master/deploy/longhorn.yaml
```

### Ingress controller not exposing ports

```bash
# Check Traefik service type
kubectl get svc -n traefik

# Should show type: LoadBalancer with EXTERNAL-IP

# If pending, check cloud provider load balancer support
# Or use NodePort:
kubectl patch svc -n traefik traefik -p '{"spec":{"type":"NodePort"}}'
```

### Database connection timeout

```bash
# Test connectivity from Mailu namespace
kubectl run -n mailu test --image=postgres:15 --rm -it -- \
  psql -h postgres-postgresql.postgres.svc.cluster.local -U mailu -d mailu

# Check PostgreSQL service
kubectl get svc -n postgres

# Check PostgreSQL pods
kubectl get pods -n postgres
```

### Redis connection refused

```bash
# Test connectivity
kubectl run -n mailu test --image=redis:7 --rm -it -- \
  redis-cli -h redis-master.redis.svc.cluster.local ping

# Check Redis service
kubectl get svc -n redis

# Check Redis pods
kubectl get pods -n redis
```

---

## Security Checklist

Before deploying to production:

- [ ] **Change all default passwords**
  - PostgreSQL admin and mailu user
  - Redis password (if enabled)
  - Mailu admin password

- [ ] **Enable TLS everywhere**
  - Traefik TLS termination
  - Let's Encrypt certificates
  - HTTPS-only access

- [ ] **Configure firewall rules**
  - Restrict Kubernetes API access
  - Allow only required mail ports
  - Block direct PostgreSQL/Redis access from internet

- [ ] **Enable network policies** (optional)
  - Restrict pod-to-pod communication
  - Allow only required service access

- [ ] **Configure backups**
  - PostgreSQL backups to S3
  - PVC snapshots (Longhorn/Velero)
  - Test restore procedures

- [ ] **Enable monitoring**
  - Prometheus metrics
  - Pod resource usage alerts
  - Disk space alerts

---

## Next Steps

After prerequisites are ready:

1. 📖 **[Quick Start Tutorial](../tutorials/01-quick-start.md)** - Deploy Mailu
2. 📖 **[Configure TLS](configure-tls.md)** - Set up Traefik IngressRoutes
3. 📖 **[Manage Secrets](manage-secrets.md)** - Create required secrets
4. 📖 **[Backup and Restore](backup-restore.md)** - Protect your data

---

## See Also

- [Setup PostgreSQL](setup-postgresql.md) - Database deployment options
- [Setup Redis](setup-redis.md) - Cache deployment
- [Configure TLS](configure-tls.md) - Traefik ingress setup
- [Component Specifications](../reference/component-specifications.md) - Resource requirements
- [Architecture](../explanation/architecture.md) - Understanding the system
