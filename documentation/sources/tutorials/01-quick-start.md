# Quick Start: Deploy Your First Mailu Instance

**Learn how to deploy a basic Mailu mail server using cdk8s-mailu in under 30 minutes.**

## What you'll build

By the end of this tutorial, you'll have:
- A working Mailu deployment on Kubernetes
- Basic understanding of the MailuChart construct
- Knowledge of essential configuration options
- A functional mail server ready for testing

## Prerequisites

- Kubernetes cluster (minikube, kind, or cloud provider)
- kubectl configured and working
- Node.js 16+ installed
- npm or yarn package manager
- Basic familiarity with TypeScript

## Overview

This tutorial will guide you through:
1. Setting up a new CDK8S project
2. Installing cdk8s-mailu
3. Creating a basic MailuChart
4. Synthesizing Kubernetes manifests
5. Deploying to your cluster
6. Testing the deployment

## Step 1: Create a new CDK8S project

```bash
mkdir my-mailu-deployment
cd my-mailu-deployment
cdk8s init typescript-app
```

## Step 2: Install cdk8s-mailu

```bash
npm install cdk8s-mailu
```

## Step 3: Create your Mailu chart

Replace the contents of `main.ts` with a basic Mailu configuration:

```typescript
import { App } from 'cdk8s';
import { MailuChart } from 'cdk8s-mailu';

const app = new App();

new MailuChart(app, 'mailu', {
  // Basic domain configuration
  namespace: 'mailu',
  domain: 'example.com',
  hostnames: ['mail.example.com'],
  subnet: '10.42.0.0/16',  // Your Kubernetes pod CIDR
  timezone: 'UTC',

  // Database configuration (PostgreSQL recommended)
  database: {
    type: 'postgresql',
    postgresql: {
      host: 'postgres-rw',      // Your PostgreSQL service
      port: 5432,
      database: 'mailu',
      secretName: 'postgres-app',  // Secret with DB credentials
      secretKeys: {
        username: 'username',
        password: 'password',
      },
    },
  },

  // Redis configuration
  redis: {
    host: 'redis',
    port: 6379,
  },

  // Secrets (create these in Kubernetes first!)
  secrets: {
    mailuSecretKey: 'mailu-secrets',  // Secret with 'secret-key' field
    initialAdminPassword: 'mailu-secrets',  // Secret with 'password' field
  },

  // Optional: Enable/disable components
  components: {
    webmail: true,   // Roundcube webmail (enabled by default)
    clamav: false,   // Antivirus (disabled, requires ~1GB RAM)
    fetchmail: false,  // External account fetching
    webdav: false,   // CalDAV/CardDAV
  },

  // Optional: Customize storage
  storage: {
    storageClass: 'longhorn',  // Your storage class
    dovecot: {
      size: '50Gi',  // Mailbox storage (adjust based on users)
    },
  },
});

app.synth();
```

**What this configuration does:**
- Sets up Mailu for `example.com` domain
- Uses PostgreSQL for database (more reliable than SQLite)
- Connects to Redis for caching
- Enables webmail (Roundcube)
- Disables optional heavy components (ClamAV, etc.)
- Allocates 50Gi for mailbox storage

## Step 4: Synthesize manifests

```bash
npm run synth
```

This generates Kubernetes manifests in the `dist/` directory.

## Step 5: Deploy to Kubernetes

```bash
kubectl apply -f dist/
```

## Step 6: Verify deployment

Check that all pods are running:

```bash
kubectl get pods -n mailu
```

## What's next?

- [Configure advanced options](../how-to/configure-construct.md)
- [Understand the dovecot submission service](../explanation/dovecot-submission.md)
- [Understand the architecture](../explanation/architecture.md)

## Troubleshooting

**Pods not starting?**
- Check secrets exist: `kubectl get secrets -n mailu`
- Verify PostgreSQL is accessible: `kubectl get svc postgres-rw`
- Check pod logs: `kubectl logs -n mailu -l app.kubernetes.io/part-of=mailu`

**Storage issues?**
- Verify storage class exists: `kubectl get storageclass`
- Check PVC status: `kubectl get pvc -n mailu`

**Service discovery issues?**
- Check ConfigMap: `kubectl get configmap -n mailu -o yaml | grep ADDRESS`
