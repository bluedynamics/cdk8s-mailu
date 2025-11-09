import { Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';
import { parseMemorySize, parseCpuMillis, parseStorageSize } from '../utils/resource-parser';

export interface WebmailConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly sharedConfigMap: kplus.ConfigMap;
  readonly frontService?: kplus.Service; // Reference to front service for inter-component communication
}

/**
 * Webmail Construct - Roundcube webmail interface
 *
 * The Webmail component provides:
 * - Web-based email client (Roundcube)
 * - Access to mailboxes via IMAP
 * - Email composition and sending via SMTP
 * - User-friendly interface for email management
 *
 * Components:
 * - Deployment (Roundcube application)
 * - Service exposing HTTP port 80
 * - PVC for SQLite database and user settings
 */
export class WebmailConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;
  public readonly pvc: kplus.PersistentVolumeClaim;

  constructor(scope: Construct, id: string, props: WebmailConstructProps) {
    super(scope, id);

    const { config, namespace, sharedConfigMap } = props;

    // Create PersistentVolumeClaim for Roundcube data
    this.pvc = new kplus.PersistentVolumeClaim(this, 'pvc', {
      metadata: {
        namespace: namespace.name,
      },
      storage: parseStorageSize(config.storage?.webmail?.size || '5Gi'),
      storageClassName: config.storage?.webmail?.storageClass || config.storage?.storageClass,
      accessModes: [kplus.PersistentVolumeAccessMode.READ_WRITE_ONCE],
    });

    // Create Deployment
    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-webmail',
          'app.kubernetes.io/component': 'webmail',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      replicas: 1,
      podMetadata: {
        labels: {
          'app.kubernetes.io/name': 'mailu-webmail',
          'app.kubernetes.io/component': 'webmail',
        },
      },
      securityContext: {
        // Mailu containers run as root for privileged operations
        ensureNonRoot: false,
      },
    });

    // Configure container
    const container = this.deployment.addContainer({
      name: 'webmail',
      image: `${config.images?.registry || 'ghcr.io/mailu'}/webmail:${config.images?.tag || '2024.06'}`,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      resources: config.resources?.webmail
        ? {
          cpu: {
            request: parseCpuMillis(config.resources.webmail.requests?.cpu || '100m'),
            limit: config.resources.webmail.limits?.cpu
              ? parseCpuMillis(config.resources.webmail.limits.cpu)
              : undefined,
          },
          memory: {
            request: parseMemorySize(config.resources.webmail.requests?.memory || '256Mi'),
            limit: config.resources.webmail.limits?.memory
              ? parseMemorySize(config.resources.webmail.limits.memory)
              : undefined,
          },
        }
        : undefined,
      ports: [
        {
          name: 'http',
          number: 80,
          protocol: kplus.Protocol.TCP,
        },
      ],
      // Health check - use TCP probe since webmail only accepts requests through front proxy
      liveness: kplus.Probe.fromTcpSocket({
        port: 80,
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(10),
        timeoutSeconds: Duration.seconds(5),
        failureThreshold: 3,
      }),
      readiness: kplus.Probe.fromTcpSocket({
        port: 80,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(5),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
    });

    // Add environment variables from shared ConfigMap
    container.env.copyFrom(kplus.Env.fromConfigMap(sharedConfigMap));

    // Add database credentials from PostgreSQL secret
    if (config.database.type === 'postgresql' && config.database.postgresql) {
      const dbSecret = kplus.Secret.fromSecretName(
        this,
        'db-secret',
        config.database.postgresql.secretName,
      );

      const usernameKey = config.database.postgresql.secretKeys?.username || 'username';
      const passwordKey = config.database.postgresql.secretKeys?.password || 'password';

      container.env.addVariable(
        'DB_USER',
        kplus.EnvValue.fromSecretValue({ secret: dbSecret, key: usernameKey }),
      );
      container.env.addVariable(
        'DB_PW',
        kplus.EnvValue.fromSecretValue({ secret: dbSecret, key: passwordKey }),
      );
    }

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

    // Add front service address for inter-component communication
    if (props.frontService) {
      container.env.addVariable(
        'FRONT_ADDRESS',
        kplus.EnvValue.fromValue(props.frontService.name),
      );
    }

    // Mount PVC for Roundcube data
    container.mount(
      '/data',
      kplus.Volume.fromPersistentVolumeClaim(this, 'data-volume', this.pvc),
    );

    // Create Service
    this.service = new kplus.Service(this, 'service', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-webmail',
          'app.kubernetes.io/component': 'webmail',
        },
      },
      type: kplus.ServiceType.CLUSTER_IP,
      selector: this.deployment,
      ports: [
        {
          name: 'http',
          port: 80,
          targetPort: 80,
          protocol: kplus.Protocol.TCP,
        },
      ],
    });
  }
}
