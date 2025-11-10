import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';

export interface NginxPatchConfigMapProps {
  readonly namespace: kplus.Namespace;
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
# (this wrapper only runs when Traefik TLS termination is needed)
echo "Patching nginx.conf for Traefik TLS mail protocol listeners..."

NGINX_CONF="/etc/nginx/nginx.conf"

if [ ! -f "$NGINX_CONF" ]; then
  echo "ERROR: $NGINX_CONF not found after config.py run"
  exit 1
fi

# Inject mail protocol server blocks after the SMTP port 25 server block closes
# Find the port 25 server block and insert new blocks after its closing brace
sed -i '/auth_http_header Auth-Port 25;/,/^    }$/{
  /^    }$/a\\
\\
    # Submission (port 587) for Traefik TLS termination\\
    server {\\
      listen 587;\\
      protocol smtp;\\
      smtp_auth plain;\\
      auth_http_header Auth-Port 587;\\
      auth_http_header Client-Port \\$remote_port;\\
    }\\
\\
    # SMTPS (port 465) for Traefik TLS termination\\
    server {\\
      listen 465;\\
      protocol smtp;\\
      smtp_auth plain;\\
      auth_http_header Auth-Port 465;\\
      auth_http_header Client-Port \\$remote_port;\\
    }\\
\\
    # IMAPS (port 993) for Traefik TLS termination\\
    server {\\
      listen 993;\\
      protocol imap;\\
      imap_auth plain;\\
      auth_http_header Auth-Port 993;\\
      auth_http_header Client-Port \\$remote_port;\\
    }\\
\\
    # POP3S (port 995) for Traefik TLS termination\\
    server {\\
      listen 995;\\
      protocol pop3;\\
      pop3_auth plain;\\
      auth_http_header Auth-Port 995;\\
      auth_http_header Client-Port \\$remote_port;\\
    }
}' "$NGINX_CONF"

if [ $? -eq 0 ]; then
  echo "Successfully patched $NGINX_CONF with mail protocol server blocks"
else
  echo "ERROR: Failed to patch $NGINX_CONF"
  exit 1
fi

# Verify the patch was applied
if grep -q "# Submission (port 587) for Traefik TLS termination" "$NGINX_CONF"; then
  echo "Patch verification: OK - Found injected server blocks"
else
  echo "WARNING: Patch verification failed - Server blocks not found, but continuing"
fi

# Step 3: Start Dovecot proxy (required by Mailu nginx config)
echo "Starting Dovecot proxy..."
dovecot -c /etc/dovecot/proxy.conf

# Step 4: Start nginx
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
