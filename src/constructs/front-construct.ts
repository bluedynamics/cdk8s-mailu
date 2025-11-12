import { Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';
import { parseMemorySize, parseCpuMillis } from '../utils/resource-parser';

export interface FrontConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly sharedConfigMap: kplus.ConfigMap;
  readonly nginxPatchConfigMap?: kplus.ConfigMap;
}

/**
 * Front Construct - Nginx mail protocol authentication proxy
 *
 * The Front component provides:
 * - Authentication proxy for TLS-terminated mail protocols (SMTPS, Submission, IMAPS, POP3S)
 * - Routes authenticated connections to backend services (Postfix, Dovecot)
 * - Traefik terminates TLS and forwards plaintext to Front nginx
 *
 * Note: HTTP traffic (Admin, Webmail) and server-to-server SMTP(25) bypass Front:
 * - Traefik routes HTTP directly to Admin:8080 and Webmail:80
 * - Traefik routes SMTP(25) directly to Postfix:25
 *
 * Components:
 * - Deployment with nginx container
 * - Service exposing TLS-terminated mail protocol ports (465, 587, 993, 995)
 * - Nginx patch ConfigMap for adding mail protocol listeners
 */
export class FrontConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;

  constructor(scope: Construct, id: string, props: FrontConstructProps) {
    super(scope, id);

    const { config, namespace, sharedConfigMap, nginxPatchConfigMap } = props;

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
      securityContext: {
        // Mailu containers run as root for privileged operations
        ensureNonRoot: false,
      },
    });

    // Prepare container configuration with optional command override
    const containerConfig: any = {
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
    };

    // If nginx patch ConfigMap provided, override command to use wrapper script
    if (nginxPatchConfigMap) {
      containerConfig.command = ['/bin/sh', '/usr/local/bin/entrypoint-wrapper.sh'];
    }

    // Configure container
    const container = this.deployment.addContainer(containerConfig);

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

    // If nginx patch ConfigMap is provided, mount wrapper script
    if (nginxPatchConfigMap) {
      // Create volume from ConfigMap
      const patchVolume = kplus.Volume.fromConfigMap(this, 'nginx-patch-volume', nginxPatchConfigMap, {
        defaultMode: 0o755, // Make script executable
      });

      // Mount wrapper script (command override already set in containerConfig above)
      container.mount('/usr/local/bin/entrypoint-wrapper.sh', patchVolume, {
        subPath: 'entrypoint-wrapper.sh',
        readOnly: true,
      });
    }

    // Create Service exposing TLS-terminated mail protocol ports
    // Note: Traefik routes HTTP to Admin/Webmail directly, and SMTP(25) to Postfix directly
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
        // TLS-terminated SMTP ports (Traefik terminates TLS, forwards plaintext to Front)
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
        // TLS-terminated IMAP port
        {
          name: 'imaps',
          port: 993,
          targetPort: 993,
          protocol: kplus.Protocol.TCP,
        },
        // TLS-terminated POP3 port
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
