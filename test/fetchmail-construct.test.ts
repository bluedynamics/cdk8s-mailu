import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { MailuChartConfig } from '../src/config';
import { FetchmailConstruct } from '../src/constructs/fetchmail-construct';

describe('FetchmailConstruct', () => {
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
    };
  });

  test('creates all required resources', () => {
    const construct = new FetchmailConstruct(chart, 'fetchmail', {
      config,
      namespace,
      sharedConfigMap,
    });

    // Verify construct exposes expected properties
    expect(construct.deployment).toBeDefined();

    // Synthesize and verify manifests
    const manifests = Testing.synth(chart);

    // Should create Deployment only (no Service or PVC)
    const deployments = manifests.filter(m => m.kind === 'Deployment');
    expect(deployments).toHaveLength(1);
    expect(deployments[0].spec.replicas).toBe(1);
    expect(deployments[0].metadata.labels['app.kubernetes.io/name']).toBe('mailu-fetchmail');
    expect(deployments[0].metadata.labels['app.kubernetes.io/component']).toBe('fetchmail');

    // Should NOT create Service
    const services = manifests.filter(m => m.kind === 'Service');
    expect(services).toHaveLength(0);

    // Should NOT create PVC (stateless component)
    const pvcs = manifests.filter(m => m.kind === 'PersistentVolumeClaim');
    expect(pvcs).toHaveLength(0);
  });

  test('configures container with correct image', () => {
    new FetchmailConstruct(chart, 'fetchmail', {
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

    expect(deployment?.spec.template.spec.containers[0].image).toBe('ghcr.io/mailu/fetchmail:2024.06');
  });

  test('configures process-based health probes', () => {
    new FetchmailConstruct(chart, 'fetchmail', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Liveness probe - check if fetchmail process is running
    expect(container.livenessProbe).toBeDefined();
    expect(container.livenessProbe.exec.command).toEqual(['pgrep', '-f', 'fetchmail']);
    expect(container.livenessProbe.initialDelaySeconds).toBe(30);
    expect(container.livenessProbe.periodSeconds).toBe(60);

    // Readiness probe - same as liveness
    expect(container.readinessProbe).toBeDefined();
    expect(container.readinessProbe.exec.command).toEqual(['pgrep', '-f', 'fetchmail']);
    expect(container.readinessProbe.initialDelaySeconds).toBe(10);
    expect(container.readinessProbe.periodSeconds).toBe(10);
  });

  test('configures FETCHMAIL_DELAY environment variable', () => {
    new FetchmailConstruct(chart, 'fetchmail', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Check for fetchmail-specific environment variable
    const envVars = container.env;
    const fetchmailDelay = envVars.find((e: any) => e.name === 'FETCHMAIL_DELAY');

    expect(fetchmailDelay).toBeDefined();
    expect(fetchmailDelay?.value).toBe('600'); // 10 minutes

    // Check for ConfigMap environment variables
    const envFrom = container.envFrom;
    expect(envFrom).toHaveLength(1);
    expect(envFrom[0].configMapRef).toBeDefined();
  });

  test('configures resource requests and limits', () => {
    new FetchmailConstruct(chart, 'fetchmail', {
      config: {
        ...config,
        resources: {
          fetchmail: {
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
    new FetchmailConstruct(chart, 'fetchmail', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);

    // Deployment name should be auto-generated
    const deployment = manifests.find(m => m.kind === 'Deployment');
    expect(deployment?.metadata.name).toMatch(/fetchmail-deployment-/);
    expect(deployment?.metadata.name).not.toBe('fetchmail');
  });

  test('allows custom image registry and tag', () => {
    new FetchmailConstruct(chart, 'fetchmail', {
      config: {
        ...config,
        images: {
          registry: 'registry.example.com/mailu',
          tag: 'latest',
        },
      },
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');

    expect(deployment?.spec.template.spec.containers[0].image).toBe('registry.example.com/mailu/fetchmail:latest');
  });
});
