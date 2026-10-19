import { Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';
import { UnboundConfigMap } from './unbound-configmap';
import { parseMemorySize, parseCpuMillis, parseStorageSize } from '../utils/resource-parser';

export interface RspamdConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly sharedConfigMap: kplus.ConfigMap;
}

/**
 * Rspamd Construct - Spam filtering and antispam engine
 *
 * The Rspamd component provides:
 * - Spam filtering for incoming and outgoing mail
 * - Integration with Postfix for mail scanning
 * - Machine learning for spam detection
 * - DKIM signing
 * - Redis integration for caching and statistics
 *
 * Components:
 * - Deployment with single replica
 * - ClusterIP Service on port 11334 (Rspamd HTTP interface)
 * - PersistentVolumeClaim for learned spam data
 */
export class RspamdConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;
  public readonly pvc: kplus.PersistentVolumeClaim;
  public readonly webUiConfigMap: kplus.ConfigMap;
  public readonly overridesConfigMap: kplus.ConfigMap;
  public readonly dnsOverrideConfigMap: kplus.ConfigMap;

  constructor(scope: Construct, id: string, props: RspamdConstructProps) {
    super(scope, id);

    const { config, namespace, sharedConfigMap } = props;

    // Create ConfigMap for Rspamd web UI configuration override
    // This disables password authentication for the web interface since we're already
    // protecting the route with Traefik ForwardAuth middleware (admin authentication)
    this.webUiConfigMap = new kplus.ConfigMap(this, 'webui-config', {
      metadata: {
        namespace: namespace.name,
      },
      data: {
        // Override worker-controller.inc to allow all IPs (authentication handled by ForwardAuth)
        'worker-controller.inc': `# Rspamd web UI configuration override
# Authentication is handled by Traefik ForwardAuth middleware,
# so we disable Rspamd's built-in password authentication
type = "controller";
bind_socket = "*:11334";
# Allow all IPs since access is already protected by ForwardAuth
secure_ip = "0.0.0.0/0";
# Password is still defined but not required due to secure_ip
password = "mailu";
`,
      },
    });

    // Create ConfigMap for rspamd configuration overrides (spam filter improvements).
    // Mailu's start.py copies an override into local.d only if Mailu ships no file
    // of that name; otherwise Mailu's local.d/<file> includes /overrides/<file> with
    // duplicate=merge, which turns repeated scalar keys into arrays. Never override
    // a key Mailu already sets (e.g. classifier-bayes.conf autolearn thresholds).
    this.overridesConfigMap = new kplus.ConfigMap(this, 'overrides-config', {
      metadata: {
        namespace: namespace.name,
      },
      data: {
        'actions.conf': `# Stricter spam thresholds (defaults: reject=15, add_header=6, greylist=4)
reject = 12;
add_header = 5;
greylist = 3;
`,
        'rbl.conf': `# Additional DNS blocklists (Spamhaus ZEN/DBL etc. are rspamd defaults)
# Requires Unbound DNS sidecar for recursive resolution
rbls {
  "barracuda" {
    symbol = "RBL_BARRACUDA";
    rbl = "b.barracudacentral.org";
    ipv4 = true;
    checks = ["from"];
  }
}
`,
        'groups.conf': `# Scores for symbols added in rbl.conf (rbl rules register them with score 0)
group "rbl" {
  symbols {
    "RBL_BARRACUDA" { weight = 2.0; description = "Sending IP is listed in Barracuda RBL"; }
  }
}
`,
        'metrics.conf': `# Mailu's metrics.conf replaces the stock "fuzzy" group, dropping the
# rspamd.com fuzzy symbols to score 0; restore the stock weights
group "fuzzy" {
    symbol "FUZZY_UNKNOWN" { weight = 5.0; description = "Generic fuzzy hash match, bl.rspamd.com"; }
    symbol "FUZZY_DENIED" { weight = 12.0; description = "Denied fuzzy hash, bl.rspamd.com"; }
    symbol "FUZZY_PROB" { weight = 5.0; description = "Probable fuzzy hash, bl.rspamd.com"; }
    symbol "FUZZY_WHITE" { weight = -2.1; description = "Whitelisted fuzzy hash, bl.rspamd.com"; }
}
`,
        'milter_headers.conf': `# Show which symbols fired, to diagnose missed spam from the message itself
use = ["x-spamd-result"];
`,
      },
    });

    // Create ConfigMap for rspamd DNS configuration override
    // Directs rspamd to use the Unbound sidecar (localhost:53) for DNS resolution
    this.dnsOverrideConfigMap = new kplus.ConfigMap(this, 'dns-override-config', {
      metadata: {
        namespace: namespace.name,
      },
      data: {
        'options.inc': `# Use Unbound sidecar for recursive DNS resolution (RBL lookups)
dns {
    nameserver = "127.0.0.1:53:10";
}
`,
      },
    });

    // Create Unbound DNS resolver ConfigMap for RBL lookups
    const unboundConfigMap = new UnboundConfigMap(this, 'unbound', {
      namespace,
      kubeDnsIp: config.dns?.kubeDnsIp,
    });

    // Create PersistentVolumeClaim for learned spam data
    this.pvc = new kplus.PersistentVolumeClaim(this, 'pvc', {
      metadata: {
        namespace: namespace.name,
      },
      accessModes: [kplus.PersistentVolumeAccessMode.READ_WRITE_ONCE],
      storage: parseStorageSize(config.storage?.rspamd?.size || '5Gi'),
      storageClassName: config.storage?.rspamd?.storageClass || config.storage?.storageClass,
    });

    // Create Deployment
    // Recreate strategy required: RWO PVC cannot be mounted on two nodes simultaneously
    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-rspamd',
          'app.kubernetes.io/component': 'rspamd',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      replicas: 1,
      strategy: kplus.DeploymentStrategy.recreate(),
      podMetadata: {
        labels: {
          'app.kubernetes.io/name': 'mailu-rspamd',
          'app.kubernetes.io/component': 'rspamd',
        },
      },
      securityContext: {
        // Mailu containers run as root for privileged operations
        ensureNonRoot: false,
      },
    });

    // Configure container
    const container = this.deployment.addContainer({
      name: 'rspamd',
      image: `${config.images?.registry || 'ghcr.io/mailu'}/rspamd:${config.images?.tag || '2024.06.47'}`,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      portNumber: 11334,
      securityContext: {
        ensureNonRoot: false, // Rspamd needs to run as root
        readOnlyRootFilesystem: false,
      },
      resources: config.resources?.rspamd
        ? {
          cpu: {
            request: parseCpuMillis(config.resources.rspamd.requests?.cpu || '100m'),
            limit: config.resources.rspamd.limits?.cpu
              ? parseCpuMillis(config.resources.rspamd.limits.cpu)
              : undefined,
          },
          memory: {
            request: parseMemorySize(config.resources.rspamd.requests?.memory || '512Mi'),
            limit: config.resources.rspamd.limits?.memory
              ? parseMemorySize(config.resources.rspamd.limits.memory)
              : undefined,
          },
        }
        : undefined,
      // Health check on HTTP interface
      liveness: kplus.Probe.fromHttpGet('/ping', {
        port: 11334,
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(10),
        timeoutSeconds: Duration.seconds(5),
        failureThreshold: 3,
      }),
      readiness: kplus.Probe.fromHttpGet('/ping', {
        port: 11334,
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

    // Mount PVC for learned data and configuration
    container.mount('/var/lib/rspamd', kplus.Volume.fromPersistentVolumeClaim(this, 'data-volume', this.pvc));

    // Mount ConfigMap with web UI configuration override directly to /conf/
    // This bypasses Mailu's override processing and puts the config directly where Rspamd reads it
    // We use subPath to mount only the worker-controller.inc file
    const webUiConfigVolume = kplus.Volume.fromConfigMap(this, 'webui-config-volume', this.webUiConfigMap);
    container.mount('/conf/worker-controller.inc', webUiConfigVolume, {
      subPath: 'worker-controller.inc',
    });

    // Mount overrides ConfigMap for spam filter configuration
    const overridesVolume = kplus.Volume.fromConfigMap(this, 'overrides-volume', this.overridesConfigMap);
    container.mount('/overrides', overridesVolume);

    // Mount DNS override for rspamd to use Unbound sidecar
    const dnsOverrideVolume = kplus.Volume.fromConfigMap(this, 'dns-override-volume', this.dnsOverrideConfigMap);
    container.mount('/conf/options.inc', dnsOverrideVolume, {
      subPath: 'options.inc',
    });

    // Add Unbound DNS resolver sidecar for recursive RBL lookups
    const unboundContainer = this.deployment.addContainer({
      name: 'unbound',
      image: `${config.dns?.unboundImage || 'crazymax/unbound:1.24.0'}`,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      portNumber: 53,
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
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
      liveness: kplus.Probe.fromTcpSocket({
        port: 53,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(10),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
      readiness: kplus.Probe.fromTcpSocket({
        port: 53,
        initialDelaySeconds: Duration.seconds(5),
        periodSeconds: Duration.seconds(5),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
    });

    // Mount Unbound configuration
    const unboundConfigVolume = kplus.Volume.fromConfigMap(
      this, 'unbound-config-volume', unboundConfigMap.configMap,
    );
    unboundContainer.mount('/config/custom.conf', unboundConfigVolume, {
      subPath: 'unbound.conf',
    });

    // Create Service
    this.service = new kplus.Service(this, 'service', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-rspamd',
          'app.kubernetes.io/component': 'rspamd',
        },
      },
      type: kplus.ServiceType.CLUSTER_IP,
      selector: this.deployment,
      ports: [
        {
          name: 'milter',
          port: 11332,
          targetPort: 11332,
          protocol: kplus.Protocol.TCP,
        },
        {
          name: 'fuzzy',
          port: 11333,
          targetPort: 11333,
          protocol: kplus.Protocol.TCP,
        },
        {
          name: 'rspamd',
          port: 11334,
          targetPort: 11334,
          protocol: kplus.Protocol.TCP,
        },
      ],
    });
  }
}
