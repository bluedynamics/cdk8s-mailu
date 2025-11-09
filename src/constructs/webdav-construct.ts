import { Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';
import { parseMemorySize, parseCpuMillis, parseStorageSize } from '../utils/resource-parser';

export interface WebdavConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly sharedConfigMap: kplus.ConfigMap;
}

/**
 * Webdav Construct - Radicale CalDAV/CardDAV server
 *
 * The Webdav component provides:
 * - CalDAV server for calendar synchronization
 * - CardDAV server for contacts synchronization
 * - Standards-compliant DAV protocol support
 * - Integration with email accounts for unified management
 *
 * Components:
 * - Deployment (Radicale server)
 * - Service exposing HTTP port 5232
 * - PVC for calendars and contacts storage
 */
export class WebdavConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;
  public readonly pvc: kplus.PersistentVolumeClaim;

  constructor(scope: Construct, id: string, props: WebdavConstructProps) {
    super(scope, id);

    const { config, namespace, sharedConfigMap } = props;

    // Create PersistentVolumeClaim for Radicale data
    this.pvc = new kplus.PersistentVolumeClaim(this, 'pvc', {
      metadata: {
        namespace: namespace.name,
      },
      storage: parseStorageSize(config.storage?.webdav?.size || '5Gi'),
      storageClassName: config.storage?.webdav?.storageClass || config.storage?.storageClass,
      accessModes: [kplus.PersistentVolumeAccessMode.READ_WRITE_ONCE],
    });

    // Create Deployment
    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-webdav',
          'app.kubernetes.io/component': 'webdav',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      replicas: 1,
      podMetadata: {
        labels: {
          'app.kubernetes.io/name': 'mailu-webdav',
          'app.kubernetes.io/component': 'webdav',
        },
      },
      securityContext: {
        // Mailu containers run as root for privileged operations
        ensureNonRoot: false,
      },
    });

    // Configure container
    const container = this.deployment.addContainer({
      name: 'webdav',
      image: `${config.images?.registry || 'ghcr.io/mailu'}/radicale:${config.images?.tag || '2024.06'}`,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      resources: config.resources?.webdav
        ? {
          cpu: {
            request: parseCpuMillis(config.resources.webdav.requests?.cpu || '100m'),
            limit: config.resources.webdav.limits?.cpu
              ? parseCpuMillis(config.resources.webdav.limits.cpu)
              : undefined,
          },
          memory: {
            request: parseMemorySize(config.resources.webdav.requests?.memory || '256Mi'),
            limit: config.resources.webdav.limits?.memory
              ? parseMemorySize(config.resources.webdav.limits.memory)
              : undefined,
          },
        }
        : undefined,
      ports: [
        {
          name: 'http',
          number: 5232,
          protocol: kplus.Protocol.TCP,
        },
      ],
      // HTTP liveness probe on Radicale's health endpoint
      liveness: kplus.Probe.fromHttpGet('/', {
        port: 5232,
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(30),
        timeoutSeconds: Duration.seconds(5),
        failureThreshold: 3,
      }),
      // HTTP readiness probe
      readiness: kplus.Probe.fromHttpGet('/', {
        port: 5232,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(10),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
    });

    // Add environment variables from shared ConfigMap
    container.env.copyFrom(kplus.Env.fromConfigMap(sharedConfigMap));

    // Mount PVC for data storage
    container.mount('/data', kplus.Volume.fromPersistentVolumeClaim(this, 'data-volume', this.pvc));

    // Create Service
    this.service = new kplus.Service(this, 'service', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-webdav',
          'app.kubernetes.io/component': 'webdav',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      type: kplus.ServiceType.CLUSTER_IP,
      selector: this.deployment,
      ports: [
        {
          name: 'http',
          port: 5232,
          targetPort: 5232,
          protocol: kplus.Protocol.TCP,
        },
      ],
    });
  }
}
