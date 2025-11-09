/**
 * Minimal Mailu deployment example for cdk8s synth
 *
 * This is a basic example showing Mailu with core components only.
 * For a complete example with all components, see examples/simple-deployment.ts
 */

import { App } from 'cdk8s';
import { MailuChart } from './mailu-chart';

const app = new App();

new MailuChart(app, 'mailu', {
  namespace: 'mailu',
  domain: 'example.com',
  hostnames: ['mail.example.com'],
  subnet: '10.42.0.0/16',

  database: {
    type: 'postgresql',
    postgresql: {
      host: 'postgres-pooler',
      secretName: 'postgres-app',
    },
  },

  redis: {
    host: 'redis',
  },

  secrets: {
    mailuSecretKey: 'mailu-secret-key',
  },

  storage: {
    storageClass: 'standard',
    admin: { size: '5Gi' },
    postfix: { size: '5Gi' },
    dovecot: { size: '100Gi' },
    rspamd: { size: '5Gi' },
  },
});

app.synth();
