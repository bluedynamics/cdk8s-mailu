import { Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-28';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';
import { parseMemorySize, parseCpuMillis } from '../utils/resource-parser';

export interface FrontConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly sharedConfigMap: kplus.ConfigMap;
}

/**
 * Front Construct - Nginx reverse proxy and mail protocol frontend
 *
 * The Front component provides:
 * - Nginx reverse proxy for HTTP/HTTPS traffic to admin and webmail
 * - Mail protocol exposure (SMTP, IMAP, POP3) with TLS support
 * - Single entry point for all external traffic
 * - Optional TLS termination
 *
 * Components:
 * - Deployment (or DaemonSet if configured)
 * - Service exposing all mail and web ports
 * - Optional TLS certificate volume mounts
 */
export class FrontConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;

  constructor(scope: Construct, id: string, props: FrontConstructProps) {
    super(scope, id);

    const { config, namespace, sharedConfigMap } = props;

    // Create Deployment
    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-front',
          'app.kubernetes.io/component': 'front',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      replicas: 1,
      podMetadata: {
        labels: {
          'app.kubernetes.io/name': 'mailu-front',
          'app.kubernetes.io/component': 'front',
        },
      },
    });

    // Configure container
    const container = this.deployment.addContainer({
      name: 'front',
      image: `${config.images?.registry || 'ghcr.io/mailu'}/nginx:${config.images?.tag || '2024.06'}`,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      securityContext: {
        ensureNonRoot: false, // Nginx needs to bind to privileged ports
        readOnlyRootFilesystem: false,
      },
      resources: config.resources?.front
        ? {
          cpu: {
            request: parseCpuMillis(config.resources.front.requests?.cpu || '100m'),
            limit: config.resources.front.limits?.cpu
              ? parseCpuMillis(config.resources.front.limits.cpu)
              : undefined,
          },
          memory: {
            request: parseMemorySize(config.resources.front.requests?.memory || '256Mi'),
            limit: config.resources.front.limits?.memory
              ? parseMemorySize(config.resources.front.limits.memory)
              : undefined,
          },
        }
        : undefined,
      // Health check on HTTP port
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

    // Add Mailu secret key from secret
    const mailuSecret = kplus.Secret.fromSecretName(this, 'mailu-secret', config.secrets.mailuSecretKey);
    container.env.addVariable(
      'SECRET_KEY',
      kplus.EnvValue.fromSecretValue({
        secret: mailuSecret,
        key: 'secret-key',
      }),
    );

    // Create Service exposing all mail and web ports
    this.service = new kplus.Service(this, 'service', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-front',
          'app.kubernetes.io/component': 'front',
        },
      },
      type: kplus.ServiceType.CLUSTER_IP, // Use ClusterIP by default; Traefik will handle external access
      selector: this.deployment,
      ports: [
        // HTTP/HTTPS for web interfaces
        {
          name: 'http',
          port: 80,
          targetPort: 80,
          protocol: kplus.Protocol.TCP,
        },
        {
          name: 'https',
          port: 443,
          targetPort: 443,
          protocol: kplus.Protocol.TCP,
        },
        // SMTP ports
        {
          name: 'smtp',
          port: 25,
          targetPort: 25,
          protocol: kplus.Protocol.TCP,
        },
        {
          name: 'smtps',
          port: 465,
          targetPort: 465,
          protocol: kplus.Protocol.TCP,
        },
        {
          name: 'submission',
          port: 587,
          targetPort: 587,
          protocol: kplus.Protocol.TCP,
        },
        // IMAP ports
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
        // POP3 ports
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

}
