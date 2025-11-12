#!/usr/bin/env ts-node

/**
 * Simple Mailu deployment example
 *
 * This example demonstrates a basic Mailu deployment with:
 * - PostgreSQL database
 * - Redis for caching
 * - Core mail components
 * - Roundcube webmail
 * - ClamAV antivirus
 *
 * Prerequisites:
 * - PostgreSQL database (e.g., via CNPG operator)
 * - Redis instance
 * - Secrets created:
 *   - mailu-secret-key: Random secret key for Mailu
 *   - postgres-app: PostgreSQL credentials
 *
 * Usage:
 *   ts-node examples/simple-deployment.ts
 *
 * Output:
 *   Generated manifests in dist/simple-deployment.k8s.yaml
 */

import { App } from 'cdk8s';
import { MailuChart } from '../src';

const app = new App();

new MailuChart(app, 'simple-deployment', {
  // Kubernetes namespace
  namespace: 'mailu',

  // Mail configuration
  domain: 'example.com',
  hostnames: ['mail.example.com'],
  subnet: '10.42.0.0/16', // Adjust to your K8S pod network

  // Database configuration (PostgreSQL)
  database: {
    type: 'postgresql',
    postgresql: {
      host: 'postgres-cluster-pooler', // Adjust to your PostgreSQL service
      port: 5432,
      database: 'mailu',
      secretName: 'postgres-app', // Secret with DB credentials
      secretKeys: {
        username: 'username',
        password: 'password',
      },
    },
  },

  // Redis configuration
  redis: {
    host: 'redis', // Adjust to your Redis service
    port: 6379,
  },

  // Secret references
  secrets: {
    mailuSecretKey: 'mailu-secret-key', // Must exist before deployment
    initialAdminPassword: 'mailu-admin-password', // Optional: auto-generated if not provided
  },

  // Storage configuration
  storage: {
    storageClass: 'standard', // Adjust to your storage class (e.g., 'longhorn', 'gp2')
    admin: {
      size: '5Gi',
    },
    postfix: {
      size: '5Gi',
    },
    dovecot: {
      size: '100Gi', // Plan for 2x your current mail storage
    },
    rspamd: {
      size: '5Gi',
    },
    clamav: {
      size: '10Gi',
    },
  },

  // Enable components
  components: {
    admin: true,
    front: true,
    postfix: true,
    dovecot: true,
    rspamd: true,
    webmail: true, // Enable Roundcube webmail
    clamav: true, // Enable antivirus scanning
    fetchmail: false, // Disable external account fetching
    webdav: false, // Disable calendar/contacts server
  },

  // Resource limits (optional - adjust based on your cluster)
  resources: {
    front: {
      requests: { cpu: '100m', memory: '256Mi' },
      limits: { cpu: '500m', memory: '512Mi' },
    },
    admin: {
      requests: { cpu: '100m', memory: '512Mi' },
      limits: { cpu: '500m', memory: '1Gi' },
    },
    postfix: {
      requests: { cpu: '100m', memory: '512Mi' },
      limits: { cpu: '500m', memory: '1Gi' },
    },
    dovecot: {
      requests: { cpu: '200m', memory: '1Gi' },
      limits: { cpu: '1000m', memory: '2Gi' },
    },
    rspamd: {
      requests: { cpu: '100m', memory: '512Mi' },
      limits: { cpu: '500m', memory: '1Gi' },
    },
    webmail: {
      requests: { cpu: '100m', memory: '512Mi' },
      limits: { cpu: '500m', memory: '1Gi' },
    },
    clamav: {
      requests: { cpu: '200m', memory: '1Gi' },
      limits: { cpu: '1000m', memory: '2Gi' },
    },
  },

  // Mailu-specific settings
  mailu: {
    logLevel: 'INFO',
    messageSizeLimit: 50, // MB
    initialAccount: {
      enabled: true,
      username: 'admin',
      domain: 'example.com', // Will create admin@example.com
      mode: 'update', // Create or update account
    },
    apiEnabled: true,
  },

  // Image configuration (optional)
  images: {
    registry: 'ghcr.io/mailu',
    tag: '2024.06', // Mailu version
    pullPolicy: 'IfNotPresent',
  },

  // Ingress configuration (optional - requires Traefik installed)
  // ingress: {
  //   enabled: true,
  //   type: 'traefik',
  //   traefik: {
  //     hostname: 'mail.example.com',
  //     certIssuer: 'letsencrypt-cluster-issuer',
  //     enableTcp: true,  // Enable SMTP/IMAP/POP3 TCP routes
  //     smtpConnectionLimit: 15,  // Max concurrent SMTP connections per IP
  //   },
  //},
});

app.synth();

console.log('✅ Manifests generated successfully!');
console.log('📄 Output: dist/simple-deployment.k8s.yaml');
console.log('\n📋 Next steps:');
console.log('1. Create required secrets:');
console.log('   kubectl create secret generic mailu-secret-key --from-literal=secret-key=$(openssl rand -hex 16)');
console.log('   kubectl create secret generic mailu-admin-password --from-literal=password=$(openssl rand -base64 16)');
console.log('\n2. Deploy to Kubernetes:');
console.log('   kubectl apply -f dist/simple-deployment.k8s.yaml');
console.log('\n3. Configure DNS records (MX, SPF, DKIM, DMARC)');
console.log('\n4. Configure external access:');
console.log('   - Uncomment ingress config above for automatic Traefik ingress, OR');
console.log('   - Manually configure ingress/load balancer');
