import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';

export interface NginxPatchConfigMapProps {
  readonly namespace: kplus.Namespace;

  /**
   * Inject the `proxy_protocol` keyword on the `listen` directives for
   * 465 / 587 / 993 / 995. Must be paired with `proxyProtocolToFront: true`
   * on TraefikIngressConfig, otherwise nginx waits forever for a PROXY
   * header that never arrives (or vice versa).
   * @default false
   */
  readonly proxyProtocolToFront?: boolean;
}

/**
 * ConfigMap containing nginx patch script for Traefik TLS termination
 *
 * Creates a bash script that patches /conf/nginx.conf to inject
 * mail protocol server blocks (465, 587, 993, 995) when TLS_FLAVOR='traefik'.
 *
 * The patch enables Traefik to terminate TLS while nginx handles mail protocols
 * in plaintext mode with authentication proxying.
 */
export class NginxPatchConfigMap extends Construct {
  public readonly configMap: kplus.ConfigMap;

  constructor(scope: Construct, id: string, props: NginxPatchConfigMapProps) {
    super(scope, id);

    const { namespace } = props;
    const listenSuffix = props.proxyProtocolToFront ? ' proxy_protocol' : '';
    // Bake the flag into the verification marker so re-running the wrapper
    // after toggling the flag forces a re-patch instead of accepting the
    // previous (now-wrong) injection as already-applied.
    const patchMarker = props.proxyProtocolToFront
      ? '# Submission (port 587) for Traefik TLS termination [proxy_protocol]'
      : '# Submission (port 587) for Traefik TLS termination';

    // Wrapper script that runs config.py, patches nginx.conf, then starts nginx
    const wrapperScript = `#!/bin/sh
# Mailu Front wrapper script with nginx configuration patch
# Runs config.py to generate templates, patches for Traefik TLS, then starts nginx

set -e

echo "Starting Mailu Front with Traefik TLS termination support..."

# Remove stale pid file if exists
if [ -f "/var/run/nginx.pid" ]; then
  rm /var/run/nginx.pid
fi

# Step 1: Run Mailu's config.py to generate nginx configuration templates
echo "Generating nginx configuration..."
python3 /config.py

# Step 2: Patch nginx.conf for Traefik TLS termination
# This patches mail protocol configuration only (Traefik routes HTTP directly to services)
echo "Patching nginx.conf for Traefik TLS termination..."

NGINX_CONF="/etc/nginx/nginx.conf"

if [ ! -f "$NGINX_CONF" ]; then
  echo "ERROR: $NGINX_CONF not found after config.py run"
  exit 1
fi

# Patch 1: Fix auth_http to use admin service (not localhost)
# Original config uses http://127.0.0.1:8000/auth/email but admin runs in separate pod
# Also fixes endpoint path from /auth/email to /internal/auth/email (correct Mailu endpoint)
echo "  - Configuring mail auth to use admin service..."
sed -i "s|auth_http http://127.0.0.1:8000/auth/email;|auth_http http://\${ADMIN_ADDRESS}:8080/internal/auth/email;|g" "$NGINX_CONF"

# Patch 2: Inject mail protocol server blocks (in mail{} section)
# Find the port 25 server block and insert new blocks after its closing brace
echo "  - Adding mail protocol listeners (587, 465, 993, 995)..."
sed -i '/auth_http_header Auth-Port 25;/,/^    }$/{
  /^    }$/a\\
\\
    ${patchMarker}\\
    server {\\
      listen 587${listenSuffix};\\
      protocol smtp;\\
      smtp_auth plain;\\
      auth_http_header Auth-Port 587;\\
      auth_http_header Client-Port \\$remote_port;\\
    }\\
\\
    # SMTPS (port 465) for Traefik TLS termination\\
    server {\\
      listen 465${listenSuffix};\\
      protocol smtp;\\
      smtp_auth plain;\\
      auth_http_header Auth-Port 465;\\
      auth_http_header Client-Port \\$remote_port;\\
    }\\
\\
    # IMAPS (port 993) for Traefik TLS termination\\
    server {\\
      listen 993${listenSuffix};\\
      protocol imap;\\
      imap_auth plain;\\
      auth_http_header Auth-Port 993;\\
      auth_http_header Client-Port \\$remote_port;\\
    }\\
\\
    # POP3S (port 995) for Traefik TLS termination\\
    server {\\
      listen 995${listenSuffix};\\
      protocol pop3;\\
      pop3_auth plain;\\
      auth_http_header Auth-Port 995;\\
      auth_http_header Client-Port \\$remote_port;\\
    }
}' "$NGINX_CONF"

if [ $? -ne 0 ]; then
  echo "ERROR: Failed to patch mail protocol server blocks"
  exit 1
fi

# Verify patches were applied
# Use -F (fixed-string) so the marker is matched literally — when the flag is
# on, the marker contains '[proxy_protocol]' which is a regex character class
# under default -E/basic grep and would not match the actual injected string.
echo "Verifying patches..."
if ! grep -qF "${patchMarker}" "$NGINX_CONF"; then
  echo "ERROR: Mail protocol patches not found in $NGINX_CONF"
  exit 1
fi

echo "Patch verification: OK - All patches applied successfully"

# Step 3: Start nginx (dovecot submission moved to separate service)
echo "Starting nginx..."
exec /usr/sbin/nginx -g "daemon off;"
`;

    this.configMap = new kplus.ConfigMap(this, 'configmap', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-nginx-patch',
          'app.kubernetes.io/component': 'configuration',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      data: {
        'entrypoint-wrapper.sh': wrapperScript,
      },
    });
  }
}
