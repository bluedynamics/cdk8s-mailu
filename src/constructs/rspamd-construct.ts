import { Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-28';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';
import { parseMemorySize, parseCpuMillis, parseStorageSize } from '../utils/resource-parser';

export interface RspamdConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly sharedConfigMap: kplus.ConfigMap;
}

/**
 * Rspamd Construct - Spam filtering and antispam engine
 *
 * The Rspamd component provides:
 * - Spam filtering for incoming and outgoing mail
 * - Integration with Postfix for mail scanning
 * - Machine learning for spam detection
 * - DKIM signing
 * - Redis integration for caching and statistics
 *
 * Components:
 * - Deployment with single replica
 * - ClusterIP Service on port 11334 (Rspamd HTTP interface)
 * - PersistentVolumeClaim for learned spam data
 */
export class RspamdConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;
  public readonly pvc: kplus.PersistentVolumeClaim;

  constructor(scope: Construct, id: string, props: RspamdConstructProps) {
    super(scope, id);

    const { config, namespace, sharedConfigMap } = props;

    // Create PersistentVolumeClaim for learned spam data
    this.pvc = new kplus.PersistentVolumeClaim(this, 'pvc', {
      metadata: {
        namespace: namespace.name,
      },
      accessModes: [kplus.PersistentVolumeAccessMode.READ_WRITE_ONCE],
      storage: parseStorageSize(config.storage?.rspamd?.size || '5Gi'),
      storageClassName: config.storage?.storageClass,
    });

    // Create Deployment
    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-rspamd',
          'app.kubernetes.io/component': 'rspamd',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      replicas: 1,
      podMetadata: {
        labels: {
          'app.kubernetes.io/name': 'mailu-rspamd',
          'app.kubernetes.io/component': 'rspamd',
        },
      },
    });

    // Configure container
    const container = this.deployment.addContainer({
      name: 'rspamd',
      image: `${config.images?.registry || 'ghcr.io/mailu'}/rspamd:${config.images?.tag || '2024.06'}`,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      portNumber: 11334,
      securityContext: {
        ensureNonRoot: false, // Rspamd needs to run as root
        readOnlyRootFilesystem: false,
      },
      resources: config.resources?.rspamd
        ? {
          cpu: {
            request: parseCpuMillis(config.resources.rspamd.requests?.cpu || '100m'),
            limit: config.resources.rspamd.limits?.cpu
              ? parseCpuMillis(config.resources.rspamd.limits.cpu)
              : undefined,
          },
          memory: {
            request: parseMemorySize(config.resources.rspamd.requests?.memory || '512Mi'),
            limit: config.resources.rspamd.limits?.memory
              ? parseMemorySize(config.resources.rspamd.limits.memory)
              : undefined,
          },
        }
        : undefined,
      // Health check on HTTP interface
      liveness: kplus.Probe.fromHttpGet('/ping', {
        port: 11334,
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(10),
        timeoutSeconds: Duration.seconds(5),
        failureThreshold: 3,
      }),
      readiness: kplus.Probe.fromHttpGet('/ping', {
        port: 11334,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(5),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
    });

    // Add environment variables from shared ConfigMap
    container.env.copyFrom(kplus.Env.fromConfigMap(sharedConfigMap));

    // Add Mailu secret key from secret
    const mailuSecret = kplus.Secret.fromSecretName(this, 'mailu-secret', config.secrets.mailuSecretKey);
    container.env.addVariable(
      'SECRET_KEY',
      kplus.EnvValue.fromSecretValue({
        secret: mailuSecret,
        key: 'secret-key',
      }),
    );

    // Mount PVC for learned data and configuration
    container.mount('/var/lib/rspamd', kplus.Volume.fromPersistentVolumeClaim(this, 'data-volume', this.pvc));

    // Create Service
    this.service = new kplus.Service(this, 'service', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-rspamd',
          'app.kubernetes.io/component': 'rspamd',
        },
      },
      type: kplus.ServiceType.CLUSTER_IP,
      selector: this.deployment,
      ports: [
        {
          name: 'rspamd',
          port: 11334,
          targetPort: 11334,
          protocol: kplus.Protocol.TCP,
        },
      ],
    });
  }
}
