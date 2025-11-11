# Nginx Configuration Patches

**How cdk8s-mailu patches nginx configuration for Traefik TLS termination.**

## Introduction

When using `TLS_FLAVOR=notls` with Traefik TLS termination, the Front nginx container requires configuration patches to:

1. Add mail protocol listeners for ports 587, 465, 993, 995
2. Configure auth_http to use Admin service instead of localhost
3. Add location blocks for Admin UI and Webmail access
4. Handle root URL redirects

This document explains the patching mechanism and what changes are applied.

## Patch Architecture

### Why Patching is Needed

**Mailu's Default Behavior**:
- `TLS_FLAVOR=notls` only configures HTTP on port 80
- Mail protocol ports (587, 465, 993, 995) are NOT created
- Assumes TLS handled internally or not needed
- auth_http points to localhost:8000 (doesn't work in Kubernetes multi-pod architecture)

**cdk8s-mailu Requirements**:
- Traefik terminates TLS and forwards plaintext to nginx
- nginx must listen on mail protocol ports to receive from Traefik
- nginx must authenticate via Admin service (separate pod)
- nginx must proxy to backend services after authentication

**Solution**: Wrapper script patches generated nginx.conf before nginx starts.

### Patch Delivery Mechanism

**ConfigMap → Init Container → Shared Volume**:

1. **NginxPatchConfigMap** construct creates ConfigMap with wrapper script
2. **Front Deployment** mounts ConfigMap at `/patch/entrypoint-wrapper.sh`
3. **Init Container** copies script to shared volume and makes executable:
   ```yaml
   initContainers:
   - name: copy-entrypoint
     image: busybox
     command: ['sh', '-c', 'cp /patch/entrypoint-wrapper.sh /entrypoint/entrypoint-wrapper.sh && chmod +x /entrypoint/entrypoint-wrapper.sh']
     volumeMounts:
     - name: entrypoint-volume
       mountPath: /entrypoint
     - name: nginx-patch
       mountPath: /patch
   ```
4. **Main Container** runs wrapper script instead of original entrypoint:
   ```yaml
   command: ['/entrypoint/entrypoint-wrapper.sh']
   ```

**Why Init Container?**
- ConfigMap files are read-only (cannot chmod +x directly)
- Shared emptyDir volume allows executable script
- Clean separation: init copies once, main container runs

## Patch Script Workflow

The wrapper script executes in three phases:

### Phase 1: Generate Base Configuration

```bash
# Run Mailu's config.py to generate nginx.conf from templates
python3 /config.py
```

**What config.py does**:
- Reads environment variables (TLS_FLAVOR, HOSTNAMES, etc.)
- Generates `/etc/nginx/nginx.conf` from Jinja2 templates
- Creates base mail protocol listeners (port 25 only with TLS_FLAVOR=notls)
- Creates base HTTP server block for port 80

**Output**: `/etc/nginx/nginx.conf` with basic configuration

### Phase 2: Apply Patches

Four patches are applied to the generated nginx.conf:

#### Patch 2a: Fix auth_http Endpoint

**Problem**: Default config points to `http://127.0.0.1:8000/auth/email`
- Doesn't work in Kubernetes (Admin is separate pod)
- Wrong endpoint path

**Patch**:
```bash
sed -i "s|auth_http http://127.0.0.1:8000/auth/email;|auth_http http://\${ADMIN_ADDRESS}:8080/internal/auth/email;|g" "$NGINX_CONF"
```

**Changes**:
- `127.0.0.1:8000` → `${ADMIN_ADDRESS}:8080` (Kubernetes service DNS)
- `/auth/email` → `/internal/auth/email` (correct Mailu endpoint)

**Result**:
```nginx
auth_http http://admin-service.mailu.svc.cluster.local:8080/internal/auth/email;
```

#### Patch 2b: Inject Mail Protocol Listeners

**Problem**: TLS_FLAVOR=notls doesn't create listeners for 587, 465, 993, 995

**Patch**: Inserts four server blocks into `mail{}` section after port 25 block:

```nginx
# Submission (port 587) for Traefik TLS termination
server {
  listen 587;
  protocol smtp;
  smtp_auth plain;
  auth_http_header Auth-Port 587;
  auth_http_header Client-Port $remote_port;
}

# SMTPS (port 465) for Traefik TLS termination
server {
  listen 465;
  protocol smtp;
  smtp_auth plain;
  auth_http_header Auth-Port 465;
  auth_http_header Client-Port $remote_port;
}

# IMAPS (port 993) for Traefik TLS termination
server {
  listen 993;
  protocol imap;
  imap_auth plain;
  auth_http_header Auth-Port 993;
  auth_http_header Client-Port $remote_port;
}

# POP3S (port 995) for Traefik TLS termination
server {
  listen 995;
  protocol pop3;
  pop3_auth plain;
  auth_http_header Auth-Port 995;
  auth_http_header Client-Port $remote_port;
}
```

**Key Configuration**:
- `protocol smtp/imap/pop3`: nginx mail module protocol handlers
- `smtp_auth plain` / `imap_auth plain` / `pop3_auth plain`: Enable PLAIN authentication
- `auth_http_header Auth-Port`: Tells Admin which port client connected to
- `auth_http_header Client-Port`: Passes client's source port for logging

**Authentication Flow**:
1. Client sends credentials (username/password)
2. nginx extracts credentials and sends to auth_http endpoint
3. Admin validates and returns backend address
4. nginx proxies connection to backend (Postfix or Dovecot)

#### Patch 2c: Add Admin UI Location Block

**Problem**: Default config doesn't route `/admin` requests

**Patch**: Inserts location block into `http{}` server section:

```nginx
# Admin UI location block (TLS_FLAVOR=notls fix)
location /admin {
  include /etc/nginx/proxy.conf;
  auth_request /internal/auth/admin;
  auth_request_set $user $upstream_http_x_user;
  auth_request_set $token $upstream_http_x_user_token;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $proxy_x_forwarded_proto;
  proxy_set_header Host $http_host;
  error_page 403 @sso_login;
  proxy_pass http://$admin;
}
```

**Key Configuration**:
- `auth_request /internal/auth/admin`: SSO authentication subrequest
- `auth_request_set $user`: Extract authenticated username
- `error_page 403 @sso_login`: Redirect to login if not authenticated
- `proxy_pass http://$admin`: Proxy to Admin service

**Note**: In cdk8s-mailu with Traefik termination, this location block is **unused** because:
- Traefik routes HTTP directly to Admin:8080
- Bypasses Front/nginx entirely for web traffic
- Kept for compatibility with standard Mailu configurations

#### Patch 2d: Add Root Redirect

**Problem**: Root URL (/) has no default handler

**Patch**: Replaces default location block with redirect:

```nginx
location / {
  # Redirect root to webmail for better UX
  return 302 /webmail;
}
```

**User Experience**: Visiting `https://mail.example.com/` redirects to `https://mail.example.com/webmail`

**Note**: Also unused in cdk8s-mailu (Traefik routes directly to Webmail)

### Phase 3: Verify and Start

```bash
# Verify patches were applied
if grep -q "# Submission (port 587) for Traefik TLS termination" "$NGINX_CONF"; then
  echo "Patch verification: OK"
fi

# Start nginx in foreground
exec /usr/sbin/nginx -g "daemon off;"
```

**Verification checks**:
- Mail protocol listeners added
- Admin location block added
- Root redirect added

**Failure handling**: Prints warnings but continues (fail-open approach)

## Configuration File Structure

### Before Patching (config.py output)

```nginx
# nginx.conf generated by Mailu config.py with TLS_FLAVOR=notls

mail {
    server {
        listen 25;
        protocol smtp;
        auth_http http://127.0.0.1:8000/auth/email;  # Wrong: localhost
    }
    # No 587, 465, 993, 995 listeners
}

http {
    server {
        listen 80;
        # No /admin location block
        location / {
            try_files $uri $uri/ =404;
        }
    }
}
```

### After Patching (wrapper script output)

```nginx
# nginx.conf after cdk8s-mailu patches applied

mail {
    server {
        listen 25;
        protocol smtp;
        auth_http http://admin-service.mailu.svc.cluster.local:8080/internal/auth/email;  # Fixed
    }

    # NEW: Submission listener
    server {
        listen 587;
        protocol smtp;
        smtp_auth plain;
        auth_http_header Auth-Port 587;
    }

    # NEW: SMTPS listener
    server {
        listen 465;
        protocol smtp;
        smtp_auth plain;
        auth_http_header Auth-Port 465;
    }

    # NEW: IMAPS listener
    server {
        listen 993;
        protocol imap;
        imap_auth plain;
        auth_http_header Auth-Port 993;
    }

    # NEW: POP3S listener
    server {
        listen 995;
        protocol pop3;
        pop3_auth plain;
        auth_http_header Auth-Port 995;
    }
}

http {
    server {
        listen 80;

        # NEW: Admin location block
        location /admin {
            auth_request /internal/auth/admin;
            proxy_pass http://$admin;
        }

        # MODIFIED: Root redirect
        location / {
            return 302 /webmail;
        }
    }
}
```

## Integration with Kubernetes

### Service Port Exposure

Front Service must expose all patched ports:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: front-service
spec:
  ports:
  - name: smtp-submission-tls
    port: 587
    targetPort: 587
  - name: smtp-smtps
    port: 465
    targetPort: 465
  - name: imap-imaps
    port: 993
    targetPort: 993
  - name: pop3-pop3s
    port: 995
    targetPort: 995
  - name: http
    port: 80
    targetPort: 80
  # ... (other ports)
```

### Traefik IngressRouteTCP

Traefik must route TLS traffic to Front:

```yaml
apiVersion: traefik.containo.us/v1alpha1
kind: IngressRouteTCP
metadata:
  name: mail-submission
spec:
  entryPoints:
    - smtp-submission  # 587
  routes:
  - match: HostSNI(`*`)
    services:
    - name: front-service
      port: 587
  tls:
    passthrough: false  # Traefik terminates TLS
```

**Traffic Flow**:
1. Mail client connects to Traefik:587 with TLS
2. Traefik terminates TLS
3. Traefik forwards plaintext to Front:587
4. nginx receives on patched listener
5. nginx authenticates via Admin
6. nginx proxies to Postfix:25

### Environment Variables Used

Wrapper script relies on these environment variables:

- `ADMIN_ADDRESS`: Admin service DNS name (set by MailuChart)
- `TLS_FLAVOR`: Must be "notls" for patches to make sense
- `HOSTNAMES`: Comma-separated list of domains (used by config.py)

## Troubleshooting

### Patch Not Applied

**Symptoms**: nginx fails to start, or mail clients get "connection refused"

**Check**:
1. Verify ConfigMap exists:
   ```bash
   kubectl get configmap -n mailu mailu-nginx-patch-configmap
   ```
2. Check wrapper script is executable:
   ```bash
   kubectl exec -n mailu deployment/front-deployment -- ls -l /entrypoint/entrypoint-wrapper.sh
   ```
3. Check init container logs:
   ```bash
   kubectl logs -n mailu deployment/front-deployment -c copy-entrypoint
   ```
4. Check main container logs for patch verification:
   ```bash
   kubectl logs -n mailu deployment/front-deployment | grep "Patch verification"
   ```

### Authentication Fails on Mail Protocols

**Symptoms**: Mail clients get "Authentication failed" on ports 587/993/995

**Check**:
1. Verify auth_http endpoint is correct:
   ```bash
   kubectl exec -n mailu deployment/front-deployment -- cat /etc/nginx/nginx.conf | grep auth_http
   ```
   Should show: `auth_http http://admin-service....:8080/internal/auth/email;`

2. Test Admin endpoint from Front pod:
   ```bash
   kubectl exec -n mailu deployment/front-deployment -- wget -O- http://admin-service:8080/internal/auth/email
   ```

### nginx Configuration Syntax Error

**Symptoms**: nginx fails to start with "configuration file test failed"

**Check**:
1. View full nginx configuration:
   ```bash
   kubectl exec -n mailu deployment/front-deployment -- cat /etc/nginx/nginx.conf
   ```
2. Test nginx configuration manually:
   ```bash
   kubectl exec -n mailu deployment/front-deployment -- nginx -t
   ```

**Common issues**:
- sed pattern didn't match (Mailu version changed template structure)
- Escaping issues in patch script
- Duplicate server blocks

### HTTP Location Blocks Not Working

**Note**: In cdk8s-mailu, HTTP traffic bypasses Front entirely:
- Traefik routes HTTP directly to Admin:8080 and Webmail:80
- Front's `/admin` location block and `/` redirect are unused
- This is **by design** for simplified architecture

## Code Reference

**Source**: [src/constructs/nginx-patch-configmap.ts](../../src/constructs/nginx-patch-configmap.ts)

**Key Components**:
- `NginxPatchConfigMap` class: Creates ConfigMap with wrapper script
- `wrapperScript` variable: Complete bash script with all patches
- sed patterns: Text transformations applied to nginx.conf

**Usage in MailuChart**:
```typescript
// Create nginx patch ConfigMap
this.nginxPatchConfigMap = new NginxPatchConfigMap(this, 'nginx-patch', {
  namespace: this.namespace,
});

// Mount in Front deployment
this.frontConstruct = new FrontConstruct(this, 'front', {
  config: this.config,
  namespace: this.namespace,
  sharedConfigMap: this.sharedConfigMap,
  nginxPatchConfigMap: this.nginxPatchConfigMap.configMap,
});
```

## See Also

- [Architecture Overview](architecture.md) - Complete system architecture
- [Authentication Flows](authentication-flows.md) - How auth_http protocol works
- [Component Specifications](../reference/component-specifications.md) - Front component details
- [TLS Configuration](../how-to/configure-tls.md) - Traefik TLS termination setup
