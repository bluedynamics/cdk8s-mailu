import { Testing } from 'cdk8s';
import { MailuChartConfig } from '../src/config';
import { MailuChart } from '../src/mailu-chart';

describe('MailuChart', () => {
  const validConfig: MailuChartConfig = {
    namespace: 'mailu-test',
    domain: 'example.com',
    hostnames: ['mail.example.com'],
    subnet: '10.42.0.0/16',
    database: {
      type: 'postgresql',
      postgresql: {
        host: 'postgres-pooler',
        secretName: 'postgres-credentials',
      },
    },
    redis: {
      host: 'redis',
    },
    secrets: {
      mailuSecretKey: 'mailu-secret-key',
    },
    storage: {
      storageClass: 'longhorn',
      admin: { size: '5Gi' },
      postfix: { size: '5Gi' },
      dovecot: { size: '100Gi' },
      rspamd: { size: '5Gi' },
    },
  };

  describe('configuration validation', () => {
    it('accepts valid configuration', () => {
      const app = Testing.app();
      expect(() => new MailuChart(app, 'test', validConfig)).not.toThrow();
    });

    describe('domain validation', () => {
      it('rejects invalid domain format', () => {
        const app = Testing.app();
        const config = { ...validConfig, domain: 'invalid domain' };
        expect(() => new MailuChart(app, 'test', config)).toThrow(
          'Invalid domain format for domain',
        );
      });

      it('rejects domain without TLD', () => {
        const app = Testing.app();
        const config = { ...validConfig, domain: 'example' };
        expect(() => new MailuChart(app, 'test', config)).toThrow(
          'Invalid domain format for domain',
        );
      });

      it('accepts valid multi-level domain', () => {
        const app = Testing.app();
        const config = { ...validConfig, domain: 'mail.example.com' };
        expect(() => new MailuChart(app, 'test', config)).not.toThrow();
      });
    });

    describe('subnet validation', () => {
      it('rejects invalid subnet format', () => {
        const app = Testing.app();
        const config = { ...validConfig, subnet: '10.42.0.0' };
        expect(() => new MailuChart(app, 'test', config)).toThrow(
          'Invalid CIDR format for subnet',
        );
      });

      it('rejects subnet with invalid IP', () => {
        const app = Testing.app();
        const config = { ...validConfig, subnet: '256.0.0.0/8' };
        expect(() => new MailuChart(app, 'test', config)).toThrow(
          'Invalid CIDR format for subnet',
        );
      });

      it('rejects subnet with invalid prefix', () => {
        const app = Testing.app();
        const config = { ...validConfig, subnet: '10.42.0.0/33' };
        expect(() => new MailuChart(app, 'test', config)).toThrow(
          'Invalid CIDR format for subnet',
        );
      });

      it('accepts valid CIDR notation', () => {
        const app = Testing.app();
        const config = { ...validConfig, subnet: '192.168.0.0/24' };
        expect(() => new MailuChart(app, 'test', config)).not.toThrow();
      });
    });

    describe('hostnames validation', () => {
      it('rejects invalid hostname format', () => {
        const app = Testing.app();
        const config = { ...validConfig, hostnames: ['invalid hostname'] };
        expect(() => new MailuChart(app, 'test', config)).toThrow(
          'Invalid domain format for hostnames[0]',
        );
      });

      it('rejects hostname without TLD', () => {
        const app = Testing.app();
        const config = { ...validConfig, hostnames: ['mail'] };
        expect(() => new MailuChart(app, 'test', config)).toThrow(
          'Invalid domain format for hostnames[0]',
        );
      });

      it('validates all hostnames in array', () => {
        const app = Testing.app();
        const config = {
          ...validConfig,
          hostnames: ['mail.example.com', 'invalid', 'smtp.example.com'],
        };
        expect(() => new MailuChart(app, 'test', config)).toThrow(
          'Invalid domain format for hostnames[1]',
        );
      });

      it('accepts multiple valid hostnames', () => {
        const app = Testing.app();
        const config = {
          ...validConfig,
          hostnames: ['mail.example.com', 'smtp.example.com', 'imap.example.com'],
        };
        expect(() => new MailuChart(app, 'test', config)).not.toThrow();
      });
    });

    describe('initial account domain validation', () => {
      it('rejects invalid initial account domain', () => {
        const app = Testing.app();
        const config = {
          ...validConfig,
          mailu: {
            initialAccount: {
              enabled: true,
              username: 'admin',
              domain: 'invalid domain',
            },
          },
        };
        expect(() => new MailuChart(app, 'test', config)).toThrow(
          'Invalid domain format for mailu.initialAccount.domain',
        );
      });

      it('rejects domain without TLD', () => {
        const app = Testing.app();
        const config = {
          ...validConfig,
          mailu: {
            initialAccount: {
              enabled: true,
              username: 'admin',
              domain: 'example',
            },
          },
        };
        expect(() => new MailuChart(app, 'test', config)).toThrow(
          'Invalid domain format for mailu.initialAccount.domain',
        );
      });

      it('accepts valid initial account domain', () => {
        const app = Testing.app();
        const config = {
          ...validConfig,
          mailu: {
            initialAccount: {
              enabled: true,
              username: 'admin',
              domain: 'example.com',
            },
          },
        };
        expect(() => new MailuChart(app, 'test', config)).not.toThrow();
      });

      it('accepts configuration without initial account', () => {
        const app = Testing.app();
        const config = { ...validConfig };
        expect(() => new MailuChart(app, 'test', config)).not.toThrow();
      });
    });
  });

  describe('resource generation', () => {
    it('generates valid Kubernetes manifests', () => {
      const app = Testing.app();
      const chart = new MailuChart(app, 'test', validConfig);
      const manifests = Testing.synth(chart);

      // Should have multiple manifests (namespace, configmap, deployments, services, pvcs)
      expect(manifests.length).toBeGreaterThan(0);

      // All manifests should be valid YAML with apiVersion and kind
      manifests.forEach((manifest) => {
        expect(manifest).toHaveProperty('apiVersion');
        expect(manifest).toHaveProperty('kind');
      });
    });

    it('creates namespace with correct name', () => {
      const app = Testing.app();
      const chart = new MailuChart(app, 'test', validConfig);
      const manifests = Testing.synth(chart);

      const namespace = manifests.find((m) => m.kind === 'Namespace');
      expect(namespace).toBeDefined();
      expect(namespace?.metadata?.name).toBe('mailu-test');
    });

    it('creates shared ConfigMap with environment variables', () => {
      const app = Testing.app();
      const chart = new MailuChart(app, 'test', validConfig);
      const manifests = Testing.synth(chart);

      const configMap = manifests.find((m) => m.kind === 'ConfigMap');
      expect(configMap).toBeDefined();
      expect(configMap?.data).toHaveProperty('DOMAIN', 'example.com');
      expect(configMap?.data).toHaveProperty('HOSTNAMES', 'mail.example.com');
      expect(configMap?.data).toHaveProperty('SUBNET', '10.42.0.0/16');
    });

    it('creates deployments for core components', () => {
      const app = Testing.app();
      const chart = new MailuChart(app, 'test', validConfig);
      const manifests = Testing.synth(chart);

      const deployments = manifests.filter((m) => m.kind === 'Deployment');

      // Should have admin, front, postfix, dovecot, rspamd deployments
      expect(deployments.length).toBeGreaterThanOrEqual(5);
    });

    it('creates services for core components', () => {
      const app = Testing.app();
      const chart = new MailuChart(app, 'test', validConfig);
      const manifests = Testing.synth(chart);

      const services = manifests.filter((m) => m.kind === 'Service');

      // Should have services for admin, front, postfix, dovecot, rspamd
      expect(services.length).toBeGreaterThanOrEqual(5);
    });

    it('creates PVCs for stateful components', () => {
      const app = Testing.app();
      const chart = new MailuChart(app, 'test', validConfig);
      const manifests = Testing.synth(chart);

      const pvcs = manifests.filter((m) => m.kind === 'PersistentVolumeClaim');

      // Should have PVCs for admin, postfix, dovecot, rspamd
      expect(pvcs.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('component toggles', () => {
    it('creates webmail when enabled', () => {
      const app = Testing.app();
      const config = {
        ...validConfig,
        components: { webmail: true },
      };
      const chart = new MailuChart(app, 'test', config);
      const manifests = Testing.synth(chart);

      const webmailDeployment = manifests.find(
        (m) => m.kind === 'Deployment' && m.metadata?.labels?.['app.kubernetes.io/component'] === 'webmail',
      );
      expect(webmailDeployment).toBeDefined();
    });

    it('creates clamav when enabled', () => {
      const app = Testing.app();
      const config = {
        ...validConfig,
        components: { clamav: true },
      };
      const chart = new MailuChart(app, 'test', config);
      const manifests = Testing.synth(chart);

      const clamavDeployment = manifests.find(
        (m) => m.kind === 'Deployment' && m.metadata?.labels?.['app.kubernetes.io/component'] === 'clamav',
      );
      expect(clamavDeployment).toBeDefined();
    });

    it('skips admin when disabled', () => {
      const app = Testing.app();
      const config = {
        ...validConfig,
        components: { admin: false },
      };
      const chart = new MailuChart(app, 'test', config);
      const manifests = Testing.synth(chart);

      const adminDeployment = manifests.find(
        (m) => m.kind === 'Deployment' && m.metadata?.labels?.['app.kubernetes.io/component'] === 'admin',
      );
      expect(adminDeployment).toBeUndefined();
    });
  });
});
