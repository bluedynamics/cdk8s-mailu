import { Duration, JsonPatch } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';
import { parseMemorySize, parseCpuMillis } from '../utils/resource-parser';

export interface DovecotSubmissionConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly postfixServiceName: string; // Full DNS name of postfix service
}

/**
 * Dovecot Submission Service Construct
 *
 * Provides a dedicated dovecot submission service for webmail token authentication.
 * This service:
 * - Listens on port 10025 (submission with token auth)
 * - Authenticates via admin service HTTP API
 * - Proxies authenticated connections to postfix:25
 *
 * Uses official dovecot image with custom configuration.
 */
export class DovecotSubmissionConstruct extends Construct {
  public readonly deployment: kplus.Deployment;
  public readonly service: kplus.Service;
  public readonly configMap: kplus.ConfigMap;

  constructor(scope: Construct, id: string, props: DovecotSubmissionConstructProps) {
    super(scope, id);

    const { config, namespace, postfixServiceName } = props;

    // Create ConfigMap with dovecot configuration (values substituted at build time)
    this.configMap = this.createDovecotConfig(namespace, config, postfixServiceName);

    // Create Deployment
    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-dovecot-submission',
          'app.kubernetes.io/component': 'dovecot-submission',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      replicas: 1,
      podMetadata: {
        labels: {
          'app.kubernetes.io/name': 'mailu-dovecot-submission',
          'app.kubernetes.io/component': 'dovecot-submission',
        },
      },
      securityContext: {
        ensureNonRoot: false, // Dovecot needs privileged operations
      },
    });


    // Configure container with official dovecot image
    const container = this.deployment.addContainer({
      name: 'dovecot-submission',
      image: 'dovecot/dovecot:2.3-latest',
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      resources: config.resources?.dovecot
        ? {
          cpu: {
            request: parseCpuMillis(config.resources.dovecot.requests?.cpu || '100m'),
            limit: config.resources.dovecot.limits?.cpu
              ? parseCpuMillis(config.resources.dovecot.limits.cpu)
              : undefined,
          },
          memory: {
            request: parseMemorySize(config.resources.dovecot.requests?.memory || '256Mi'),
            limit: config.resources.dovecot.limits?.memory
              ? parseMemorySize(config.resources.dovecot.limits.memory)
              : undefined,
          },
        }
        : undefined,
      command: ['/usr/sbin/dovecot', '-F', '-c', '/etc/dovecot/dovecot.conf'],
      // Health checks on submission port
      liveness: kplus.Probe.fromTcpSocket({
        port: 10025,
        initialDelaySeconds: Duration.seconds(30),
        periodSeconds: Duration.seconds(10),
        timeoutSeconds: Duration.seconds(5),
        failureThreshold: 3,
      }),
      readiness: kplus.Probe.fromTcpSocket({
        port: 10025,
        initialDelaySeconds: Duration.seconds(10),
        periodSeconds: Duration.seconds(5),
        timeoutSeconds: Duration.seconds(3),
        failureThreshold: 3,
      }),
    });

    // No environment variables needed - all values substituted at build time

    // Mount dovecot configuration (read-only, no executable permission needed)
    const configVolume = kplus.Volume.fromConfigMap(this, 'config-volume', this.configMap);
    container.mount('/etc/dovecot', configVolume, {
      readOnly: true,
    });

    // Create Service
    this.service = new kplus.Service(this, 'service', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-dovecot-submission',
          'app.kubernetes.io/component': 'dovecot-submission',
        },
      },
      type: kplus.ServiceType.CLUSTER_IP,
      selector: this.deployment,
      ports: [
        {
          name: 'submission',
          port: 10025,
          targetPort: 10025,
          protocol: kplus.Protocol.TCP,
        },
      ],
    });

    // Add nodeSelector and toleration for AMD64 architecture
    // (dovecot official image doesn't support ARM64)
    // Use CDK8S JsonPatch to modify the synthesized manifest
    // Access protected apiObject via type assertion
    (this.deployment as any).apiObject.addJsonPatch(
      JsonPatch.add('/spec/template/spec/nodeSelector', {
        'kubernetes.io/arch': 'amd64',
      }),
    );

    // Add toleration for AMD64 taint (cluster has kubernetes.io/arch=amd64:NoSchedule taint on AMD64 node)
    (this.deployment as any).apiObject.addJsonPatch(
      JsonPatch.add('/spec/template/spec/tolerations', [
        {
          key: 'kubernetes.io/arch',
          operator: 'Equal',
          value: 'amd64',
          effect: 'NoSchedule',
        },
      ]),
    );
  }

  private createDovecotConfig(
    namespace: kplus.Namespace,
    config: MailuChartConfig,
    postfixServiceName: string,
  ): kplus.ConfigMap {
    // Dovecot configuration for submission service with token auth
    // Values substituted at CDK8S build time (no runtime substitution needed)
    const dovecotConf = `# Dovecot Submission Service Configuration
# Official dovecot image with custom config for Mailu webmail token auth
# Generated by CDK8S - values substituted at build time

# Logging
log_path = /dev/stderr
auth_verbose = yes
mail_debug = yes
login_log_format_elements = user=<%u> method=%m rip=%r rport=%b lip=%l lport=%a mpid=%e %c

# Protocols - only submission
protocols = submission

# Allow low UIDs (mail user is UID 8)
first_valid_uid = 8
last_valid_uid = 0

# Mail location (relay-only, no actual storage needed)
mail_location = maildir:/tmp/mail

# Admin and hostname
postmaster_address = admin@${config.domain}
hostname = ${config.domain}

# Submission relay configuration
submission_relay_host = ${postfixServiceName}
submission_relay_port = 25
submission_relay_trusted = yes
submission_relay_ssl = no
submission_max_mail_size = 52428800

# Network configuration
listen = *

# Authentication via static passdb (token auth handled by webmail, accept all)
passdb {
  driver = static
  args = nopassword=y
}

# User database (static, minimal config for relay)
userdb {
  driver = static
  args = uid=mail gid=mail home=/tmp
}

# Submission service configuration
service submission-login {
  inet_listener submission {
    port = 10025
  }
  service_count = 0
  client_limit = 25000
  process_min_avail = 8
  process_limit = 8
  vsz_limit = 256M
}

# Authentication process
service auth {
  unix_listener auth-userdb {
    mode = 0666
  }
}

# SSL/TLS settings (not used, plaintext internal)
ssl = no

# Disable authentication (passthrough mode - auth handled by admin HTTP API via webmail token)
# Webmail sends token as password, which postfix+admin validate via HTTP auth
disable_plaintext_auth = no
`;

    return new kplus.ConfigMap(this, 'configmap', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-dovecot-submission',
          'app.kubernetes.io/component': 'configuration',
        },
      },
      data: {
        'dovecot.conf': dovecotConf,
      },
    });
  }
}
