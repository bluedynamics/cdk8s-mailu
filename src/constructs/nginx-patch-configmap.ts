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
# This patches BOTH mail protocols AND HTTP location blocks
echo "Patching nginx.conf for Traefik TLS termination..."

NGINX_CONF="/etc/nginx/nginx.conf"

if [ ! -f "$NGINX_CONF" ]; then
  echo "ERROR: $NGINX_CONF not found after config.py run"
  exit 1
fi

# Patch 2a: Inject mail protocol server blocks (in mail{} section)
# Find the port 25 server block and insert new blocks after its closing brace
echo "  - Adding mail protocol listeners (465, 587, 993, 995)..."
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

if [ $? -ne 0 ]; then
  echo "ERROR: Failed to patch mail protocol server blocks"
  exit 1
fi

# Patch 2b: Add /admin location block (in http{} server section)
# Insert after the "include /overrides/*.conf;" line
echo "  - Adding /admin location block..."
sed -i '/include \\/overrides\\/\\*\\.conf;/a\\
\\
      # Admin UI location block (TLS_FLAVOR=notls fix)\\
      location /admin {\\
        include /etc/nginx/proxy.conf;\\
        auth_request /internal/auth/admin;\\
        auth_request_set $user $upstream_http_x_user;\\
        auth_request_set $token $upstream_http_x_user_token;\\
        proxy_set_header X-Real-IP $remote_addr;\\
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\\
        proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;\\
        proxy_set_header Host $http_host;\\
        error_page 403 @sso_login;\\
        proxy_pass http://$admin;\\
      }
' "$NGINX_CONF"

if [ $? -ne 0 ]; then
  echo "ERROR: Failed to add /admin location block"
  exit 1
fi

# Patch 2c: Replace root location block with redirect to webmail
# Find and replace the "location / { ... try_files ... }" block
echo "  - Adding root redirect to /webmail..."
sed -i '/^      location \\/ {$/,/^      }$/{
  /^      location \\/ {$/,/^      }$/ {
    /^      location \\/ {$/!{/^      }$/!d;}
  }
  /^      location \\/ {$/a\\
        # Redirect root to webmail for better UX\\
        return 302 /webmail;
}' "$NGINX_CONF"

if [ $? -ne 0 ]; then
  echo "ERROR: Failed to add root redirect"
  exit 1
fi

# Verify all patches were applied
echo "Verifying patches..."
PATCH_OK=true

if ! grep -q "# Submission (port 587) for Traefik TLS termination" "$NGINX_CONF"; then
  echo "WARNING: Mail protocol patches not found"
  PATCH_OK=false
fi

if ! grep -q "# Admin UI location block (TLS_FLAVOR=notls fix)" "$NGINX_CONF"; then
  echo "WARNING: Admin location block not found"
  PATCH_OK=false
fi

if ! grep -q "# Redirect root to webmail for better UX" "$NGINX_CONF"; then
  echo "WARNING: Root redirect not found"
  PATCH_OK=false
fi

if [ "$PATCH_OK" = true ]; then
  echo "Patch verification: OK - All patches applied successfully"
else
  echo "WARNING: Some patches may not have been applied correctly, but continuing"
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
