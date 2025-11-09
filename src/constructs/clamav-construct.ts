import { Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';
import { parseMemorySize, parseCpuMillis, parseStorageSize } from '../utils/resource-parser';

export interface ClamavConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly sharedConfigMap: kplus.ConfigMap;
}

/**
 * ClamAV Construct - Antivirus scanner
 *
 * The ClamAV component provides:
 * - Virus and malware scanning for email attachments
 * - Automatic virus signature database updates
 * - Integration with Rspamd for email scanning
 *
 * Components:
 * - Deployment (single replica for virus scanning)
 * - Service exposing ClamAV daemon port
 * - PVC for virus signature databases (large - 15Gi default)
 *
 * Note: ClamAV uses a single replica since virus scanning is CPU-intensive
 * and multiple instances would duplicate signature database storage.
 */
export class ClamavConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;
  public readonly pvc: kplus.PersistentVolumeClaim;

  constructor(scope: Construct, id: string, props: ClamavConstructProps) {
    super(scope, id);

    const { config, namespace, sharedConfigMap } = props;

    // Create PersistentVolumeClaim for virus signature databases
    this.pvc = new kplus.PersistentVolumeClaim(this, 'pvc', {
      metadata: {
        namespace: namespace.name,
      },
      storage: parseStorageSize(config.storage?.clamav?.size || '15Gi'),
      storageClassName: config.storage?.clamav?.storageClass || config.storage?.storageClass,
      accessModes: [kplus.PersistentVolumeAccessMode.READ_WRITE_ONCE],
    });

    // Create Deployment
    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-clamav',
          'app.kubernetes.io/component': 'clamav',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      replicas: 1,
      podMetadata: {
        labels: {
          'app.kubernetes.io/name': 'mailu-clamav',
          'app.kubernetes.io/component': 'clamav',
        },
      },
      securityContext: {
        // Mailu containers run as root for privileged operations
        ensureNonRoot: false,
      },
    });

    // Configure container
    const container = this.deployment.addContainer({
      name: 'clamav',
      image: `${config.images?.registry || 'ghcr.io/mailu'}/clamav:${config.images?.tag || '2024.06'}`,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      resources: config.resources?.clamav
        ? {
          cpu: {
            request: parseCpuMillis(config.resources.clamav.requests?.cpu || '500m'),
            limit: config.resources.clamav.limits?.cpu
              ? parseCpuMillis(config.resources.clamav.limits.cpu)
              : undefined,
          },
          memory: {
            request: parseMemorySize(config.resources.clamav.requests?.memory || '2Gi'),
            limit: config.resources.clamav.limits?.memory
              ? parseMemorySize(config.resources.clamav.limits.memory)
              : undefined,
          },
        }
        : undefined,
      ports: [
        {
          name: 'clamav',
          number: 3310,
          protocol: kplus.Protocol.TCP,
        },
      ],
      // Health check on ClamAV daemon port
      liveness: kplus.Probe.fromTcpSocket({
        port: 3310,
        initialDelaySeconds: Duration.seconds(60), // ClamAV takes time to load signatures
        periodSeconds: Duration.seconds(30),
        timeoutSeconds: Duration.seconds(5),
        failureThreshold: 3,
      }),
      readiness: kplus.Probe.fromTcpSocket({
        port: 3310,
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(10),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
    });

    // Add environment variables from shared ConfigMap
    container.env.copyFrom(kplus.Env.fromConfigMap(sharedConfigMap));

    // Add Mailu secret key from secret
    const mailuSecret = kplus.Secret.fromSecretName(
      this,
      'mailu-secret',
      config.secrets.mailuSecretKey,
    );
    container.env.addVariable(
      'SECRET_KEY',
      kplus.EnvValue.fromSecretValue({
        secret: mailuSecret,
        key: 'secret-key',
      }),
    );

    // Mount PVC for virus signature databases
    container.mount(
      '/data',
      kplus.Volume.fromPersistentVolumeClaim(this, 'data-volume', this.pvc),
    );

    // Create Service for external access
    this.service = new kplus.Service(this, 'service', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-clamav',
          'app.kubernetes.io/component': 'clamav',
        },
      },
      type: kplus.ServiceType.CLUSTER_IP,
      selector: this.deployment,
      ports: [
        {
          name: 'clamav',
          port: 3310,
          targetPort: 3310,
          protocol: kplus.Protocol.TCP,
        },
      ],
    });
  }
}
