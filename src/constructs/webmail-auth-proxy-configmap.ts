import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';

export interface WebmailAuthProxyConfigMapProps {
  readonly namespace: kplus.Namespace;
}

/**
 * ConfigMap for Webmail Auth Proxy nginx configuration
 *
 * This proxy sits between Traefik and webmail to handle authentication with proper
 * redirect behavior. Unlike Traefik's ForwardAuth (which returns 403 on auth failure),
 * this nginx proxy redirects unauthenticated users to /sso/login.
 *
 * Flow:
 * 1. User requests /webmail
 * 2. Nginx auth_request checks /internal/auth/user on admin service
 * 3. If authenticated (200): proxy to webmail with X-User/X-User-Token headers
 * 4. If not authenticated (401/403): redirect to /sso/login?next={original_url}
 */
export class WebmailAuthProxyConfigMap extends Construct {
  public readonly configMap: kplus.ConfigMap;

  constructor(scope: Construct, id: string, props: WebmailAuthProxyConfigMapProps) {
    super(scope, id);

    const nginxConfTemplate = `# Nginx Auth Proxy for Mailu Webmail
# Handles authentication check with redirect for unauthenticated users

worker_processes 1;
error_log /dev/stderr info;
pid /tmp/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    access_log /dev/stdout;

    # Temp paths for non-root operation
    client_body_temp_path /tmp/client_body;
    proxy_temp_path /tmp/proxy;
    fastcgi_temp_path /tmp/fastcgi;
    uwsgi_temp_path /tmp/uwsgi;
    scgi_temp_path /tmp/scgi;

    # Upstream definitions (substituted at runtime via envsubst)
    upstream webmail_backend {
        server \${WEBMAIL_ADDRESS}:80;
    }

    upstream admin_backend {
        server \${ADMIN_ADDRESS}:8080;
    }

    server {
        listen 8080;
        server_name _;

        # Prevent nginx from converting relative redirects to absolute URLs
        # This ensures redirects use the original scheme/host from X-Forwarded headers
        absolute_redirect off;

        # Internal location for auth subrequest
        # Calls admin service's /internal/auth/user endpoint
        location = /_auth {
            internal;
            proxy_pass http://admin_backend/internal/auth/user;
            proxy_pass_request_body off;
            proxy_set_header Content-Length "";
            proxy_set_header X-Original-URI $request_uri;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
            proxy_set_header X-Forwarded-Host $http_x_forwarded_host;
            proxy_set_header Host $http_host;
            proxy_set_header Cookie $http_cookie;
        }

        # Static assets bypass - no authentication required
        # These paths contain CSS, JS, images that must load for the login page to display
        # Note: paths come in with /webmail prefix from ingress
        location ~ ^/webmail/(skins|program/js|plugins)/.*\\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            proxy_pass http://webmail_backend;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
            proxy_set_header X-Forwarded-Host $http_x_forwarded_host;
            proxy_set_header Host $http_host;

            # Cache static assets
            proxy_cache_valid 200 1d;
            expires 1d;
            add_header Cache-Control "public, immutable";
        }

        # Main location for webmail proxy
        location / {
            # Perform auth check via subrequest
            auth_request /_auth;

            # On auth failure (401/403), redirect to SSO login
            error_page 401 403 = @login_redirect;

            # On auth success, capture response headers from auth endpoint
            auth_request_set $auth_user $upstream_http_x_user;
            auth_request_set $auth_token $upstream_http_x_user_token;

            # Pass auth headers to webmail backend
            # Roundcube's Mailu plugin uses these for SSO auto-login
            proxy_set_header X-User $auth_user;
            proxy_set_header X-User-Token $auth_token;

            # Forward standard headers
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
            proxy_set_header X-Forwarded-Host $http_x_forwarded_host;
            proxy_set_header Host $http_host;

            # Proxy to webmail backend
            proxy_pass http://webmail_backend;
            proxy_http_version 1.1;
            proxy_set_header Connection "";

            # Timeouts for long-running requests
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
        }

        # Named location for login redirect
        # Redirects unauthenticated users to SSO login with return URL
        location @login_redirect {
            # Build redirect URL with original path as 'next' parameter
            # User will be redirected back to their original URL after login
            return 302 /sso/login?next=$request_uri;
        }

        # Health check endpoint for Kubernetes probes
        location /health {
            return 200 "OK\\n";
            add_header Content-Type text/plain;
        }
    }
}
`;

    const entrypointScript = `#!/bin/sh
set -e

echo "Starting Webmail Auth Proxy..."

# Create temp directories for non-root nginx
mkdir -p /tmp/client_body /tmp/proxy /tmp/fastcgi /tmp/uwsgi /tmp/scgi

# Substitute environment variables in nginx config template
echo "Configuring nginx with:"
echo "  WEBMAIL_ADDRESS: \${WEBMAIL_ADDRESS}"
echo "  ADMIN_ADDRESS: \${ADMIN_ADDRESS}"

envsubst '\${WEBMAIL_ADDRESS} \${ADMIN_ADDRESS}' < /etc/nginx/templates/nginx.conf.template > /tmp/nginx.conf

# Verify config
nginx -t -c /tmp/nginx.conf

# Start nginx in foreground
exec nginx -c /tmp/nginx.conf -g "daemon off;"
`;

    this.configMap = new kplus.ConfigMap(this, 'configmap', {
      metadata: {
        namespace: props.namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-webmail-auth-proxy',
          'app.kubernetes.io/component': 'auth-proxy',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      data: {
        'nginx.conf.template': nginxConfTemplate,
        'entrypoint.sh': entrypointScript,
      },
    });
  }
}
