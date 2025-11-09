import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { MailuChartConfig } from '../src/config';
import { DovecotConstruct } from '../src/constructs/dovecot-construct';

describe('DovecotConstruct', () => {
  let chart: any;
  let namespace: kplus.Namespace;
  let sharedConfigMap: kplus.ConfigMap;
  let config: MailuChartConfig;

  beforeEach(() => {
    chart = Testing.chart();

    namespace = new kplus.Namespace(chart, 'test-namespace', {
      metadata: { name: 'test-mailu' },
    });

    sharedConfigMap = new kplus.ConfigMap(chart, 'test-config', {
      metadata: { namespace: namespace.name },
      data: {
        DOMAIN: 'test.example.com',
        SUBNET: '10.42.0.0/16',
      },
    });

    config = {
      domain: 'test.example.com',
      hostnames: ['mail.test.example.com'],
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
      storage: {
        storageClass: 'standard',
        dovecot: {
          size: '50Gi',
        },
      },
    };
  });

  test('creates all required resources', () => {
    const construct = new DovecotConstruct(chart, 'dovecot', {
      config,
      namespace,
      sharedConfigMap,
    });

    // Verify construct exposes expected properties
    expect(construct.deployment).toBeDefined();
    expect(construct.service).toBeDefined();
    expect(construct.pvc).toBeDefined();

    // Synthesize and verify manifests
    const manifests = Testing.synth(chart);

    // Should create PersistentVolumeClaim (largest volume for mailboxes)
    const pvcs = manifests.filter(m => m.kind === 'PersistentVolumeClaim');
    expect(pvcs).toHaveLength(1);
    expect(pvcs[0].spec.resources.requests.storage).toBe('50Gi');
    expect(pvcs[0].spec.storageClassName).toBe('standard');

    // Should create Deployment
    const deployments = manifests.filter(m => m.kind === 'Deployment');
    expect(deployments).toHaveLength(1);
    expect(deployments[0].spec.replicas).toBe(1);
    expect(deployments[0].metadata.labels['app.kubernetes.io/name']).toBe('mailu-dovecot');
    expect(deployments[0].metadata.labels['app.kubernetes.io/component']).toBe('dovecot');

    // Should create Service
    const services = manifests.filter(m => m.kind === 'Service');
    expect(services).toHaveLength(1);
    expect(services[0].spec.type).toBe('ClusterIP');
  });

  test('exposes all IMAP and POP3 ports', () => {
    new DovecotConstruct(chart, 'dovecot', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const service = manifests.find(m => m.kind === 'Service');

    // Check all expected ports are defined
    const portNames = service?.spec.ports.map((p: any) => p.name).sort();
    expect(portNames).toEqual(['imap', 'imaps', 'pop3', 'pop3s']);

    // Verify specific port configurations
    const ports = service?.spec.ports;
    const imapPort = ports.find((p: any) => p.name === 'imap');
    expect(imapPort?.port).toBe(143);

    const imapsPort = ports.find((p: any) => p.name === 'imaps');
    expect(imapsPort?.port).toBe(993);

    const pop3Port = ports.find((p: any) => p.name === 'pop3');
    expect(pop3Port?.port).toBe(110);

    const pop3sPort = ports.find((p: any) => p.name === 'pop3s');
    expect(pop3sPort?.port).toBe(995);
  });

  test('configures container with correct image', () => {
    new DovecotConstruct(chart, 'dovecot', {
      config: {
        ...config,
        images: {
          registry: 'ghcr.io/mailu',
          tag: '2024.06',
        },
      },
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');

    expect(deployment?.spec.template.spec.containers[0].image).toBe('ghcr.io/mailu/dovecot:2024.06');
  });

  test('configures TCP health probes', () => {
    new DovecotConstruct(chart, 'dovecot', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Liveness probe
    expect(container.livenessProbe).toBeDefined();
    expect(container.livenessProbe.tcpSocket.port).toBe(143);
    expect(container.livenessProbe.initialDelaySeconds).toBe(30);

    // Readiness probe
    expect(container.readinessProbe).toBeDefined();
    expect(container.readinessProbe.tcpSocket.port).toBe(143);
    expect(container.readinessProbe.initialDelaySeconds).toBe(10);
  });

  test('mounts PVC for mailboxes', () => {
    new DovecotConstruct(chart, 'dovecot', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Check volume mount
    expect(container.volumeMounts).toHaveLength(1);
    expect(container.volumeMounts[0].mountPath).toBe('/mail');

    // Check volume definition
    const volumes = deployment?.spec.template.spec.volumes;
    expect(volumes).toHaveLength(1);
    expect(volumes[0].persistentVolumeClaim).toBeDefined();
  });

  test('uses auto-generated names for resources', () => {
    new DovecotConstruct(chart, 'dovecot', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);

    // Names should be auto-generated (not hardcoded)
    const pvc = manifests.find(m => m.kind === 'PersistentVolumeClaim');
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const service = manifests.find(m => m.kind === 'Service');

    // Names should contain the construct path and be unique
    expect(pvc?.metadata.name).toMatch(/dovecot-pvc-/);
    expect(deployment?.metadata.name).toMatch(/dovecot-deployment-/);
    expect(service?.metadata.name).toMatch(/dovecot-service-/);

    // Names should not be bare 'dovecot'
    expect(pvc?.metadata.name).not.toBe('dovecot');
    expect(deployment?.metadata.name).not.toBe('dovecot');
    expect(service?.metadata.name).not.toBe('dovecot');
  });

  test('allows component-specific storage class override', () => {
    new DovecotConstruct(chart, 'dovecot', {
      config: {
        ...config,
        storage: {
          storageClass: 'longhorn', // Global storage class
          dovecot: {
            size: '50Gi',
            storageClass: 'hcloud-volumes', // Override for dovecot
          },
        },
      },
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const pvc = manifests.find(m => m.kind === 'PersistentVolumeClaim');

    expect(pvc?.spec.resources.requests.storage).toBe('50Gi');
    expect(pvc?.spec.storageClassName).toBe('hcloud-volumes');
  });
});
