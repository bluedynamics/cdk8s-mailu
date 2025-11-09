import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-28';
import { MailuChartConfig } from '../src/config';
import { WebmailConstruct } from '../src/constructs/webmail-construct';

describe('WebmailConstruct', () => {
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
        webmail: {
          size: '5Gi',
        },
      },
    };
  });

  test('creates all required resources', () => {
    const construct = new WebmailConstruct(chart, 'webmail', {
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
    expect(deployments[0].metadata.labels['app.kubernetes.io/name']).toBe('mailu-webmail');
    expect(deployments[0].metadata.labels['app.kubernetes.io/component']).toBe('webmail');

    // Should create Service
    const services = manifests.filter(m => m.kind === 'Service');
    expect(services).toHaveLength(1);
    expect(services[0].spec.type).toBe('ClusterIP');
    expect(services[0].spec.ports[0].port).toBe(80);
  });

  test('configures container with correct image', () => {
    new WebmailConstruct(chart, 'webmail', {
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

    expect(deployment?.spec.template.spec.containers[0].image).toBe('ghcr.io/mailu/webmail:2024.06');
  });

  test('configures HTTP health probes', () => {
    new WebmailConstruct(chart, 'webmail', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Liveness probe
    expect(container.livenessProbe).toBeDefined();
    expect(container.livenessProbe.httpGet.path).toBe('/sso.php');
    expect(container.livenessProbe.httpGet.port).toBe(80);
    expect(container.livenessProbe.initialDelaySeconds).toBe(30);

    // Readiness probe
    expect(container.readinessProbe).toBeDefined();
    expect(container.readinessProbe.httpGet.path).toBe('/sso.php');
    expect(container.readinessProbe.initialDelaySeconds).toBe(10);
  });

  test('configures environment variables from secrets', () => {
    new WebmailConstruct(chart, 'webmail', {
      config,
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

    expect(dbUser?.valueFrom?.secretKeyRef?.name).toBe('postgres-secret');
    expect(dbPw?.valueFrom?.secretKeyRef?.name).toBe('postgres-secret');
    expect(secretKey?.valueFrom?.secretKeyRef?.name).toBe('test-secret-key');

    // Check for ConfigMap environment variables
    const envFrom = container.envFrom;
    expect(envFrom).toHaveLength(1);
    expect(envFrom[0].configMapRef).toBeDefined();
  });

  test('mounts PVC for Roundcube data', () => {
    new WebmailConstruct(chart, 'webmail', {
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
    new WebmailConstruct(chart, 'webmail', {
      config: {
        ...config,
        resources: {
          webmail: {
            requests: { cpu: '100m', memory: '256Mi' },
            limits: { cpu: '500m', memory: '512Mi' },
          },
        },
      },
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    expect(container.resources.requests.cpu).toBe('100m');
    expect(container.resources.requests.memory).toBe('256Mi');
    expect(container.resources.limits.cpu).toBe('500m');
    expect(container.resources.limits.memory).toBe('512Mi');
  });

  test('uses auto-generated names for resources', () => {
    new WebmailConstruct(chart, 'webmail', {
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
    expect(pvc?.metadata.name).toMatch(/webmail-pvc-/);
    expect(deployment?.metadata.name).toMatch(/webmail-deployment-/);
    expect(service?.metadata.name).toMatch(/webmail-service-/);

    // Names should not be bare 'webmail'
    expect(pvc?.metadata.name).not.toBe('webmail');
    expect(deployment?.metadata.name).not.toBe('webmail');
    expect(service?.metadata.name).not.toBe('webmail');
  });
});
