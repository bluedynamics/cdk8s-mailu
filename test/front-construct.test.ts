import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-28';
import { MailuChartConfig } from '../src/config';
import { FrontConstruct } from '../src/constructs/front-construct';

describe('FrontConstruct', () => {
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

  test('creates deployment and service', () => {
    const construct = new FrontConstruct(chart, 'front', {
      config,
      namespace,
      sharedConfigMap,
    });

    // Verify construct exposes expected properties
    expect(construct.deployment).toBeDefined();
    expect(construct.service).toBeDefined();

    // Synthesize and verify manifests
    const manifests = Testing.synth(chart);

    // Should create Deployment
    const deployments = manifests.filter(m => m.kind === 'Deployment');
    expect(deployments).toHaveLength(1);
    expect(deployments[0].spec.replicas).toBe(1);
    expect(deployments[0].metadata.labels['app.kubernetes.io/name']).toBe('mailu-front');
    expect(deployments[0].metadata.labels['app.kubernetes.io/component']).toBe('front');

    // Should create Service
    const services = manifests.filter(m => m.kind === 'Service');
    expect(services).toHaveLength(1);
    expect(services[0].spec.type).toBe('ClusterIP');
  });

  test('exposes all mail and web protocol ports', () => {
    new FrontConstruct(chart, 'front', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const service = manifests.find(m => m.kind === 'Service');

    // Check all expected ports are defined
    const portNames = service?.spec.ports.map((p: any) => p.name).sort();
    expect(portNames).toEqual([
      'http',
      'https',
      'imap',
      'imaps',
      'pop3',
      'pop3s',
      'smtp',
      'smtps',
      'submission',
    ]);

    // Verify specific port configurations
    const ports = service?.spec.ports;
    const httpPort = ports.find((p: any) => p.name === 'http');
    expect(httpPort?.port).toBe(80);
    expect(httpPort?.targetPort).toBe(80);

    const smtpPort = ports.find((p: any) => p.name === 'smtp');
    expect(smtpPort?.port).toBe(25);

    const imapsPort = ports.find((p: any) => p.name === 'imaps');
    expect(imapsPort?.port).toBe(993);

    const submissionPort = ports.find((p: any) => p.name === 'submission');
    expect(submissionPort?.port).toBe(587);
  });

  test('configures container with correct image', () => {
    new FrontConstruct(chart, 'front', {
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

    expect(deployment?.spec.template.spec.containers[0].image).toBe('ghcr.io/mailu/nginx:2024.06');
  });

  test('configures health probes', () => {
    new FrontConstruct(chart, 'front', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Liveness probe
    expect(container.livenessProbe).toBeDefined();
    expect(container.livenessProbe.httpGet.path).toBe('/health');
    expect(container.livenessProbe.httpGet.port).toBe(80);
    expect(container.livenessProbe.initialDelaySeconds).toBe(30);

    // Readiness probe
    expect(container.readinessProbe).toBeDefined();
    expect(container.readinessProbe.httpGet.path).toBe('/health');
    expect(container.readinessProbe.initialDelaySeconds).toBe(10);
  });

  test('configures environment variables from secrets', () => {
    new FrontConstruct(chart, 'front', {
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
    expect(secretKey?.valueFrom?.secretKeyRef?.key).toBe('secret-key');

    // Check for ConfigMap environment variables
    const envFrom = container.envFrom;
    expect(envFrom).toHaveLength(1);
    expect(envFrom[0].configMapRef).toBeDefined();
  });

  test('configures resource requests and limits', () => {
    new FrontConstruct(chart, 'front', {
      config: {
        ...config,
        resources: {
          front: {
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
    new FrontConstruct(chart, 'front', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);

    // Names should be auto-generated (not hardcoded to 'front')
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const service = manifests.find(m => m.kind === 'Service');

    // Names should contain the construct path and be unique
    expect(deployment?.metadata.name).toMatch(/front-deployment-/);
    expect(service?.metadata.name).toMatch(/front-service-/);

    // Names should not be bare 'front'
    expect(deployment?.metadata.name).not.toBe('front');
    expect(service?.metadata.name).not.toBe('front');
  });
});
