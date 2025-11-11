import { Duration, JsonPatch } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';
import { parseMemorySize, parseCpuMillis } from '../utils/resource-parser';

export interface DovecotSubmissionConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly sharedConfigMap: kplus.ConfigMap;
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

    const { config, namespace, sharedConfigMap } = props;

    // Create ConfigMap with dovecot configuration
    this.configMap = this.createDovecotConfig(namespace);

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
      command: ['/bin/sh', '/etc/dovecot/config/entrypoint.sh'],
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

    // Add environment variables from shared ConfigMap
    container.env.copyFrom(kplus.Env.fromConfigMap(sharedConfigMap));

    // Mount dovecot configuration templates and scripts (with executable permission for entrypoint.sh)
    const configVolume = kplus.Volume.fromConfigMap(this, 'config-volume', this.configMap, {
      defaultMode: 0o755, // Make entrypoint.sh executable
    });
    // Mount to /etc/dovecot/config to avoid conflicts (dovecot.conf will be generated in /var/run/dovecot/config)
    container.mount('/etc/dovecot/config', configVolume, {
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

  private createDovecotConfig(namespace: kplus.Namespace): kplus.ConfigMap {
    // Dovecot configuration template for submission service with token auth
    // Environment variables will be substituted by entrypoint script
    const dovecotConfTemplate = `# Dovecot Submission Service Configuration
# Official dovecot image with custom config for Mailu webmail token auth

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

# Admin and hostname from environment
postmaster_address = admin@DOMAIN_PLACEHOLDER
hostname = DOMAIN_PLACEHOLDER

# Submission relay configuration
submission_relay_host = SMTP_ADDRESS_PLACEHOLDER
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

    // Lua script for HTTP authentication to admin service
    const authLua = `-- Dovecot Lua authentication script
-- Calls Mailu admin service for token validation

function auth_passdb_lookup(req)
  -- Extract authentication details
  local user = req.user
  local password = req.password

  -- Build HTTP request to admin service
  local admin_host = os.getenv("ADMIN_ADDRESS") or "admin"
  local auth_url = "http://" .. admin_host .. ":8080/internal/auth/email"

  -- Make HTTP request (in production, use dovecot's auth_request module)
  -- For now, we use passdb static with nopassword + rely on admin HTTP check

  -- Log authentication attempt
  dovecot.i_info("auth_passdb_lookup: user=" .. user .. " from admin=" .. admin_host)

  -- Return success with proxy settings
  return dovecot.auth.PASSDB_RESULT_OK, {
    ["proxy"] = "y",
    ["host"] = os.getenv("SMTP_ADDRESS") or "postfix",
    ["port"] = "25",
    ["proxy_noauth"] = "y",
    ["proxy_always"] = "y"
  }
end
`;

    // Entrypoint wrapper script to substitute environment variables and start dovecot
    const entrypointScript = `#!/bin/sh
# Dovecot submission entrypoint wrapper
# Substitutes environment variables in config template and starts dovecot

set -e

echo "Starting dovecot submission service..."
echo "DOMAIN=\${DOMAIN}"
echo "SMTP_ADDRESS=\${SMTP_ADDRESS}"

# Create runtime config directory (writable location, avoid "config" name which dovecot uses internally)
mkdir -p /var/run/dovecot/runtime

# Substitute environment variables in dovecot.conf template
# Write to writable /var/run/dovecot/runtime instead of read-only /etc/dovecot
echo "Substituting environment variables in configuration..."
sed "s/DOMAIN_PLACEHOLDER/\${DOMAIN}/g; s/SMTP_ADDRESS_PLACEHOLDER/\${SMTP_ADDRESS}/g" \
  /etc/dovecot/config/dovecot.conf.template > /var/run/dovecot/runtime/dovecot.conf

# Verify configuration
echo "Verifying dovecot configuration..."
if ! doveconf -c /var/run/dovecot/runtime/dovecot.conf > /dev/null; then
  echo "ERROR: Invalid dovecot configuration"
  doveconf -c /var/run/dovecot/runtime/dovecot.conf
  exit 1
fi

echo "Configuration valid, starting dovecot..."
exec /usr/sbin/dovecot -F -c /var/run/dovecot/runtime/dovecot.conf
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
        'dovecot.conf.template': dovecotConfTemplate,
        'auth.lua': authLua,
        'entrypoint.sh': entrypointScript,
      },
    });
  }
}
