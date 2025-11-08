import { Size, Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-28';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';

export interface AdminConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly sharedConfigMap: kplus.ConfigMap;
}

/**
 * Admin Construct - Mailu administration web interface
 *
 * The Admin component provides:
 * - Web UI for domain/user/alias management
 * - API for programmatic management
 * - DKIM key generation and storage
 * - Initial account creation
 *
 * Components:
 * - Deployment with single replica
 * - ClusterIP Service on port 80
 * - PersistentVolumeClaim for data and DKIM keys
 */
export class AdminConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;
  public readonly pvc: kplus.PersistentVolumeClaim;

  constructor(scope: Construct, id: string, props: AdminConstructProps) {
    super(scope, id);

    const { config, namespace, sharedConfigMap } = props;

    // Create PersistentVolumeClaim for admin data and DKIM keys
    this.pvc = new kplus.PersistentVolumeClaim(this, 'pvc', {
      metadata: {
        namespace: namespace.name,
      },
      accessModes: [kplus.PersistentVolumeAccessMode.READ_WRITE_ONCE],
      storage: Size.gibibytes(parseInt(config.storage?.admin?.size?.replace('Gi', '') || '5')),
      storageClassName: config.storage?.storageClass,
    });

    // Create Deployment
    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-admin',
          'app.kubernetes.io/component': 'admin',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      replicas: 1,
      podMetadata: {
        labels: {
          'app.kubernetes.io/name': 'mailu-admin',
          'app.kubernetes.io/component': 'admin',
        },
      },
    });

    // Configure container
    const container = this.deployment.addContainer({
      name: 'admin',
      image: `${config.images?.registry || 'ghcr.io/mailu'}/admin:${config.images?.tag || '2024.06'}`,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      portNumber: 80,
      securityContext: {
        ensureNonRoot: false, // Mailu containers run as root
        readOnlyRootFilesystem: false,
      },
      resources: config.resources?.admin
        ? {
          cpu: {
            request: kplus.Cpu.millis(
              parseInt(config.resources.admin.requests?.cpu?.replace('m', '') || '100'),
            ),
            limit: config.resources.admin.limits?.cpu
              ? kplus.Cpu.millis(parseInt(config.resources.admin.limits.cpu.replace('m', '') || '500'))
              : undefined,
          },
          memory: {
            request: this.parseMemorySize(config.resources.admin.requests?.memory || '512Mi'),
            limit: config.resources.admin.limits?.memory
              ? this.parseMemorySize(config.resources.admin.limits.memory)
              : undefined,
          },
        }
        : undefined,
      // Add health checks
      liveness: kplus.Probe.fromHttpGet('/health', {
        port: 80,
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(10),
        timeoutSeconds: Duration.seconds(5),
        failureThreshold: 3,
      }),
      readiness: kplus.Probe.fromHttpGet('/health', {
        port: 80,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(5),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
    });

    // Add environment variables from shared ConfigMap
    container.env.copyFrom(kplus.Env.fromConfigMap(sharedConfigMap));

    // Add database credentials from secret
    if (config.database.type === 'postgresql' && config.database.postgresql) {
      const dbSecret = kplus.Secret.fromSecretName(
        this,
        'db-secret',
        config.database.postgresql.secretName,
      );
      container.env.addVariable(
        'DB_USER',
        kplus.EnvValue.fromSecretValue({
          secret: dbSecret,
          key: config.database.postgresql.secretKeys?.username || 'username',
        }),
      );
      container.env.addVariable(
        'DB_PW',
        kplus.EnvValue.fromSecretValue({
          secret: dbSecret,
          key: config.database.postgresql.secretKeys?.password || 'password',
        }),
      );
    }

    // Add Mailu secret key from secret
    const mailuSecret = kplus.Secret.fromSecretName(this, 'mailu-secret', config.secrets.mailuSecretKey);
    container.env.addVariable(
      'SECRET_KEY',
      kplus.EnvValue.fromSecretValue({
        secret: mailuSecret,
        key: 'secret-key',
      }),
    );

    // Add initial admin password if configured
    if (config.secrets.initialAdminPassword) {
      const adminPasswordSecret = kplus.Secret.fromSecretName(
        this,
        'admin-password-secret',
        config.secrets.initialAdminPassword,
      );
      container.env.addVariable(
        'INITIAL_ADMIN_PASSWORD',
        kplus.EnvValue.fromSecretValue({
          secret: adminPasswordSecret,
          key: 'password',
        }),
      );

      // Add initial admin account configuration
      if (config.mailu?.initialAccount) {
        const account = config.mailu.initialAccount;
        container.env.addVariable('INITIAL_ADMIN_ACCOUNT', kplus.EnvValue.fromValue(account.username));
        container.env.addVariable(
          'INITIAL_ADMIN_DOMAIN',
          kplus.EnvValue.fromValue(account.domain || config.domain),
        );
        container.env.addVariable('INITIAL_ADMIN_MODE', kplus.EnvValue.fromValue(account.mode || 'update'));
      }
    }

    // Add API token if configured
    if (config.mailu?.apiEnabled && config.secrets.apiToken) {
      const apiTokenSecret = kplus.Secret.fromSecretName(this, 'api-token-secret', config.secrets.apiToken);
      container.env.addVariable(
        'API_TOKEN',
        kplus.EnvValue.fromSecretValue({
          secret: apiTokenSecret,
          key: 'token',
        }),
      );
    }

    // Mount PVC for data and DKIM keys
    container.mount('/data', kplus.Volume.fromPersistentVolumeClaim(this, 'data-volume', this.pvc));

    // Create Service
    this.service = new kplus.Service(this, 'service', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-admin',
          'app.kubernetes.io/component': 'admin',
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

  /**
   * Parse memory size string (e.g., "512Mi", "1Gi") to Size object
   */
  private parseMemorySize(sizeStr: string): Size {
    if (sizeStr.endsWith('Gi')) {
      return Size.gibibytes(parseInt(sizeStr.replace('Gi', '')));
    } else if (sizeStr.endsWith('Mi')) {
      return Size.mebibytes(parseInt(sizeStr.replace('Mi', '')));
    }
    // Default to mebibytes if no unit specified
    return Size.mebibytes(parseInt(sizeStr));
  }
}
