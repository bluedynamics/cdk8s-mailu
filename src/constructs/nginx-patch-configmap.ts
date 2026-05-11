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

    // Patch 3 is emitted only when proxyProtocolToFront is on: it injects
    // `set_real_ip_from <cidr>;` directives inside the mail{} context so
    // ngx_mail_module replaces $remote_addr with the PROXY-parsed client IP.
    // Without these directives, nginx accepts the PROXY header (because of
    // `listen N proxy_protocol;`) but $remote_addr stays as the TCP peer,
    // and the built-in Client-IP auth header sent to mailu-admin still
    // carries the Traefik pod IP. Mailu's stock template emits exactly this
    // pattern for port 25 (see Mailu nginx.conf.tmpl mail{} block); we
    // extend it to our injected 465/587/993/995 listeners. CIDR list is
    // expanded from $REAL_IP_FROM at wrapper runtime so updates flow
    // through the env-config ConfigMap without re-baking this script.
    const realIpInjection = props.proxyProtocolToFront ? `

# Patch 3: inject set_real_ip_from in mail{} context
# Required for ngx_mail_module to expose the PROXY-parsed client IP as
# $remote_addr (and thus the Client-IP header sent to admin).
echo "  - Adding set_real_ip_from in mail context (REAL_IP_FROM=\$REAL_IP_FROM)..."
if [ -z "\$REAL_IP_FROM" ]; then
  echo "ERROR: REAL_IP_FROM is empty; proxyProtocolToFront requires REAL_IP_FROM to be set"
  exit 1
fi
REALIP_MARKER="    # set_real_ip_from for mail context (PROXY protocol) [proxy_protocol]"
if ! grep -qF "\$REALIP_MARKER" "$NGINX_CONF"; then
  REALIP_INJECT_FILE=\$(mktemp)
  {
    echo ""
    echo "\$REALIP_MARKER"
    OLD_IFS=\$IFS
    IFS=','
    for cidr in \$REAL_IP_FROM; do
      echo "    set_real_ip_from \$(echo "\$cidr" | tr -d ' ');"
    done
    IFS=\$OLD_IFS
  } > "\$REALIP_INJECT_FILE"
  # awk-based insertion is safer than sed for multi-line content; anchors on
  # the unique 'error_log /dev/stderr info;' line that lives at the top of
  # the mail{} block.
  awk -v injf="\$REALIP_INJECT_FILE" '
    { print }
    /^mail {/ { in_mail=1 }
    in_mail && /^}/ { in_mail=0 }
    in_mail && !injected && /^    error_log \\/dev\\/stderr info;$/ {
      while ((getline line < injf) > 0) print line
      close(injf)
      injected=1
    }
  ' "$NGINX_CONF" > "$NGINX_CONF.new" && mv "$NGINX_CONF.new" "$NGINX_CONF"
  rm -f "\$REALIP_INJECT_FILE"
  if ! grep -qF "\$REALIP_MARKER" "$NGINX_CONF"; then
    echo "ERROR: set_real_ip_from injection failed (marker not found post-awk)"
    exit 1
  fi
fi
` : '';

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
${realIpInjection}
# Step 3: Validate final nginx configuration before exec
# Cheap insurance against future patch bugs: if any sed/awk above produced
# an invalid config (escaping mishap, anchor drift, etc.), fail loudly in
# pod logs instead of starting nginx and silently dropping mail.
echo "Validating final nginx configuration..."
if ! /usr/sbin/nginx -t -c "$NGINX_CONF"; then
  echo "ERROR: nginx config validation failed; refusing to start"
  exit 1
fi

# Step 4: Start nginx (dovecot submission moved to separate service)
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
