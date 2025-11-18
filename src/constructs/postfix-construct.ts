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

    // Add Postfix rate limiting configuration (anvil)
    // These env vars configure Postfix main.cf parameters for rate limiting
    // See: http://www.postfix.org/postconf.5.html
    container.env.addVariable('POSTFIX_smtpd_client_connection_rate_limit', kplus.EnvValue.fromValue('60')); // 60 connections per minute per IP
    container.env.addVariable('POSTFIX_smtpd_client_connection_count_limit', kplus.EnvValue.fromValue('10')); // 10 simultaneous connections per IP
    container.env.addVariable('POSTFIX_smtpd_client_message_rate_limit', kplus.EnvValue.fromValue('100')); // 100 messages per minute per IP
    container.env.addVariable('POSTFIX_smtpd_client_recipient_rate_limit', kplus.EnvValue.fromValue('300')); // 300 recipients per minute per IP
    container.env.addVariable('POSTFIX_anvil_rate_time_unit', kplus.EnvValue.fromValue('60s')); // Time unit for rate calculations

    // Enable PROXY protocol support for port 25 (SMTP) connections from Traefik
    // This allows Postfix to see the real client IP instead of the Traefik pod IP
    // Critical for relay restrictions to work correctly (mynetworks check uses real IP)
    container.env.addVariable('POSTFIX_smtpd_upstream_proxy_protocol', kplus.EnvValue.fromValue('haproxy')); // HAProxy PROXY protocol (v1/v2 compatible)

    // Mount PVC for mail queue
    container.mount('/queue', kplus.Volume.fromPersistentVolumeClaim(this, 'queue-volume', this.pvc));

    // Mount override ConfigMap for PROXY protocol master.cf configuration
    // This adds smtpd_upstream_proxy_protocol support to the smtp service
    const overrideConfigMap = kplus.ConfigMap.fromConfigMapName(
      this,
      'postfix-override-cm',
      'postfix-master-override',
    );
    container.mount(
      '/overrides',
      kplus.Volume.fromConfigMap(this, 'override-volume', overrideConfigMap),
    );

    // Create shared volume for Postfix spool directory (for exporter access to showq socket)
    const spoolVolume = kplus.Volume.fromEmptyDir(this, 'spool-volume', 'postfix-spool', {
      sizeLimit: parseMemorySize('100Mi'),
    });
    container.mount('/var/spool/postfix', spoolVolume);

    // Add Postfix exporter sidecar for Prometheus metrics
    // Exposes queue size and other Postfix metrics on port 9154
    const exporterContainer = this.deployment.addContainer({
      name: 'postfix-exporter',
      image: 'ghcr.io/hsn723/postfix_exporter:0.17.0',
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      portNumber: 9154,
      securityContext: {
        ensureNonRoot: false, // Needs access to Postfix spool directory
        readOnlyRootFilesystem: true,
      },
      resources: {
        cpu: {
          request: parseCpuMillis('10m'),
          limit: parseCpuMillis('50m'),
        },
        memory: {
          request: parseMemorySize('32Mi'),
          limit: parseMemorySize('64Mi'),
        },
      },
    });

    // Mount shared spool volume for access to showq socket
    exporterContainer.mount('/var/spool/postfix', spoolVolume);

    // Configure exporter to read from Postfix showq socket
    exporterContainer.env.addVariable('POSTFIX_SHOWQ_PATH', kplus.EnvValue.fromValue('/var/spool/postfix/public/showq'));

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
        {
          name: 'metrics',
          port: 9154,
          targetPort: 9154,
          protocol: kplus.Protocol.TCP,
        },
      ],
    });
  }
}
