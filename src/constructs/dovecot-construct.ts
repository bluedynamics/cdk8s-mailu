import { Size, Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-28';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';

export interface DovecotConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly sharedConfigMap: kplus.ConfigMap;
}

/**
 * Dovecot Construct - IMAP/POP3 server for mail retrieval
 *
 * The Dovecot component provides:
 * - IMAP/POP3 server for mail retrieval
 * - Mailbox storage (largest storage requirement)
 * - Local mail delivery from Postfix
 * - Authentication backend
 * - Sieve filtering support
 *
 * Components:
 * - Deployment with single replica
 * - ClusterIP Service on ports 143 (IMAP), 993 (IMAPS), 110 (POP3), 995 (POP3S)
 * - PersistentVolumeClaim for mailboxes (largest volume)
 */
export class DovecotConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;
  public readonly pvc: kplus.PersistentVolumeClaim;

  constructor(scope: Construct, id: string, props: DovecotConstructProps) {
    super(scope, id);

    const { config, namespace, sharedConfigMap } = props;

    // Create PersistentVolumeClaim for mailboxes (largest volume)
    this.pvc = new kplus.PersistentVolumeClaim(this, 'pvc', {
      metadata: {
        namespace: namespace.name,
      },
      accessModes: [kplus.PersistentVolumeAccessMode.READ_WRITE_ONCE],
      storage: Size.gibibytes(parseInt(config.storage?.dovecot?.size?.replace('Gi', '') || '50')),
      storageClassName: config.storage?.storageClass,
    });

    // Create Deployment
    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-dovecot',
          'app.kubernetes.io/component': 'dovecot',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      replicas: 1,
      podMetadata: {
        labels: {
          'app.kubernetes.io/name': 'mailu-dovecot',
          'app.kubernetes.io/component': 'dovecot',
        },
      },
    });

    // Configure container
    const container = this.deployment.addContainer({
      name: 'dovecot',
      image: `${config.images?.registry || 'ghcr.io/mailu'}/dovecot:${config.images?.tag || '2024.06'}`,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      portNumber: 143, // IMAP port
      securityContext: {
        ensureNonRoot: false, // Dovecot needs to run as root
        readOnlyRootFilesystem: false,
      },
      resources: config.resources?.dovecot
        ? {
          cpu: {
            request: kplus.Cpu.millis(
              parseInt(config.resources.dovecot.requests?.cpu?.replace('m', '') || '200'),
            ),
            limit: config.resources.dovecot.limits?.cpu
              ? kplus.Cpu.millis(parseInt(config.resources.dovecot.limits.cpu.replace('m', '') || '1000'))
              : undefined,
          },
          memory: {
            request: this.parseMemorySize(config.resources.dovecot.requests?.memory || '1Gi'),
            limit: config.resources.dovecot.limits?.memory
              ? this.parseMemorySize(config.resources.dovecot.limits.memory)
              : undefined,
          },
        }
        : undefined,
      // Health check - check if Dovecot is responding on IMAP port
      liveness: kplus.Probe.fromTcpSocket({
        port: 143,
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(10),
        timeoutSeconds: Duration.seconds(5),
        failureThreshold: 3,
      }),
      readiness: kplus.Probe.fromTcpSocket({
        port: 143,
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

    // Mount PVC for mailboxes
    container.mount('/mail', kplus.Volume.fromPersistentVolumeClaim(this, 'mail-volume', this.pvc));

    // Create Service exposing IMAP and POP3 ports
    this.service = new kplus.Service(this, 'service', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-dovecot',
          'app.kubernetes.io/component': 'dovecot',
        },
      },
      type: kplus.ServiceType.CLUSTER_IP,
      selector: this.deployment,
      ports: [
        {
          name: 'imap',
          port: 143,
          targetPort: 143,
          protocol: kplus.Protocol.TCP,
        },
        {
          name: 'imaps',
          port: 993,
          targetPort: 993,
          protocol: kplus.Protocol.TCP,
        },
        {
          name: 'pop3',
          port: 110,
          targetPort: 110,
          protocol: kplus.Protocol.TCP,
        },
        {
          name: 'pop3s',
          port: 995,
          targetPort: 995,
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
