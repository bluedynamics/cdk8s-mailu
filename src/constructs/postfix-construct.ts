import { Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';
import { parseMemorySize, parseCpuMillis, parseStorageSize } from '../utils/resource-parser';

export interface PostfixConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly sharedConfigMap: kplus.ConfigMap;
}

/**
 * Postfix Construct - SMTP server for outgoing and incoming mail
 *
 * The Postfix component provides:
 * - SMTP server for sending and receiving email
 * - Mail queue management
 * - Integration with Rspamd for spam filtering
 * - Integration with Dovecot for local delivery
 * - Integration with Admin for user authentication
 *
 * Components:
 * - Deployment with single replica
 * - ClusterIP Service on port 25 (SMTP)
 * - PersistentVolumeClaim for mail queue
 */
export class PostfixConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;
  public readonly pvc: kplus.PersistentVolumeClaim;

  constructor(scope: Construct, id: string, props: PostfixConstructProps) {
    super(scope, id);

    const { config, namespace, sharedConfigMap } = props;

    // Create PersistentVolumeClaim for mail queue
    this.pvc = new kplus.PersistentVolumeClaim(this, 'pvc', {
      metadata: {
        namespace: namespace.name,
      },
      accessModes: [kplus.PersistentVolumeAccessMode.READ_WRITE_ONCE],
      storage: parseStorageSize(config.storage?.postfix?.size || '5Gi'),
      storageClassName: config.storage?.postfix?.storageClass || config.storage?.storageClass,
    });

    // Create Deployment
    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-postfix',
          'app.kubernetes.io/component': 'postfix',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      replicas: 1,
      podMetadata: {
        labels: {
          'app.kubernetes.io/name': 'mailu-postfix',
          'app.kubernetes.io/component': 'postfix',
        },
      },
      securityContext: {
        // Mailu containers run as root for privileged operations
        ensureNonRoot: false,
      },
    });

    // Configure container
    const container = this.deployment.addContainer({
      name: 'postfix',
      image: `${config.images?.registry || 'ghcr.io/mailu'}/postfix:${config.images?.tag || '2024.06'}`,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      portNumber: 25,
      securityContext: {
        ensureNonRoot: false, // Postfix needs to run as root
        readOnlyRootFilesystem: false,
      },
      resources: config.resources?.postfix
        ? {
          cpu: {
            request: parseCpuMillis(config.resources.postfix.requests?.cpu || '100m'),
            limit: config.resources.postfix.limits?.cpu
              ? parseCpuMillis(config.resources.postfix.limits.cpu)
              : undefined,
          },
          memory: {
            request: parseMemorySize(config.resources.postfix.requests?.memory || '512Mi'),
            limit: config.resources.postfix.limits?.memory
              ? parseMemorySize(config.resources.postfix.limits.memory)
              : undefined,
          },
        }
        : undefined,
      // Health check - check if Postfix is responding on port 25
      liveness: kplus.Probe.fromTcpSocket({
        port: 25,
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(10),
        timeoutSeconds: Duration.seconds(5),
        failureThreshold: 3,
      }),
      readiness: kplus.Probe.fromTcpSocket({
        port: 25,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(5),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
    });

    // Add environment variables from shared ConfigMap
    container.env.copyFrom(kplus.Env.fromConfigMap(sharedConfigMap));

    // Add database credentials from secret (if using PostgreSQL)
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

    // Mount PVC for mail queue
    container.mount('/queue', kplus.Volume.fromPersistentVolumeClaim(this, 'queue-volume', this.pvc));

    // Create Service
    this.service = new kplus.Service(this, 'service', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-postfix',
          'app.kubernetes.io/component': 'postfix',
        },
      },
      type: kplus.ServiceType.CLUSTER_IP,
      selector: this.deployment,
      ports: [
        {
          name: 'smtp',
          port: 25,
          targetPort: 25,
          protocol: kplus.Protocol.TCP,
        },
        {
          name: 'submission',
          port: 10025,
          targetPort: 10025,
          protocol: kplus.Protocol.TCP,
        },
      ],
    });
  }
}
