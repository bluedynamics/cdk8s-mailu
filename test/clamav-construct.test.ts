import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-28';
import { MailuChartConfig } from '../src/config';
import { ClamavConstruct } from '../src/constructs/clamav-construct';

describe('ClamavConstruct', () => {
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
        clamav: {
          size: '15Gi',
        },
      },
    };
  });

  test('creates all required resources', () => {
    const construct = new ClamavConstruct(chart, 'clamav', {
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

    // Should create PersistentVolumeClaim
    const pvcs = manifests.filter(m => m.kind === 'PersistentVolumeClaim');
    expect(pvcs).toHaveLength(1);
    expect(pvcs[0].spec.resources.requests.storage).toBe('15Gi');
    expect(pvcs[0].spec.storageClassName).toBe('standard');

    // Should create Deployment
    const deployments = manifests.filter(m => m.kind === 'Deployment');
    expect(deployments).toHaveLength(1);
    expect(deployments[0].spec.replicas).toBe(1);
    expect(deployments[0].metadata.labels['app.kubernetes.io/name']).toBe('mailu-clamav');
    expect(deployments[0].metadata.labels['app.kubernetes.io/component']).toBe('clamav');

    // Should create Service
    const services = manifests.filter(m => m.kind === 'Service');
    expect(services).toHaveLength(1);
    expect(services[0].spec.type).toBe('ClusterIP');
    expect(services[0].spec.ports[0].port).toBe(3310);
  });

  test('configures container with correct image', () => {
    new ClamavConstruct(chart, 'clamav', {
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

    expect(deployment?.spec.template.spec.containers[0].image).toBe('ghcr.io/mailu/clamav:2024.06');
  });

  test('configures TCP health probes with longer delays', () => {
    new ClamavConstruct(chart, 'clamav', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Liveness probe (ClamAV needs longer initial delay to load signatures)
    expect(container.livenessProbe).toBeDefined();
    expect(container.livenessProbe.tcpSocket.port).toBe(3310);
    expect(container.livenessProbe.initialDelaySeconds).toBe(60); // Longer delay for ClamAV

    // Readiness probe
    expect(container.readinessProbe).toBeDefined();
    expect(container.readinessProbe.tcpSocket.port).toBe(3310);
    expect(container.readinessProbe.initialDelaySeconds).toBe(30);
  });

  test('configures environment variables from secrets', () => {
    new ClamavConstruct(chart, 'clamav', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Check for secret environment variables
    const envVars = container.env;
    const secretKey = envVars.find((e: any) => e.name === 'SECRET_KEY');

    expect(secretKey?.valueFrom?.secretKeyRef?.name).toBe('test-secret-key');

    // Check for ConfigMap environment variables
    const envFrom = container.envFrom;
    expect(envFrom).toHaveLength(1);
    expect(envFrom[0].configMapRef).toBeDefined();
  });

  test('mounts PVC for virus signature data', () => {
    new ClamavConstruct(chart, 'clamav', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Check volume mount
    expect(container.volumeMounts).toHaveLength(1);
    expect(container.volumeMounts[0].mountPath).toBe('/data');

    // Check volume definition
    const volumes = deployment?.spec.template.spec.volumes;
    expect(volumes).toHaveLength(1);
    expect(volumes[0].persistentVolumeClaim).toBeDefined();
  });

  test('configures resource requests and limits for CPU-intensive workload', () => {
    new ClamavConstruct(chart, 'clamav', {
      config: {
        ...config,
        resources: {
          clamav: {
            requests: { cpu: '500m', memory: '2Gi' },
            limits: { cpu: '2000m', memory: '4Gi' },
          },
        },
      },
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    expect(container.resources.requests.cpu).toBe('500m');
    // Kubernetes converts Gi to Mi (2Gi = 2048Mi)
    expect(container.resources.requests.memory).toBe('2048Mi');
    expect(container.resources.limits.cpu).toBe('2000m');
    expect(container.resources.limits.memory).toBe('4096Mi');
  });

  test('uses auto-generated names for resources', () => {
    new ClamavConstruct(chart, 'clamav', {
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
    expect(pvc?.metadata.name).toMatch(/clamav-pvc-/);
    expect(deployment?.metadata.name).toMatch(/clamav-deployment-/);
    expect(service?.metadata.name).toMatch(/clamav-service-/);

    // Names should not be bare 'clamav'
    expect(pvc?.metadata.name).not.toBe('clamav');
    expect(deployment?.metadata.name).not.toBe('clamav');
    expect(service?.metadata.name).not.toBe('clamav');
  });
});
