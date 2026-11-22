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
      // DKIM keys must live on the admin PVC (/data) — Mailu's default
      // /dkim/... is ephemeral, keys would vanish on every pod restart
      expect(configMap?.data).toHaveProperty(
        'DKIM_PATH',
        '/data/dkim/{domain}.{selector}.key',
      );
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
        // The front authenticates against admin, so it has to go as well
        components: { admin: false, front: false },
      };
      const chart = new MailuChart(app, 'test', config);
      const manifests = Testing.synth(chart);

      const adminDeployment = manifests.find(
        (m) => m.kind === 'Deployment' && m.metadata?.labels?.['app.kubernetes.io/component'] === 'admin',
      );
      expect(adminDeployment).toBeUndefined();
    });
  });

  describe('front', () => {
    const frontConf = (config: MailuChartConfig): string =>
      Testing.synth(new MailuChart(Testing.app(), 'test', config))
        .find((m) => m.kind === 'ConfigMap' && m.data?.['nginx.conf']).data['nginx.conf'];

    test('the front keeps its construct paths, so object names survive the rewrite', () => {
      const chart = new MailuChart(Testing.app(), 'test', validConfig);
      expect(chart.frontConstruct!.deployment.node.path).toBe('test/front/deployment');
      expect(chart.frontConstruct!.service.node.path).toBe('test/front/service');
    });

    test('no wrapper is rendered for the front any more', () => {
      const manifests = Testing.synth(new MailuChart(Testing.app(), 'test', validConfig));
      expect(manifests.filter((m) => m.metadata?.labels?.['app.kubernetes.io/name'] === 'mailu-nginx-patch')).toEqual([]);
      const front = manifests.find(
        (m) => m.kind === 'Deployment' && m.metadata?.labels?.['app.kubernetes.io/component'] === 'front',
      );
      // Webmail still has a wrapper of the same file name
      expect(JSON.stringify(front)).not.toContain('entrypoint-wrapper.sh');
    });

    test('the front advertises the message size limit that postfix enforces', () => {
      for (const config of [validConfig, { ...validConfig, mailu: { messageSizeLimit: 25 } }]) {
        const manifests = Testing.synth(new MailuChart(Testing.app(), 'test', config));
        const env = manifests.find((m) => m.kind === 'ConfigMap' && m.data?.MESSAGE_SIZE_LIMIT);
        expect(frontConf(config)).toContain(`"SIZE ${env.data.MESSAGE_SIZE_LIMIT}"`);
      }
    });

    test('the front authenticates against the admin service of the chart', () => {
      const manifests = Testing.synth(new MailuChart(Testing.app(), 'test', validConfig));
      const adminService = manifests.find(
        (m) => m.kind === 'Service' && m.metadata?.labels?.['app.kubernetes.io/component'] === 'admin',
      );
      expect(frontConf(validConfig)).toContain(
        `auth_http http://${adminService.metadata.name}.mailu-test.svc.cluster.local:8080/internal/auth/email;`,
      );
    });

    test('the front finds admin in the default namespace when none is configured', () => {
      const { namespace, ...withoutNamespace } = validConfig;
      expect(namespace).toBeDefined();
      expect(frontConf(withoutNamespace)).toMatch(
        /auth_http http:\/\/[a-z0-9-]+\.mailu\.svc\.cluster\.local:8080\/internal\/auth\/email;/,
      );
    });

    test('the front follows proxyProtocolToFront', () => {
      const withProxy = frontConf({
        ...validConfig,
        ingress: { enabled: false, type: 'traefik', traefik: { hostname: 'mail.example.com', proxyProtocolToFront: true } },
      });
      expect(withProxy).toContain('listen 10993 proxy_protocol;');
      expect(withProxy).toContain('set_real_ip_from 10.42.0.0/16;');
      const without = frontConf(validConfig);
      expect(without).not.toContain('proxy_protocol');
      expect(without).not.toContain('set_real_ip_from');
    });

    test('a front without the admin component is rejected', () => {
      expect(() => new MailuChart(Testing.app(), 'test', { ...validConfig, components: { admin: false } }))
        .toThrow(/front.*admin/i);
    });
  });

  describe('priorityClassName', () => {
    // Every optional component plus the Traefik ingress (which adds the
    // webmail-auth-proxy), so all eleven workloads are rendered
    const allComponentsConfig: MailuChartConfig = {
      ...validConfig,
      components: { webmail: true, clamav: true, fetchmail: true, webdav: true },
      ingress: { enabled: true, type: 'traefik', traefik: { hostname: 'mail.example.com' } },
    };

    const podTemplateSpec = (manifest: any): any => {
      switch (manifest.kind) {
        case 'Deployment':
        case 'StatefulSet':
        case 'DaemonSet':
        case 'Job':
          return manifest.spec?.template?.spec;
        case 'CronJob':
          return manifest.spec?.jobTemplate?.spec?.template?.spec;
        default:
          return undefined;
      }
    };

    it('sets priorityClassName on every pod template when configured', () => {
      const app = Testing.app();
      const config = {
        ...allComponentsConfig,
        mailu: { priorityClassName: 'kup6s-high' },
      };
      const chart = new MailuChart(app, 'test', config);
      const manifests = Testing.synth(chart);

      const workloads = manifests.filter((m) => podTemplateSpec(m) !== undefined);
      expect(workloads).toHaveLength(11);

      const missing = workloads
        .filter((m) => podTemplateSpec(m).priorityClassName !== 'kup6s-high')
        .map((m) => `${m.kind}/${m.metadata?.name}`);
      expect(missing).toEqual([]);
    });

    it('omits priorityClassName from every manifest when unset', () => {
      const app = Testing.app();
      const chart = new MailuChart(app, 'test', allComponentsConfig);
      const manifests = Testing.synth(chart);

      expect(manifests.filter((m) => podTemplateSpec(m) !== undefined)).toHaveLength(11);
      expect(JSON.stringify(manifests)).not.toContain('priorityClassName');
    });
  });
});
