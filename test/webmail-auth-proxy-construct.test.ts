import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { MailuChartConfig } from '../src/config';
import { WebmailAuthProxyConstruct } from '../src/constructs/webmail-auth-proxy-construct';
import { MailuChart } from '../src/mailu-chart';

const authProxyImage = (manifests: any[]): string => {
  const deployment = manifests.find(
    (m) => m.kind === 'Deployment' && m.metadata?.labels?.['app.kubernetes.io/component'] === 'auth-proxy',
  );
  return deployment.spec.template.spec.containers[0].image;
};

describe('WebmailAuthProxyConstruct', () => {
  const synth = (image?: string): any[] => {
    const chart = Testing.chart();
    const namespace = new kplus.Namespace(chart, 'ns', { metadata: { name: 'test-mailu' } });
    const authProxyConfigMap = new kplus.ConfigMap(chart, 'cm', {
      metadata: { namespace: namespace.name },
      data: { 'nginx.conf': '', 'entrypoint.sh': '' },
    });
    new WebmailAuthProxyConstruct(chart, 'auth-proxy', {
      namespace,
      authProxyConfigMap,
      webmailServiceName: 'webmail.test-mailu.svc.cluster.local',
      adminServiceName: 'admin.test-mailu.svc.cluster.local',
      image,
    });
    return Testing.synth(chart);
  };

  it('runs a patch-pinned nginx of a stable branch by default', () => {
    // Even minor = stable branch. A floating tag of an odd (mainline) minor
    // stops getting images when the next stable branch appears.
    expect(authProxyImage(synth())).toMatch(/^nginx:1\.\d*[02468]\.\d+-alpine$/);
  });

  it('uses the configured image', () => {
    expect(authProxyImage(synth('registry.example.com/nginx:1.30.9-alpine'))).toBe(
      'registry.example.com/nginx:1.30.9-alpine',
    );
  });
});

describe('MailuChart images.webmailAuthProxy', () => {
  const config: MailuChartConfig = {
    namespace: 'mailu-test',
    domain: 'example.com',
    hostnames: ['mail.example.com'],
    subnet: '10.42.0.0/16',
    database: {
      type: 'postgresql',
      postgresql: { host: 'postgres-pooler', secretName: 'postgres-credentials' },
    },
    redis: { host: 'redis' },
    secrets: { mailuSecretKey: 'mailu-secret-key' },
    storage: {
      storageClass: 'longhorn',
      admin: { size: '5Gi' },
      postfix: { size: '5Gi' },
      dovecot: { size: '100Gi' },
      rspamd: { size: '5Gi' },
    },
    components: { webmail: true },
    ingress: { enabled: true, type: 'traefik', traefik: { hostname: 'mail.example.com' } },
  };

  it('passes the configured image to the auth proxy', () => {
    const chart = new MailuChart(Testing.app(), 'test', {
      ...config,
      images: { webmailAuthProxy: 'nginx:1.30.9-alpine' },
    });
    expect(authProxyImage(Testing.synth(chart))).toBe('nginx:1.30.9-alpine');
  });

  it('leaves the Mailu image tag out of the auth proxy image', () => {
    const chart = new MailuChart(Testing.app(), 'test', {
      ...config,
      images: { registry: 'registry.example.com/mailu', tag: '2024.06.71' },
    });
    expect(authProxyImage(Testing.synth(chart))).toMatch(/^nginx:/);
  });
});
