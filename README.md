# cdk8s-mailu

> CDK8S construct library for deploying Mailu mail server to Kubernetes

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## Overview

`cdk8s-mailu` is a [CDK8S](https://cdk8s.io/) construct library that provides a type-safe, composable way to deploy [Mailu](https://mailu.io/) mail server to Kubernetes. It generates Kubernetes manifests from TypeScript code, making it easy to customize and version control your mail server infrastructure.

## Features

- **Core Mail Components**
  - ✅ **Admin** - Web administration interface
  - ✅ **Front** - Nginx reverse proxy for mail protocols (SMTP, IMAP, POP3)
  - ✅ **Postfix** - SMTP server for sending/receiving mail
  - ✅ **Dovecot** - IMAP/POP3 server for mail retrieval
  - ✅ **Rspamd** - Spam filtering and antispam engine

- **Optional Components**
  - ✅ **Webmail** - Roundcube webmail interface
  - ✅ **ClamAV** - Antivirus scanner for email attachments
  - ✅ **Fetchmail** - External email account fetching (POP3/IMAP polling)
  - ✅ **Webdav** - CalDAV/CardDAV server (Radicale)

- **Database Support**
  - PostgreSQL (recommended for production)
  - SQLite (for development/testing)

- **Storage Options**
  - Persistent volumes for all stateful components
  - Configurable storage classes
  - Separate PVCs for each component

- **Type Safety**
  - Full TypeScript support
  - Comprehensive configuration interfaces
  - IDE autocomplete and validation

## Prerequisites

- Kubernetes cluster (1.24+)
- PostgreSQL database (e.g., via CloudNativePG operator)
- Redis instance
- Storage class for persistent volumes
- Node.js 18+ and npm/yarn

## Installation

### Using npm

```bash
npm install cdk8s-mailu
```

### Using yarn

```bash
yarn add cdk8s-mailu
```

## Quick Start

### 1. Create Secrets

Before deploying, create required Kubernetes secrets:

```bash
# Mailu secret key (random hex string)
kubectl create secret generic mailu-secret-key \
  --from-literal=secret-key=$(openssl rand -hex 16)

# Initial admin password (optional)
kubectl create secret generic mailu-admin-password \
  --from-literal=password=$(openssl rand -base64 16)
```

### 2. Find Your Kubernetes Pod Network Subnet

Mailu requires the pod network CIDR to distinguish internal (trusted) traffic from external traffic. This is used for:
- Postfix relay trust configuration (`mynetworks`)
- Anti-spam scoring (internal traffic bypasses certain checks)
- Rate limiting and authentication decisions

**Method 1: Inspect Pod IPs**

```bash
# Get pod IPs from any namespace
kubectl get pods -o wide -A | grep -v "HOST IP" | head -10

# Example output:
# NAMESPACE     NAME                    IP           NODE
# kube-system   coredns-xyz             10.42.0.5    node1
# default       nginx-abc               10.42.1.8    node2
# monitoring    prometheus-def          10.42.2.3    node3

# If you see IPs starting with 10.42.x.x, your subnet is: 10.42.0.0/16
# If you see IPs starting with 10.244.x.x, your subnet is: 10.244.0.0/16
```

**Method 2: Check Node Pod CIDR (requires cluster admin)**

```bash
# Get pod CIDR from first node
kubectl get nodes -o jsonpath='{.items[0].spec.podCIDR}'
# Output: 10.42.0.0/16

# Check all nodes (for multi-node clusters)
kubectl get nodes -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.podCIDR}{"\n"}{end}'
```

**Method 3: Query Cluster Info**

```bash
# Search for cluster CIDR in cluster config
kubectl cluster-info dump | grep -i "cluster-cidr"
# or
kubectl cluster-info dump | grep -i "service-cluster-ip-range"
```

**Method 4: Check CNI Configuration**

```bash
# For K3S (default: 10.42.0.0/16)
kubectl get nodes -o jsonpath='{.items[0].spec.podCIDR}'

# For kubeadm clusters
kubectl get cm -n kube-system kubeadm-config -o yaml | grep podSubnet

# For Calico
kubectl get ippool -o yaml | grep cidr

# For Flannel
kubectl get cm -n kube-flannel kube-flannel-cfg -o yaml | grep Network
```

**Common Default Subnets:**
- K3S: `10.42.0.0/16`
- kubeadm: `10.244.0.0/16`
- GKE: `10.0.0.0/14` or `10.4.0.0/14`
- EKS: `10.0.0.0/16` (varies by VPC)
- AKS: `10.244.0.0/16`

**Why This Matters:**

Without the correct subnet, Mailu components cannot communicate properly:
```yaml
# ❌ Wrong subnet configured: 192.168.0.0/16
# Pod rspamd (10.42.1.5) connects to Postfix
# Postfix sees: "Untrusted external IP" → REJECTED

# ✅ Correct subnet configured: 10.42.0.0/16
# Pod rspamd (10.42.1.5) connects to Postfix
# Postfix sees: "Trusted internal pod network" → ACCEPTED
```

### 3. Create a Deployment Script

Create a file `mailu.ts`:

```typescript
import { App } from 'cdk8s';
import { MailuChart } from 'cdk8s-mailu';

const app = new App();

new MailuChart(app, 'mailu', {
  namespace: 'mailu',
  domain: 'example.com',
  hostnames: ['mail.example.com'],
  subnet: '10.42.0.0/16', // Your Kubernetes pod network CIDR

  database: {
    type: 'postgresql',
    postgresql: {
      host: 'postgres-pooler', // PostgreSQL service name
      secretName: 'postgres-app', // Secret with DB credentials
    },
  },

  redis: {
    host: 'redis', // Redis service name
  },

  secrets: {
    mailuSecretKey: 'mailu-secret-key',
  },

  storage: {
    storageClass: 'standard',
    admin: { size: '5Gi' },
    postfix: { size: '5Gi' },
    dovecot: { size: '100Gi' }, // Plan for 2x your current mail storage
    rspamd: { size: '5Gi' },
  },
});

app.synth();
```

### 4. Generate Manifests

```bash
npx ts-node mailu.ts
```

This generates `dist/mailu.k8s.yaml` containing all Kubernetes resources.

### 5. Deploy to Kubernetes

```bash
kubectl apply -f dist/mailu.k8s.yaml
```

## Configuration

### Full Configuration Example

See [examples/simple-deployment.ts](examples/simple-deployment.ts) for a comprehensive configuration example including:

- All component toggles
- Resource requests and limits
- Webmail and ClamAV configuration
- Mailu-specific settings
- Image configuration

### Configuration Interface

```typescript
interface MailuChartConfig {
  // Required
  domain: string;                    // Primary mail domain
  hostnames: string[];               // Mail server FQDNs
  subnet: string;                    // Kubernetes pod network CIDR
  database: DatabaseConfig;          // Database configuration
  redis: RedisConfig;                // Redis configuration
  secrets: SecretsConfig;            // Secret references

  // Optional
  namespace?: string;                // Default: 'mailu'
  timezone?: string;                 // Default: 'UTC'
  storage?: StorageConfig;           // PVC configuration
  components?: ComponentsConfig;     // Component toggles
  resources?: ResourcesConfig;       // Resource limits
  mailu?: MailuConfig;               // Mailu-specific settings
  images?: ImageConfig;              // Container image configuration
}
```

### Component Toggles

Enable or disable components as needed:

```typescript
components: {
  admin: true,      // Admin UI (default: true)
  front: true,      // Nginx frontend (default: true)
  postfix: true,    // SMTP server (default: true)
  dovecot: true,    // IMAP/POP3 server (default: true)
  rspamd: true,     // Spam filter (default: true)
  webmail: true,    // Roundcube webmail (default: false)
  clamav: true,     // Antivirus scanner (default: false)
  fetchmail: true,  // External account fetching (default: false)
  webdav: true,     // CalDAV/CardDAV server (default: false)
}
```

### Storage Configuration

Customize storage for each component:

```typescript
storage: {
  storageClass: 'longhorn',  // Global storage class
  admin: {
    size: '5Gi',
    storageClass: 'fast-ssd', // Override global storage class
  },
  postfix: { size: '5Gi' },
  dovecot: { size: '100Gi' },  // Largest - stores all mailboxes
  rspamd: { size: '5Gi' },
  webmail: { size: '5Gi' },
  clamav: { size: '15Gi' },    // Virus signature databases
  webdav: { size: '5Gi' },     // Calendars and contacts
}
```

### Resource Limits

Set CPU and memory limits for each component:

```typescript
resources: {
  admin: {
    requests: { cpu: '100m', memory: '512Mi' },
    limits: { cpu: '500m', memory: '1Gi' },
  },
  clamav: {
    requests: { cpu: '500m', memory: '2Gi' },  // ClamAV is CPU-intensive
    limits: { cpu: '2000m', memory: '4Gi' },
  },
  // ... other components
}
```

## Architecture

### Mail Flow

```
Internet → Traefik Ingress → Front (Nginx) → Mail Components
                                  ↓
                            [Authentication]
                                  ↓
                    ┌─────────────┼─────────────┐
                    ↓             ↓             ↓
                Postfix       Dovecot       Rspamd
                (SMTP)        (IMAP)        (Spam)
                    ↓             ↓             ↓
                PostgreSQL     PVC Storage   ClamAV
```

### Components

**Core Components:**
- **Front (Nginx)**: Entry point for all mail protocols. Handles TLS termination and protocol routing.
- **Admin**: Web UI for managing domains, users, and mail settings.
- **Postfix**: SMTP server for sending and receiving mail.
- **Dovecot**: IMAP/POP3 server for mail retrieval.
- **Rspamd**: Spam filtering, DKIM signing, and antispam scoring.

**Optional Components:**
- **Webmail (Roundcube)**: Web-based email client.
- **ClamAV**: Virus scanning for email attachments.
- **Fetchmail**: Polls external POP3/IMAP accounts and fetches mail into local mailboxes.
- **Webdav (Radicale)**: CalDAV and CardDAV server for calendar and contacts synchronization.

## Examples

### Minimal Deployment (Core Components Only)

See [src/main.ts](src/main.ts) for a minimal example with core components.

### Full Deployment (All Components)

See [examples/simple-deployment.ts](examples/simple-deployment.ts) for a complete example with webmail and antivirus.

### Running Examples

```bash
# Minimal deployment
npm run synth

# Full deployment
npx ts-node examples/simple-deployment.ts
```

## Post-Deployment

### 1. Configure DNS Records

Add the following DNS records for your mail domain:

```
mail.example.com.     300  IN  A      <YOUR_INGRESS_IP>
example.com.          300  IN  MX  10 mail.example.com.
example.com.          300  IN  TXT    "v=spf1 mx ~all"
_dmarc.example.com.   300  IN  TXT    "v=DMARC1; p=quarantine; rua=mailto:postmaster@example.com"
```

### 2. Configure Ingress

Create an Ingress or LoadBalancer service to expose mail ports:

- SMTP: 25, 465, 587
- IMAP: 143, 993
- POP3: 110, 995
- HTTP/HTTPS: 80, 443 (for Admin/Webmail)

### 3. Access Admin UI

1. Port-forward the admin service:
   ```bash
   kubectl port-forward -n mailu svc/<admin-service-name> 8080:80
   ```

2. Access at `http://localhost:8080`

3. Login with initial admin account (if configured)

### 4. Configure DKIM

DKIM keys are generated automatically by the Admin component. Retrieve the public key:

```bash
kubectl exec -n mailu <admin-pod-name> -- cat /data/dkim/<domain>.dkim.key
```

Add the key as a TXT record:

```
default._domainkey.example.com.  IN  TXT  "v=DKIM1; k=rsa; p=<PUBLIC_KEY>"
```

## Development

### Build

```bash
npm run build      # Compile + test + synth
npm run compile    # TypeScript compilation
npm run test       # Run tests
npm run synth      # Generate manifests
```

### Testing

```bash
npm test           # Run all tests
npm run test:watch # Watch mode
```

### Test Coverage

Current coverage: **96.94%** (169 tests passing)

```
File                     | % Stmts | % Lines |
-------------------------|---------|---------|
admin-construct.ts       | 92.12   | 92.12   |
clamav-construct.ts      | 100.00  | 100.00  |
dovecot-construct.ts     | 93.22   | 93.22   |
fetchmail-construct.ts   | 100.00  | 100.00  |
front-construct.ts       | 100.00  | 100.00  |
postfix-construct.ts     | 100.00  | 100.00  |
rspamd-construct.ts      | 91.39   | 91.39   |
webdav-construct.ts      | 100.00  | 100.00  |
webmail-construct.ts     | 100.00  | 100.00  |
```

## Roadmap

- [x] Core mail components (Admin, Front, Postfix, Dovecot, Rspamd)
- [x] Optional components (Webmail, ClamAV, Fetchmail, Webdav)
- [ ] High-availability configurations
- [ ] Backup/restore utilities
- [ ] Monitoring dashboards (Grafana)
- [ ] Migration tools from other mail servers

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Mailu](https://mailu.io/) - The mail server software
- [CDK8S](https://cdk8s.io/) - Cloud Development Kit for Kubernetes
- [CloudNativePG](https://cloudnative-pg.io/) - PostgreSQL operator for Kubernetes

## Support

- **Issues**: [GitHub Issues](https://github.com/bluedynamics/cdk8s-mailu/issues)
- **Discussions**: [GitHub Discussions](https://github.com/bluedynamics/cdk8s-mailu/discussions)
- **Mailu Documentation**: https://mailu.io/
- **CDK8S Documentation**: https://cdk8s.io/docs/latest/

---

Made with ❤️ by the cdk8s-mailu team
