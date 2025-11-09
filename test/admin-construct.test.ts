import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { MailuChartConfig } from '../src/config';
import { AdminConstruct } from '../src/constructs/admin-construct';

describe('AdminConstruct', () => {
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
        admin: {
          size: '5Gi',
        },
      },
    };
  });

  test('creates all required resources', () => {
    const construct = new AdminConstruct(chart, 'admin', {
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
    expect(pvcs[0].spec.resources.requests.storage).toBe('5Gi');
    expect(pvcs[0].spec.storageClassName).toBe('standard');

    // Should create Deployment
    const deployments = manifests.filter(m => m.kind === 'Deployment');
    expect(deployments).toHaveLength(1);
    expect(deployments[0].spec.replicas).toBe(1);
    expect(deployments[0].metadata.labels['app.kubernetes.io/name']).toBe('mailu-admin');
    expect(deployments[0].metadata.labels['app.kubernetes.io/component']).toBe('admin');

    // Should create Service
    const services = manifests.filter(m => m.kind === 'Service');
    expect(services).toHaveLength(1);
    expect(services[0].spec.type).toBe('ClusterIP');
    expect(services[0].spec.ports[0].port).toBe(8080); // Admin service on 8080
  });

  test('configures container with correct image', () => {
    new AdminConstruct(chart, 'admin', {
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

    expect(deployment?.spec.template.spec.containers[0].image).toBe('ghcr.io/mailu/admin:2024.06');
  });

  test('configures health probes', () => {
    new AdminConstruct(chart, 'admin', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Liveness probe
    expect(container.livenessProbe).toBeDefined();
    expect(container.livenessProbe.httpGet.path).toBe('/ping'); // Admin uses /ping endpoint
    expect(container.livenessProbe.httpGet.port).toBe(8080); // Admin uses port 8080
    expect(container.livenessProbe.initialDelaySeconds).toBe(30);

    // Readiness probe
    expect(container.readinessProbe).toBeDefined();
    expect(container.readinessProbe.httpGet.path).toBe('/ping'); // Admin uses /ping endpoint
    expect(container.readinessProbe.initialDelaySeconds).toBe(10);
  });

  test('configures environment variables from secrets', () => {
    new AdminConstruct(chart, 'admin', {
      config: {
        ...config,
        secrets: {
          mailuSecretKey: 'test-secret-key',
          initialAdminPassword: 'admin-password-secret',
        },
      },
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Check for secret environment variables
    const envVars = container.env;
    const dbUser = envVars.find((e: any) => e.name === 'DB_USER');
    const dbPw = envVars.find((e: any) => e.name === 'DB_PW');
    const secretKey = envVars.find((e: any) => e.name === 'SECRET_KEY');
    const adminPassword = envVars.find((e: any) => e.name === 'INITIAL_ADMIN_PASSWORD');

    expect(dbUser?.valueFrom?.secretKeyRef?.name).toBe('postgres-secret');
    expect(dbPw?.valueFrom?.secretKeyRef?.name).toBe('postgres-secret');
    expect(secretKey?.valueFrom?.secretKeyRef?.name).toBe('test-secret-key');
    expect(adminPassword?.valueFrom?.secretKeyRef?.name).toBe('admin-password-secret');
  });

  test('mounts PVC for data', () => {
    new AdminConstruct(chart, 'admin', {
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

  test('configures resource requests and limits', () => {
    new AdminConstruct(chart, 'admin', {
      config: {
        ...config,
        resources: {
          admin: {
            requests: { cpu: '200m', memory: '1Gi' },
            limits: { cpu: '1000m', memory: '2Gi' },
          },
        },
      },
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    expect(container.resources.requests.cpu).toBe('200m');
    // Kubernetes converts Gi to Mi (1Gi = 1024Mi)
    expect(container.resources.requests.memory).toBe('1024Mi');
    expect(container.resources.limits.cpu).toBe('1000m');
    expect(container.resources.limits.memory).toBe('2048Mi');
  });

  test('uses auto-generated names for resources', () => {
    new AdminConstruct(chart, 'admin', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);

    // Names should be auto-generated (not hardcoded to 'admin', 'admin-data', etc.)
    const pvc = manifests.find(m => m.kind === 'PersistentVolumeClaim');
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const service = manifests.find(m => m.kind === 'Service');

    // Names should contain the construct path and be unique
    expect(pvc?.metadata.name).toMatch(/admin-pvc-/);
    expect(deployment?.metadata.name).toMatch(/admin-deployment-/);
    expect(service?.metadata.name).toMatch(/admin-service-/);

    // Names should not be the bare 'admin' or 'admin-data'
    expect(pvc?.metadata.name).not.toBe('admin-data');
    expect(deployment?.metadata.name).not.toBe('admin');
    expect(service?.metadata.name).not.toBe('admin');
  });
});
