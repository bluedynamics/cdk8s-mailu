import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { MailuChartConfig } from '../src/config';
import { FrontConstruct } from '../src/constructs/front-construct';

describe('FrontConstruct', () => {
  const adminServiceHost = 'admin.test-mailu.svc.cluster.local';
  const baseConfig: MailuChartConfig = {
    domain: 'test.example.com',
    hostnames: ['mail.test.example.com', 'smtp.test.example.com'],
    subnet: '10.42.0.0/16',
    database: {
      type: 'postgresql',
      postgresql: {
        host: 'postgres',
        secretName: 'postgres-secret',
      },
    },
    redis: {
      host: 'redis',
    },
    secrets: {
      mailuSecretKey: 'test-secret-key',
    },
  };

  const synth = (config: MailuChartConfig = baseConfig) => {
    const chart = Testing.chart();
    const namespace = new kplus.Namespace(chart, 'test-namespace', {
      metadata: { name: 'test-mailu' },
    });
    new FrontConstruct(chart, 'front', { config, namespace, adminServiceHost });
    const manifests = Testing.synth(chart);
    const deployment = manifests.find((m) => m.kind === 'Deployment');
    return {
      deployment,
      pod: deployment.spec.template,
      container: deployment.spec.template.spec.containers[0],
      service: manifests.find((m) => m.kind === 'Service'),
      configMap: manifests.find((m) => m.kind === 'ConfigMap'),
    };
  };

  test('runs a patch-pinned nginx of a stable branch by default', () => {
    // Even minor = stable branch. A floating tag of an odd (mainline) minor
    // stops getting images when the next stable branch appears.
    expect(synth().container.image).toMatch(/^nginx:1\.\d*[02468]\.\d+-alpine$/);
  });

  test('uses the configured front image', () => {
    const { container } = synth({ ...baseConfig, images: { front: 'registry.example.com/nginx:1.30.9-alpine' } });
    expect(container.image).toBe('registry.example.com/nginx:1.30.9-alpine');
  });

  test('the Mailu registry and tag do not apply to the front', () => {
    const { container } = synth({ ...baseConfig, images: { registry: 'registry.example.com/mailu', tag: '2024.06.72' } });
    expect(container.image).toMatch(/^nginx:/);
  });

  test('starts nginx directly, without a wrapper and without any Mailu environment', () => {
    const { container } = synth();
    expect(container.name).toBe('front');
    expect(container.command).toEqual(['nginx', '-c', '/etc/nginx/nginx.conf', '-g', 'daemon off;']);
    expect(container.env).toBeUndefined();
    expect(container.envFrom).toBeUndefined();
  });

  test('runs unprivileged on a read-only root filesystem', () => {
    const { container } = synth();
    expect(container.securityContext).toMatchObject({
      runAsNonRoot: true,
      runAsUser: 101,
      runAsGroup: 101,
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
      privileged: false,
      capabilities: { drop: ['ALL'] },
      seccompProfile: { type: 'RuntimeDefault' },
    });
  });

  test('listens on unprivileged ports and a health port', () => {
    const ports = Object.fromEntries(synth().container.ports.map((p: any) => [p.name, p.containerPort]));
    expect(ports).toEqual({ smtps: 10465, imaps: 10993, pop3s: 10995, health: 8080 });
  });

  test('probes the health endpoint', () => {
    const { container } = synth();
    for (const probe of [container.livenessProbe, container.readinessProbe]) {
      expect(probe.httpGet.path).toBe('/health');
      expect(probe.httpGet.port).toBe(8080);
    }
  });

  test('no probe opens a mail port, where a missing PROXY header would log an error', () => {
    expect(synth().container.startupProbe).toBeUndefined();
  });

  test('mounts the configuration read-only and a writable /tmp', () => {
    const { pod, container, configMap } = synth();
    expect(container.volumeMounts).toContainEqual(
      expect.objectContaining({ mountPath: '/etc/nginx/nginx.conf', subPath: 'nginx.conf', readOnly: true }),
    );
    const tmpMount = container.volumeMounts.find((m: any) => m.mountPath === '/tmp');
    expect(pod.spec.volumes.find((v: any) => v.name === tmpMount.name).emptyDir).toBeDefined();
    const configVolume = pod.spec.volumes.find((v: any) => v.configMap);
    expect(configVolume.configMap.name).toBe(configMap.metadata.name);
  });

  test('the configuration authenticates against admin and greets with the first hostname', () => {
    const conf = synth().configMap.data['nginx.conf'];
    expect(conf).toContain(`auth_http http://${adminServiceHost}:8080/internal/auth/email;`);
    expect(conf).toContain('server_name mail.test.example.com;');
    expect(conf).toContain('"SIZE 52428800"');
  });

  test('the configuration follows proxyProtocolToFront and the subnet', () => {
    const withProxy = synth({
      ...baseConfig,
      ingress: { enabled: false, type: 'traefik', traefik: { hostname: 'mail.test.example.com', proxyProtocolToFront: true } },
    }).configMap.data['nginx.conf'];
    expect(withProxy).toContain('listen 10993 proxy_protocol;');
    expect(withProxy).toContain('set_real_ip_from 10.42.0.0/16;');
    const without = synth().configMap.data['nginx.conf'];
    expect(without).not.toContain('proxy_protocol');
    expect(without).not.toContain('set_real_ip_from');
  });

  test('a changed configuration changes the pod template, so the pod restarts', () => {
    const before = synth().pod.metadata.annotations['checksum/config'];
    const after = synth({ ...baseConfig, mailu: { messageSizeLimit: 10 } }).pod.metadata.annotations['checksum/config'];
    expect(before).toMatch(/^[0-9a-f]{64}$/);
    expect(after).toMatch(/^[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
  });

  test('the service keeps the public ports and targets the container ports', () => {
    const ports = synth().service.spec.ports.map((p: any) => [p.name, p.port, p.targetPort]);
    expect(ports).toEqual([
      ['smtps', 465, 10465],
      ['imaps', 993, 10993],
      ['pop3s', 995, 10995],
    ]);
    expect(synth().service.spec.type).toBe('ClusterIP');
  });

  test('keeps the labels other tooling selects on', () => {
    const { deployment, pod, service } = synth();
    for (const labels of [deployment.metadata.labels, pod.metadata.labels, service.metadata.labels]) {
      expect(labels).toMatchObject({
        'app.kubernetes.io/name': 'mailu-front',
        'app.kubernetes.io/component': 'front',
      });
    }
    expect(deployment.metadata.namespace).toBe('test-mailu');
    expect(service.metadata.namespace).toBe('test-mailu');
  });

  test('applies configured resources', () => {
    const { container } = synth({
      ...baseConfig,
      resources: { front: { requests: { cpu: '10m', memory: '64Mi' }, limits: { cpu: '100m', memory: '128Mi' } } },
    });
    expect(container.resources.requests).toEqual({ cpu: '10m', memory: '64Mi' });
    expect(container.resources.limits).toEqual({ cpu: '100m', memory: '128Mi' });
  });
});
