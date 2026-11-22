import { createHash } from 'crypto';
import { Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { FRONT_HEALTH_PORT, FRONT_LISTENERS, renderFrontNginxConfig } from './front-nginx-config';
import { MailuChartConfig } from '../config';
import { applyPriorityClassName } from '../utils/priority-class';
import { parseMemorySize, parseCpuMillis } from '../utils/resource-parser';

export interface FrontConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  /** Full DNS name of the admin Service, `<service>.<namespace>.svc.cluster.local` */
  readonly adminServiceHost: string;
  readonly priorityClassName?: string;
}

// Patch-pinned on a stable branch (even minor): a floating tag of a mainline branch
// gets no more images once the next stable branch appears.
const DEFAULT_IMAGE = 'nginx:1.30.7-alpine';

// User and group "nginx" of the official image
const NGINX_UID = 101;

const CONFIG_FILE = 'nginx.conf';
const CONFIG_PATH = `/etc/nginx/${CONFIG_FILE}`;

const LABELS = {
  'app.kubernetes.io/name': 'mailu-front',
  'app.kubernetes.io/component': 'front',
};

/**
 * Front Construct - nginx mail proxy
 *
 * Traefik terminates TLS for SMTPS, IMAPS and POP3S and forwards plaintext to
 * the front. The front authenticates every login against the Mailu admin and
 * relays the session to postfix or dovecot. The backends check no password and
 * trust the pod network, so the front is the only authentication gate.
 *
 * It is the official nginx image with a static configuration, not a Mailu
 * image: no Mailu environment, no secret, no root.
 *
 * HTTP (admin, webmail) and server-to-server SMTP on port 25 bypass the front.
 *
 * Components:
 * - ConfigMap with the complete nginx configuration
 * - Deployment
 * - Service with the public mail ports, targeting unprivileged container ports
 */
export class FrontConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;
  public readonly configMap: kplus.ConfigMap;

  constructor(scope: Construct, id: string, props: FrontConstructProps) {
    super(scope, id);

    const { config, namespace, adminServiceHost } = props;

    const nginxConfig = renderFrontNginxConfig({
      serverName: config.hostnames[0],
      adminAuthUrl: `http://${adminServiceHost}:8080/internal/auth/email`,
      messageSizeLimitBytes: (config.mailu?.messageSizeLimit || 50) * 1024 * 1024,
      proxyProtocol: config.ingress?.traefik?.proxyProtocolToFront ?? false,
      realIpFrom: [config.subnet],
    });

    this.configMap = new kplus.ConfigMap(this, 'config', {
      metadata: {
        namespace: namespace.name,
        labels: { ...LABELS, 'app.kubernetes.io/part-of': 'mailu' },
      },
      data: { [CONFIG_FILE]: nginxConfig },
    });

    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: { ...LABELS, 'app.kubernetes.io/part-of': 'mailu' },
      },
      replicas: 1,
      podMetadata: {
        labels: LABELS,
        // nginx reads the file only at start. The checksum changes the pod
        // template with every change of the configuration, which rolls the pod.
        annotations: {
          'checksum/config': createHash('sha256').update(nginxConfig).digest('hex'),
        },
      },
      securityContext: {
        ensureNonRoot: true,
      },
    });

    applyPriorityClassName(this.deployment, props.priorityClassName);

    const container = this.deployment.addContainer({
      name: 'front',
      image: config.images?.front ?? DEFAULT_IMAGE,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      // Bypasses the image's entrypoint, whose scripts try to edit files under /etc/nginx
      command: ['nginx', '-c', CONFIG_PATH, '-g', 'daemon off;'],
      securityContext: {
        ensureNonRoot: true,
        user: NGINX_UID,
        group: NGINX_UID,
        privileged: false,
        allowPrivilegeEscalation: false,
        readOnlyRootFilesystem: true,
        capabilities: { drop: [kplus.Capability.ALL] },
        seccompProfile: { type: kplus.SeccompProfileType.RUNTIME_DEFAULT },
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
      ports: [
        ...FRONT_LISTENERS.map((listener) => ({
          name: listener.name,
          number: listener.containerPort,
          protocol: kplus.Protocol.TCP,
        })),
        { name: 'health', number: FRONT_HEALTH_PORT, protocol: kplus.Protocol.TCP },
      ],
      liveness: kplus.Probe.fromHttpGet('/health', {
        port: FRONT_HEALTH_PORT,
        initialDelaySeconds: Duration.seconds(5),
        periodSeconds: Duration.seconds(10),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
      readiness: kplus.Probe.fromHttpGet('/health', {
        port: FRONT_HEALTH_PORT,
        initialDelaySeconds: Duration.seconds(2),
        periodSeconds: Duration.seconds(5),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
    });

    container.mount(CONFIG_PATH, kplus.Volume.fromConfigMap(this, 'config-volume', this.configMap), {
      subPath: CONFIG_FILE,
      readOnly: true,
    });

    // pid file and the temp paths of the http block; everything else is read-only
    container.mount('/tmp', kplus.Volume.fromEmptyDir(this, 'tmp', 'tmp'));

    this.service = new kplus.Service(this, 'service', {
      metadata: {
        namespace: namespace.name,
        labels: LABELS,
      },
      type: kplus.ServiceType.CLUSTER_IP,
      selector: this.deployment,
      ports: FRONT_LISTENERS.map((listener) => ({
        name: listener.name,
        port: listener.servicePort,
        targetPort: listener.containerPort,
        protocol: kplus.Protocol.TCP,
      })),
    });
  }
}
