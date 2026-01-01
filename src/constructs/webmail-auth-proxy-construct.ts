import { Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { parseMemorySize, parseCpuMillis } from '../utils/resource-parser';

export interface WebmailAuthProxyConstructProps {
  readonly namespace: kplus.Namespace;
  readonly authProxyConfigMap: kplus.ConfigMap;
  readonly webmailServiceName: string;
  readonly adminServiceName: string;
}

/**
 * Webmail Auth Proxy Construct
 *
 * Creates a lightweight nginx proxy between Traefik and webmail that handles
 * authentication with proper redirect behavior for unauthenticated users.
 *
 * This solves the issue where Traefik's ForwardAuth returns 403 on auth failure
 * instead of redirecting to the SSO login page.
 *
 * Components:
 * - Deployment (nginx:alpine with auth_request configuration)
 * - Service (ClusterIP, port 80)
 */
export class WebmailAuthProxyConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;

  constructor(scope: Construct, id: string, props: WebmailAuthProxyConstructProps) {
    super(scope, id);

    const { namespace, authProxyConfigMap, webmailServiceName, adminServiceName } = props;

    // Create Deployment
    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-webmail-auth-proxy',
          'app.kubernetes.io/component': 'auth-proxy',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      replicas: 1,
      podMetadata: {
        labels: {
          'app.kubernetes.io/name': 'mailu-webmail-auth-proxy',
          'app.kubernetes.io/component': 'auth-proxy',
        },
      },
      securityContext: {
        // Run as non-root for security
        ensureNonRoot: true,
      },
    });

    // Configure container
    const container = this.deployment.addContainer({
      name: 'auth-proxy',
      image: 'nginx:1.27-alpine',
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      command: ['/bin/sh', '/etc/nginx/scripts/entrypoint.sh'],
      securityContext: {
        ensureNonRoot: true,
        readOnlyRootFilesystem: false, // nginx needs to write temp files
        user: 101, // nginx user in alpine
        group: 101, // nginx group in alpine
      },
      resources: {
        cpu: {
          request: parseCpuMillis('10m'),
          limit: parseCpuMillis('100m'),
        },
        memory: {
          request: parseMemorySize('16Mi'),
          limit: parseMemorySize('64Mi'),
        },
      },
      ports: [
        {
          name: 'http',
          number: 8080, // Non-privileged port
          protocol: kplus.Protocol.TCP,
        },
      ],
      liveness: kplus.Probe.fromHttpGet('/health', {
        port: 8080,
        initialDelaySeconds: Duration.seconds(5),
        periodSeconds: Duration.seconds(10),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
      readiness: kplus.Probe.fromHttpGet('/health', {
        port: 8080,
        initialDelaySeconds: Duration.seconds(2),
        periodSeconds: Duration.seconds(5),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
    });

    // Add environment variables for service discovery
    container.env.addVariable('WEBMAIL_ADDRESS', kplus.EnvValue.fromValue(webmailServiceName));
    container.env.addVariable('ADMIN_ADDRESS', kplus.EnvValue.fromValue(adminServiceName));

    // Mount ConfigMap as single volume containing both template and script
    const configVolume = kplus.Volume.fromConfigMap(this, 'config-volume', authProxyConfigMap, {
      defaultMode: 0o755, // Make script executable
    });

    // Mount template file
    container.mount('/etc/nginx/templates/nginx.conf.template', configVolume, {
      subPath: 'nginx.conf.template',
      readOnly: true,
    });

    // Mount script file
    container.mount('/etc/nginx/scripts/entrypoint.sh', configVolume, {
      subPath: 'entrypoint.sh',
      readOnly: true,
    });

    // Create Service
    this.service = new kplus.Service(this, 'service', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-webmail-auth-proxy',
          'app.kubernetes.io/component': 'auth-proxy',
        },
      },
      type: kplus.ServiceType.CLUSTER_IP,
      selector: this.deployment,
      ports: [
        {
          name: 'http',
          port: 80,
          targetPort: 8080, // Map to non-privileged port in container
          protocol: kplus.Protocol.TCP,
        },
      ],
    });
  }
}
