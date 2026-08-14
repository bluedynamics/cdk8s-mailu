# Manage Secrets

**How to create and manage Kubernetes secrets required by Mailu.**

## Problem

Mailu requires several secrets for secure operation: application secret keys, database credentials, Redis passwords, and initial admin passwords. You need to create these secrets before deploying Mailu.

## Solution

Create Kubernetes Secret resources containing sensitive data, then reference them in the `MailuChart` configuration. Never commit secrets to git or include them in CDK8S code.

## Understanding Secret Requirements

Mailu requires these secrets (minimum):

| Secret Purpose | Required? | Secret Name (configurable) | Keys |
|----------------|-----------|----------------------------|------|
| Mailu secret key | **Yes** | `mailu-secrets` | `secret-key` |
| Database credentials | **Yes** (if PostgreSQL) | `postgres-app` | `username`, `password` |
| Initial admin password | **Yes** (recommended) | `mailu-secrets` | `password` |
| Redis password | No (if Redis auth disabled) | `redis-password` | `password` |
| API token | No (if API disabled) | `mailu-api-token` | `api-token` |

## Create Mailu Secret Key

The Mailu secret key is used for session encryption and must be a random 16-character string.

### Generate Random Secret Key

```bash
# Generate 16-character random key
SECRET_KEY=$(head -c 16 /dev/urandom | base64 | tr -d '=' | cut -c1-16)
echo $SECRET_KEY
```

### Create Secret

```bash
kubectl create secret generic mailu-secrets \
  --namespace=mailu \
  --from-literal=secret-key="$SECRET_KEY"
```

**Verify**:
```bash
kubectl get secret -n mailu mailu-secrets
kubectl describe secret -n mailu mailu-secrets
```

## Create Initial Admin Password

Generate a secure password for the initial admin account:

```bash
# Generate strong random password
ADMIN_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -d '=' | cut -c1-24)
echo "Admin password: $ADMIN_PASSWORD"

# Add password to existing mailu-secrets
kubectl create secret generic mailu-secrets \
  --namespace=mailu \
  --from-literal=secret-key="$SECRET_KEY" \
  --from-literal=password="$ADMIN_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -
```

**Important**: Save this password securely (password manager). You'll need it to login to the admin UI after deployment.

## Create Database Credentials Secret

### For PostgreSQL (Recommended)

If using CloudNativePG (CNPG) or another PostgreSQL operator, the secret is usually auto-generated. Reference the existing secret:

```typescript
database: {
  type: 'postgresql',
  postgresql: {
    host: 'postgres-pooler',  // CNPG pooler service
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

**Manual PostgreSQL**: Create the secret yourself:

```bash
kubectl create secret generic postgres-credentials \
  --namespace=mailu \
  --from-literal=username="mailu" \
  --from-literal=password="$(head -c 32 /dev/urandom | base64 | tr -d '=')"
```

Reference in CDK8S:
```typescript
database: {
  type: 'postgresql',
  postgresql: {
    host: 'postgres-service',
    secretName: 'postgres-credentials',
    secretKeys: {
      username: 'username',
      password: 'password',
    },
  },
}
```

### For SQLite (Not Recommended for Production)

No database secret needed (SQLite file stored in admin PVC):

```typescript
database: {
  type: 'sqlite',
}
```

## Create Redis Password Secret (Optional)

If your Redis instance requires authentication:

```bash
kubectl create secret generic redis-password \
  --namespace=mailu \
  --from-literal=password="$(head -c 32 /dev/urandom | base64 | tr -d '=')"
```

Reference in CDK8S:
```typescript
redis: {
  host: 'redis',
  port: 6379,
  secretName: 'redis-password',
  secretKey: 'password',
}
```

**If Redis has no authentication** (cluster-internal only):
```typescript
redis: {
  host: 'redis',
  port: 6379,
  // No secretName needed
}
```

## Example: Complete Secret Setup

Script to create all required secrets at once:

```bash
#!/bin/bash
set -e

NAMESPACE="mailu"

echo "Creating Mailu secrets..."

# Generate random values
SECRET_KEY=$(head -c 16 /dev/urandom | base64 | tr -d '=' | cut -c1-16)
ADMIN_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -d '=' | cut -c1-24)
DB_PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -d '=')

echo "Generated credentials:"
echo "  SECRET_KEY: $SECRET_KEY"
echo "  ADMIN_PASSWORD: $ADMIN_PASSWORD"
echo "  (Save these securely!)"
echo ""

# Create namespace
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

# Mailu application secrets
kubectl create secret generic mailu-secrets \
  --namespace=$NAMESPACE \
  --from-literal=secret-key="$SECRET_KEY" \
  --from-literal=password="$ADMIN_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

# Database credentials (if not using CNPG auto-generated)
kubectl create secret generic postgres-credentials \
  --namespace=$NAMESPACE \
  --from-literal=username="mailu" \
  --from-literal=password="$DB_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Secrets created successfully!"
kubectl get secrets -n $NAMESPACE
```

Save as `create-mailu-secrets.sh`, make executable, and run:

```bash
chmod +x create-mailu-secrets.sh
./create-mailu-secrets.sh
```

## Configure Secrets in CDK8S

After creating secrets, reference them in your `MailuChart`:

```typescript
import { App } from 'cdk8s';
import { MailuChart } from 'cdk8s-mailu';

const app = new App();

new MailuChart(app, 'mailu', {
  namespace: 'mailu',
  domain: 'example.com',
  hostnames: ['mail.example.com'],
  subnet: '10.42.0.0/16',
  timezone: 'UTC',

  // Reference secrets (not values!)
  secrets: {
    mailuSecretKey: 'mailu-secrets',           // Secret with 'secret-key' field
    initialAdminPassword: 'mailu-secrets',     // Secret with 'password' field
    apiToken: 'mailu-api-token',               // Optional, if API enabled
  },

  database: {
    type: 'postgresql',
    postgresql: {
      host: 'postgres-pooler',
      port: 5432,
      database: 'mailu',
      secretName: 'postgres-app',              // Database credentials
      secretKeys: {
        username: 'username',
        password: 'password',
      },
    },
  },

  redis: {
    host: 'redis',
    port: 6379,
    // secretName: 'redis-password',           // Uncomment if Redis requires auth
    // secretKey: 'password',
  },
});

app.synth();
```

## Rotate Secrets

### Rotate Mailu Secret Key

**Warning**: Rotating the secret key invalidates all user sessions. Users must re-login.

```bash
# Generate new key
NEW_SECRET_KEY=$(head -c 16 /dev/urandom | base64 | tr -d '=' | cut -c1-16)

# Update secret
kubectl create secret generic mailu-secrets \
  --namespace=mailu \
  --from-literal=secret-key="$NEW_SECRET_KEY" \
  --from-literal=password="<existing-admin-password>" \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart admin pods to pick up new secret
kubectl rollout restart deployment -n mailu mailu-admin
```

### Rotate Database Password

**Caution**: Requires updating both database and Mailu secret simultaneously.

```bash
# Step 1: Update password in PostgreSQL
kubectl exec -n postgres postgres-1 -- psql -U postgres -c "ALTER USER mailu PASSWORD 'new-password';"

# Step 2: Update Kubernetes secret
kubectl create secret generic postgres-credentials \
  --namespace=mailu \
  --from-literal=username="mailu" \
  --from-literal=password="new-password" \
  --dry-run=client -o yaml | kubectl apply -f -

# Step 3: Restart Mailu admin pod
kubectl rollout restart deployment -n mailu mailu-admin
```

## Use External Secret Management

For production, consider using external secret management with [External Secrets Operator](https://external-secrets.io/):

### Example: Sync from HashiCorp Vault

```yaml
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: vault-backend
  namespace: mailu
spec:
  provider:
    vault:
      server: "https://vault.example.com"
      path: "secret"
      version: "v2"
      auth:
        kubernetes:
          mountPath: "kubernetes"
          role: "mailu"
---
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: mailu-secrets-external
  namespace: mailu
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: mailu-secrets
    creationPolicy: Owner
  data:
    - secretKey: secret-key
      remoteRef:
        key: mailu/secret-key
    - secretKey: password
      remoteRef:
        key: mailu/admin-password
```

## Verify Secret Usage

Check if secrets are correctly mounted to pods:

```bash
# Check admin pod environment
kubectl exec -n mailu <admin-pod-name> -- env | grep SECRET_KEY

# Should show: SECRET_KEY=<your-secret-key>

# Check database connection
kubectl logs -n mailu <admin-pod-name> | grep -i database

# Should show successful database connection
```

## Troubleshooting

### Secret not found error

**Symptom**: Pod shows `CreateContainerConfigError` with message about missing secret.

```bash
# Check secret exists
kubectl get secret -n mailu <secret-name>

# Check secret has correct keys
kubectl get secret -n mailu <secret-name> -o jsonpath='{.data}' | jq
```

**Solution**: Create the missing secret or fix the secret name in your CDK8S configuration.

### Database authentication failed

**Symptom**: Admin pod logs show "authentication failed" or "password authentication failed for user".

```bash
# Check database secret
kubectl get secret -n mailu <db-secret-name> -o jsonpath='{.data.password}' | base64 -d

# Test database connection manually
kubectl exec -n mailu <admin-pod> -- psql -h <db-host> -U <username> -d mailu
```

**Solution**: Verify database password matches between Kubernetes secret and PostgreSQL database.

### Admin login fails after deployment

**Symptom**: Cannot login to admin UI with generated password.

**Common causes**:
- Initial admin account not created (check `mailu.initialAccount` config)
- Password secret not mounted correctly
- Wrong username (should be configured username @ domain)

**Solution**: Check admin pod logs for initial account creation:

```bash
kubectl logs -n mailu <admin-pod> | grep -i "initial admin"
```

## Security Best Practices

1. **Never commit secrets to git** - Use `.gitignore` for secret files
2. **Use strong random passwords** - At least 24 characters for admin passwords
3. **Rotate secrets regularly** - Especially after employee turnover
4. **Limit secret access** - Use Kubernetes RBAC to restrict secret read permissions
5. **Use external secret management** - Vault, AWS Secrets Manager, etc. for production
6. **Encrypt etcd** - Enable etcd encryption at rest in your Kubernetes cluster
7. **Audit secret access** - Enable audit logging for secret operations

## See Also

- [Quick Start Tutorial](../tutorials/01-quick-start.md) - Initial deployment with secrets
- [External Secrets Operator](https://external-secrets.io/) - Sync secrets from external stores
- [Kubernetes Secrets Documentation](https://kubernetes.io/docs/concepts/configuration/secret/) - Official Kubernetes docs
