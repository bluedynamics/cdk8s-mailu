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

*[Content placeholder for docwriter]*

Create a file `main.ts`:

```typescript
import { App } from 'cdk8s';
import { MailuChart } from 'cdk8s-mailu';

const app = new App();

new MailuChart(app, 'mailu', {
  namespace: 'mailu',
  config: {
    // Basic configuration here
    domain: 'example.com',
    // Additional config...
  },
});

app.synth();
```

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
- [Set up PostgreSQL backend](../how-to/configure-construct.md)
- [Understand the architecture](../explanation/architecture.md)

---

*This is a placeholder tutorial. Content will be expanded by the docwriter with:*
- Detailed configuration examples
- Expected output at each step
- Troubleshooting common issues
- Screenshots or diagrams
- Testing procedures
- Clean-up instructions
