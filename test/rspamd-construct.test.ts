import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { MailuChartConfig } from '../src/config';
import { RspamdConstruct } from '../src/constructs/rspamd-construct';

describe('RspamdConstruct', () => {
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
        rspamd: {
          size: '5Gi',
        },
      },
    };
  });

  test('creates all required resources', () => {
    const construct = new RspamdConstruct(chart, 'rspamd', {
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
    expect(deployments[0].metadata.labels['app.kubernetes.io/name']).toBe('mailu-rspamd');
    expect(deployments[0].metadata.labels['app.kubernetes.io/component']).toBe('rspamd');

    // Should create Service with all required ports
    const services = manifests.filter(m => m.kind === 'Service');
    expect(services).toHaveLength(1);
    expect(services[0].spec.type).toBe('ClusterIP');
    expect(services[0].spec.ports).toHaveLength(3);
    expect(services[0].spec.ports[0].port).toBe(11332); // milter
    expect(services[0].spec.ports[1].port).toBe(11333); // fuzzy
    expect(services[0].spec.ports[2].port).toBe(11334); // rspamd
  });

  test('configures container with correct image', () => {
    new RspamdConstruct(chart, 'rspamd', {
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

    expect(deployment?.spec.template.spec.containers[0].image).toBe('ghcr.io/mailu/rspamd:2024.06');
  });

  test('configures HTTP health probes', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Liveness probe
    expect(container.livenessProbe).toBeDefined();
    expect(container.livenessProbe.httpGet.path).toBe('/ping');
    expect(container.livenessProbe.httpGet.port).toBe(11334);
    expect(container.livenessProbe.initialDelaySeconds).toBe(30);

    // Readiness probe
    expect(container.readinessProbe).toBeDefined();
    expect(container.readinessProbe.httpGet.path).toBe('/ping');
    expect(container.readinessProbe.initialDelaySeconds).toBe(10);
  });

  test('configures environment variables from secrets', () => {
    new RspamdConstruct(chart, 'rspamd', {
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

  test('mounts PVC for learned data', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find(m => m.kind === 'Deployment');
    const container = deployment?.spec.template.spec.containers[0];

    // Check rspamd container volume mounts
    // PVC + worker-controller.inc + overrides + options.inc
    const mountPaths = container.volumeMounts.map((v: any) => v.mountPath);
    expect(mountPaths).toContain('/var/lib/rspamd');
    expect(mountPaths).toContain('/conf/worker-controller.inc');
    expect(mountPaths).toContain('/overrides');
    expect(mountPaths).toContain('/conf/options.inc');

    // Check volume definitions (PVC + multiple ConfigMaps + Unbound config)
    const volumes = deployment?.spec.template.spec.volumes;
    expect(volumes.some((v: any) => v.persistentVolumeClaim !== undefined)).toBe(true);
    expect(volumes.filter((v: any) => v.configMap !== undefined).length).toBeGreaterThanOrEqual(3);
  });

  test('uses auto-generated names for resources', () => {
    new RspamdConstruct(chart, 'rspamd', {
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
    expect(pvc?.metadata.name).toMatch(/rspamd-pvc-/);
    expect(deployment?.metadata.name).toMatch(/rspamd-deployment-/);
    expect(service?.metadata.name).toMatch(/rspamd-service-/);

    // Names should not be bare 'rspamd'
    expect(pvc?.metadata.name).not.toBe('rspamd');
    expect(deployment?.metadata.name).not.toBe('rspamd');
    expect(service?.metadata.name).not.toBe('rspamd');
  });

  // --- Rspamd overrides ConfigMap tests ---

  test('creates rspamd overrides ConfigMap with spam filter configuration', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const configMaps = manifests.filter((m: any) => m.kind === 'ConfigMap');

    // Find the overrides ConfigMap (has actions.conf key)
    const overridesCm = configMaps.find(
      (cm: any) => cm.data?.['actions.conf'] !== undefined,
    );
    expect(overridesCm).toBeDefined();

    // Should contain all override files
    expect(overridesCm.data['actions.conf']).toBeDefined();
    expect(overridesCm.data['classifier-bayes.conf']).toBeDefined();
    expect(overridesCm.data['fuzzy_check.conf']).toBeDefined();
    expect(overridesCm.data['rbl.conf']).toBeDefined();
  });

  test('overrides ConfigMap contains stricter thresholds', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const configMaps = manifests.filter((m: any) => m.kind === 'ConfigMap');
    const overridesCm = configMaps.find(
      (cm: any) => cm.data?.['actions.conf'] !== undefined,
    );

    // Stricter thresholds than defaults
    expect(overridesCm.data['actions.conf']).toContain('reject = 12');
    expect(overridesCm.data['actions.conf']).toContain('add_header = 5');
    expect(overridesCm.data['actions.conf']).toContain('greylist = 3');
  });

  test('overrides ConfigMap contains remote fuzzy server configuration', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const configMaps = manifests.filter((m: any) => m.kind === 'ConfigMap');
    const overridesCm = configMaps.find(
      (cm: any) => cm.data?.['fuzzy_check.conf'] !== undefined,
    );

    // Remote rspamd.com fuzzy servers
    expect(overridesCm.data['fuzzy_check.conf']).toContain('fuzzy1.rspamd.com');
    expect(overridesCm.data['fuzzy_check.conf']).toContain('fuzzy2.rspamd.com');
  });

  test('overrides ConfigMap contains RBL configuration', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const configMaps = manifests.filter((m: any) => m.kind === 'ConfigMap');
    const overridesCm = configMaps.find(
      (cm: any) => cm.data?.['rbl.conf'] !== undefined,
    );

    // Spamhaus ZEN and DBL
    expect(overridesCm.data['rbl.conf']).toContain('zen.spamhaus.org');
    expect(overridesCm.data['rbl.conf']).toContain('dbl.spamhaus.org');
    // Barracuda and Spamcop
    expect(overridesCm.data['rbl.conf']).toContain('b.barracudacentral.org');
    expect(overridesCm.data['rbl.conf']).toContain('bl.spamcop.net');
  });

  test('mounts overrides ConfigMap to rspamd container', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find((m: any) => m.kind === 'Deployment');
    const rspamdContainer = deployment?.spec.template.spec.containers.find(
      (c: any) => c.name === 'rspamd',
    );

    // Overrides should be mounted
    const mountPaths = rspamdContainer.volumeMounts.map((v: any) => v.mountPath);
    expect(mountPaths).toContain('/overrides');
  });

  // --- Unbound DNS sidecar tests ---

  test('adds Unbound DNS sidecar container', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find((m: any) => m.kind === 'Deployment');
    const containers = deployment?.spec.template.spec.containers;

    // Should have 2 containers: rspamd + unbound
    expect(containers).toHaveLength(2);

    const unboundContainer = containers.find((c: any) => c.name === 'unbound');
    expect(unboundContainer).toBeDefined();
    expect(unboundContainer.image).toMatch(/unbound/);
  });

  test('Unbound sidecar has health probes', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find((m: any) => m.kind === 'Deployment');
    const unboundContainer = deployment?.spec.template.spec.containers.find(
      (c: any) => c.name === 'unbound',
    );

    expect(unboundContainer.livenessProbe).toBeDefined();
    expect(unboundContainer.readinessProbe).toBeDefined();
  });

  test('creates Unbound ConfigMap with correct DNS configuration', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const configMaps = manifests.filter((m: any) => m.kind === 'ConfigMap');

    // Find the unbound ConfigMap
    const unboundCm = configMaps.find(
      (cm: any) => cm.data?.['unbound.conf'] !== undefined,
    );
    expect(unboundCm).toBeDefined();

    // Must disable QNAME minimization for RBL compatibility
    expect(unboundCm.data['unbound.conf']).toContain('qname-minimisation: no');

    // Must allow private-domain responses from RBL providers
    expect(unboundCm.data['unbound.conf']).toContain('private-domain: "zen.spamhaus.org"');
    expect(unboundCm.data['unbound.conf']).toContain('private-domain: "dbl.spamhaus.org"');

    // Must forward .cluster.local to kube-dns
    expect(unboundCm.data['unbound.conf']).toContain('cluster.local');

    // Must exempt cluster.local from rebind protection: the base image sets
    // private-address 10.0.0.0/8, which strips Service ClusterIPs from
    // answers and breaks DKIM key lookup against the admin vault
    expect(unboundCm.data['unbound.conf']).toContain(
      'private-domain: "cluster.local."',
    );
  });

  test('configures rspamd DNS to use Unbound sidecar', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const configMaps = manifests.filter((m: any) => m.kind === 'ConfigMap');

    // Find the DNS override ConfigMap for rspamd
    const dnsOverrideCm = configMaps.find(
      (cm: any) => cm.data?.['options.inc'] !== undefined,
    );
    expect(dnsOverrideCm).toBeDefined();

    // Rspamd should be configured to use localhost (Unbound sidecar)
    expect(dnsOverrideCm.data['options.inc']).toContain('127.0.0.1');
  });

  test('mounts DNS override options.inc to rspamd container', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find((m: any) => m.kind === 'Deployment');
    const rspamdContainer = deployment?.spec.template.spec.containers.find(
      (c: any) => c.name === 'rspamd',
    );

    // DNS override options.inc should be mounted
    const mountPaths = rspamdContainer.volumeMounts.map((v: any) => v.mountPath);
    expect(mountPaths).toContain('/conf/options.inc');
  });

  test('mounts Unbound configuration to sidecar', () => {
    new RspamdConstruct(chart, 'rspamd', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);
    const deployment = manifests.find((m: any) => m.kind === 'Deployment');
    const unboundContainer = deployment?.spec.template.spec.containers.find(
      (c: any) => c.name === 'unbound',
    );

    // Unbound config should be mounted
    expect(unboundContainer.volumeMounts).toBeDefined();
    const mountPaths = unboundContainer.volumeMounts.map((v: any) => v.mountPath);
    expect(mountPaths).toContain('/config/custom.conf');
  });
});
