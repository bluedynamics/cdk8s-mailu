# Nginx Configuration Patches

**How cdk8s-mailu patches nginx configuration for Traefik TLS termination.**

## Introduction

When using `TLS_FLAVOR=notls` with Traefik TLS termination, the Front nginx container requires configuration patches to:

1. Add mail protocol listeners for ports 587, 465, 993, 995
2. Configure auth_http to use Admin service instead of localhost

This document explains the patching mechanism and what changes are applied.

**Note**: In cdk8s-mailu, Traefik routes HTTP traffic directly to Admin and Webmail services, bypassing Front nginx entirely. Therefore, HTTP location blocks and redirects are **not needed** and not applied.

## Patch Architecture

### Why Patching is Needed

**Mailu's Default Behavior**:
- `TLS_FLAVOR=notls` only configures HTTP on port 80
- Mail protocol ports (587, 465, 993, 995) are NOT created
- Assumes TLS handled internally or not needed
- auth_http points to localhost:8000 (doesn't work in Kubernetes multi-pod architecture)

**cdk8s-mailu Requirements**:
- Traefik terminates TLS and forwards plaintext to nginx (for mail protocols only)
- nginx must listen on mail protocol ports to receive from Traefik
- nginx must authenticate via Admin service (separate pod)
- nginx must proxy to backend services after authentication (Postfix, Dovecot)

**Solution**: Wrapper script patches generated nginx.conf before nginx starts.

**HTTP Traffic**: Traefik routes HTTP directly to Admin and Webmail services, bypassing nginx completely.

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

Two patches are applied to the generated nginx.conf:

#### Patch 1: Fix auth_http Endpoint

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

#### Patch 2: Inject Mail Protocol Listeners

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

### Phase 3: Verify and Start

```bash
# Verify patches were applied
if ! grep -q "# Submission (port 587) for Traefik TLS termination" "$NGINX_CONF"; then
  echo "ERROR: Mail protocol patches not found in $NGINX_CONF"
  exit 1
fi

echo "Patch verification: OK - All patches applied successfully"

# Start nginx in foreground
exec /usr/sbin/nginx -g "daemon off;"
```

**Verification checks**:
- Mail protocol listeners added (ports 587, 465, 993, 995)
- Fails with error if patches not found

**Failure handling**: Exit immediately if patches not applied (fail-fast approach)

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
        # HTTP server (not used - Traefik routes directly to services)
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
        # HTTP server (not used - Traefik routes directly to services)
    }
}
```

## Integration with Kubernetes

### Service Port Exposure

Front Service exposes only TLS-terminated mail protocol ports (no HTTP or plaintext mail ports):

```yaml
apiVersion: v1
kind: Service
metadata:
  name: front-service
spec:
  ports:
  # TLS-terminated SMTP ports (Traefik terminates TLS, forwards plaintext to Front)
  - name: smtps
    port: 465
    targetPort: 465
  - name: submission
    port: 587
    targetPort: 587
  # TLS-terminated IMAP port
  - name: imaps
    port: 993
    targetPort: 993
  # TLS-terminated POP3 port
  - name: pop3s
    port: 995
    targetPort: 995
```

**Not exposed** (routed differently by Traefik):
- Port 25 (SMTP): Traefik routes directly to Postfix:25
- Port 80/443 (HTTP/HTTPS): Traefik routes directly to Admin:8080 and Webmail:80
- Port 143/110 (IMAP/POP3): Plaintext protocols disabled (use IMAPS/POP3S instead)

### Traefik Configuration

**Required Traefik EntryPoints** (configured in cluster infrastructure):
- `smtps` (465) - SMTPS with TLS termination
- `smtp-submission` (587) - Submission with TLS termination (or passthrough)
- `imaps` (993) - IMAPS with TLS termination
- `pop3s` (995) - POP3S with TLS termination

**Example IngressRouteTCP** (created by TraefikIngressConstruct):

```yaml
apiVersion: traefik.containo.us/v1alpha1
kind: IngressRouteTCP
metadata:
  name: mailu-submission
spec:
  entryPoints:
    - smtp-submission  # 587
  routes:
  - match: HostSNI(`*`)
    services:
    - name: front-service
      port: 587
  # Note: Submission (587) typically uses STARTTLS, not TLS wrapping
  # So TLS section may be omitted (passthrough)
```

**Example with TLS termination** (SMTPS/IMAPS/POP3S):

```yaml
apiVersion: traefik.containo.us/v1alpha1
kind: IngressRouteTCP
metadata:
  name: mailu-smtps
spec:
  entryPoints:
    - smtps  # 465
  routes:
  - match: HostSNI(`*`)
    services:
    - name: front-service
      port: 465
  tls:
    secretName: mailu-tls
    options:
      name: mailu-mail-tls
```

**Traffic Flow** (TLS-terminated mail protocols):
1. Mail client connects to Traefik:465/587/993/995 with TLS
2. Traefik terminates TLS (for 465/993/995; passthrough for 587)
3. Traefik forwards plaintext to Front:465/587/993/995
4. Front nginx receives on patched listener
5. Front nginx authenticates via Admin service
6. Front nginx proxies to backend (Postfix or Dovecot)

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

### HTTP Traffic Not Going Through Front

**This is expected behavior** in cdk8s-mailu:
- Traefik routes HTTP directly to Admin:8080 and Webmail:80
- Front nginx only handles mail protocols (SMTP, IMAP, POP3)
- This is **by design** for simplified architecture
- No HTTP location blocks or redirects are configured in Front nginx

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
