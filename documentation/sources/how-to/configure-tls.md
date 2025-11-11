# Configure TLS Termination

**How to set up TLS/SSL encryption for Mailu using Traefik ingress controller.**

## Problem

You need to configure secure HTTPS access to Mailu webmail and admin interfaces, plus TLS-encrypted SMTP/IMAP/POP3 connections for mail clients.

## Solution

The `cdk8s-mailu` library is designed for **Traefik TLS termination**. Traefik handles TLS certificates (Let's Encrypt) and decrypts traffic, while Mailu components communicate in plaintext internally. This is the recommended production pattern for Kubernetes deployments.

## Architecture Overview

**TLS Termination Flow**:

```
Client (TLS)
    ↓
Traefik IngressRoute (TLS termination with Let's Encrypt)
    ↓
Mailu Front Service (plaintext, port 80 for HTTP, 25/587/465/993/995 for mail)
    ↓
Backend Services (plaintext internal communication)
```

**Why this design?**:
- Centralized certificate management (Traefik + cert-manager)
- Automatic certificate renewal
- No certificate distribution to mail pods
- Standard Kubernetes ingress pattern

## Prerequisites

Before configuring TLS, ensure you have:

1. **Traefik ingress controller** installed
2. **cert-manager** installed (for Let's Encrypt certificates)
3. **DNS records** pointing to your cluster:
   - `mail.example.com` → Cluster ingress IP
4. **Cluster ingress** accessible from internet (ports 80, 443, 25, 587, 465, 993, 995)

## Built-in TLS Configuration

`cdk8s-mailu` automatically configures Mailu for Traefik TLS termination:

```typescript
import { App } from 'cdk8s';
import { MailuChart } from 'cdk8s-mailu';

const app = new App();

new MailuChart(app, 'mailu', {
  namespace: 'mailu',
  domain: 'example.com',
  hostnames: ['mail.example.com'],  // Used for TLS certificate
  subnet: '10.42.0.0/16',

  // ... database, redis, secrets config ...
});

app.synth();
```

**What this does automatically**:
- Sets `TLS_FLAVOR=notls` (Traefik handles TLS, not Mailu)
- Mounts nginx-patch ConfigMap to Front container
- Patches nginx to support mail protocol TLS ports (587, 465, 993, 995)
- Configures plaintext internal communication between components

**No additional TLS configuration needed** in the CDK8S code!

## Create Traefik IngressRoute

After deploying Mailu with `cdk8s-mailu`, create Traefik IngressRoutes for HTTP/HTTPS and mail protocols.

### Step 1: Create TLS Certificate

Use cert-manager to provision a Let's Encrypt certificate:

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: mailu-tls
  namespace: mailu
spec:
  secretName: mailu-tls-cert
  issuerRef:
    name: letsencrypt-prod  # Your ClusterIssuer
    kind: ClusterIssuer
  dnsNames:
    - mail.example.com
```

Apply:
```bash
kubectl apply -f mailu-certificate.yaml

# Wait for certificate to be ready
kubectl get certificate -n mailu -w
```

### Step 2: Create HTTP/HTTPS IngressRoute

Route web traffic (admin UI, webmail) through Traefik:

```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: mailu-web
  namespace: mailu
spec:
  entryPoints:
    - websecure  # HTTPS entry point
  routes:
    - match: Host(`mail.example.com`)
      kind: Rule
      services:
        - name: mailu-front
          port: 80  # Mailu front service (plaintext internal)
  tls:
    secretName: mailu-tls-cert  # Certificate from cert-manager
---
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: mailu-web-redirect
  namespace: mailu
spec:
  entryPoints:
    - web  # HTTP entry point
  routes:
    - match: Host(`mail.example.com`)
      kind: Rule
      middlewares:
        - name: redirect-to-https
      services:
        - name: mailu-front
          port: 80
---
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: redirect-to-https
  namespace: mailu
spec:
  redirectScheme:
    scheme: https
    permanent: true
```

### Step 3: Create Mail Protocol IngressRoutes

Route SMTP, IMAP, POP3 traffic with TLS termination:

```yaml
# SMTP Submission (port 587)
apiVersion: traefik.io/v1alpha1
kind: IngressRouteTCP
metadata:
  name: mailu-smtp-submission
  namespace: mailu
spec:
  entryPoints:
    - smtp-submission  # Traefik TCP entry point on port 587
  routes:
    - match: HostSNI(`*`)
      services:
        - name: mailu-front
          port: 587
  tls:
    secretName: mailu-tls-cert
---
# SMTPS (port 465)
apiVersion: traefik.io/v1alpha1
kind: IngressRouteTCP
metadata:
  name: mailu-smtps
  namespace: mailu
spec:
  entryPoints:
    - smtps  # Traefik TCP entry point on port 465
  routes:
    - match: HostSNI(`*`)
      services:
        - name: mailu-front
          port: 465
  tls:
    secretName: mailu-tls-cert
---
# IMAPS (port 993)
apiVersion: traefik.io/v1alpha1
kind: IngressRouteTCP
metadata:
  name: mailu-imaps
  namespace: mailu
spec:
  entryPoints:
    - imaps  # Traefik TCP entry point on port 993
  routes:
    - match: HostSNI(`*`)
      services:
        - name: mailu-front
          port: 993
  tls:
    secretName: mailu-tls-cert
---
# POP3S (port 995)
apiVersion: traefik.io/v1alpha1
kind: IngressRouteTCP
metadata:
  name: mailu-pop3s
  namespace: mailu
spec:
  entryPoints:
    - pop3s  # Traefik TCP entry point on port 995
  routes:
    - match: HostSNI(`*`)
      services:
        - name: mailu-front
          port: 995
  tls:
    secretName: mailu-tls-cert
---
# SMTP (port 25, plaintext for receiving mail from other servers)
# Port 25 routes directly to Postfix (bypassing Front/nginx) with rate limiting
apiVersion: traefik.io/v1alpha1
kind: MiddlewareTCP
metadata:
  name: smtp-connection-limit
  namespace: mailu
spec:
  inFlightConn:
    amount: 15  # Max 15 simultaneous connections per source IP
---
apiVersion: traefik.io/v1alpha1
kind: IngressRouteTCP
metadata:
  name: mailu-smtp
  namespace: mailu
spec:
  entryPoints:
    - smtp  # Traefik TCP entry point on port 25
  routes:
    - match: HostSNI(`*`)
      middlewares:
        - name: smtp-connection-limit  # Apply rate limiting
      services:
        - name: mailu-postfix  # Direct to Postfix (bypasses Front/nginx)
          port: 25
  # No TLS for port 25 (SMTP servers use STARTTLS opportunistically)
```

Apply:
```bash
kubectl apply -f mailu-ingressroutes.yaml
```

### Step 4: Configure Traefik Entry Points

Ensure Traefik has the required TCP entry points configured. This is typically done in Traefik's Helm values or static configuration:

```yaml
# Traefik Helm values or static config
ports:
  web:
    port: 80
    exposedPort: 80
  websecure:
    port: 443
    exposedPort: 443
  smtp:
    port: 25
    exposedPort: 25
  smtp-submission:
    port: 587
    exposedPort: 587
  smtps:
    port: 465
    exposedPort: 465
  imaps:
    port: 993
    exposedPort: 993
  pop3s:
    port: 995
    exposedPort: 995
```

## SMTP Rate Limiting Strategy

Port 25 (SMTP) uses a **hybrid rate limiting approach** to protect against spam and connection flooding:

### Layer 1: Traefik InFlightConn (Ingress Level)

The `MiddlewareTCP` resource limits **simultaneous connections** per source IP:

```yaml
apiVersion: traefik.io/v1alpha1
kind: MiddlewareTCP
metadata:
  name: smtp-connection-limit
  namespace: mailu
spec:
  inFlightConn:
    amount: 15  # Max 15 concurrent connections per IP
```

**What it protects against**:
- Connection flooding attacks
- Resource exhaustion at ingress layer
- Fast rejection before traffic reaches Postfix

**Limitations**:
- Does NOT limit connection rate over time (e.g., rapid connect/disconnect)
- Does NOT limit message rate or recipient rate

### Layer 2: Postfix anvil (Application Level)

Postfix's built-in `anvil(8)` daemon provides comprehensive SMTP rate limiting:

**Configured automatically by cdk8s-mailu**:
```typescript
// In PostfixConstruct - automatically applied
POSTFIX_smtpd_client_connection_rate_limit: "60"   // 60 connections per minute per IP
POSTFIX_smtpd_client_connection_count_limit: "10"  // 10 simultaneous connections per IP
POSTFIX_smtpd_client_message_rate_limit: "100"     // 100 messages per minute per IP
POSTFIX_smtpd_client_recipient_rate_limit: "300"   // 300 recipients per minute per IP
POSTFIX_anvil_rate_time_unit: "60s"                // Time unit for rate calculations
```

**What it protects against**:
- High connection rates (rapid connect/disconnect attacks)
- Message flooding
- Recipient harvesting attacks
- Spam relay attempts

**How it works**:
- Postfix `anvil` daemon tracks per-IP statistics in memory
- Automatically rejects connections/messages exceeding limits with SMTP error codes
- Trusted networks (defined in `$mynetworks`) are exempt from limits
- Statistics reset on Postfix pod restart (no persistent state)

### Why Port 25 Bypasses nginx

**Traditional Mailu architecture**:
```
Port 25: Traefik → Front (nginx) → Postfix
```

**Optimized architecture** (used by cdk8s-mailu):
```
Port 25: Traefik (InFlightConn) → Postfix (anvil rate limits)
```

**Rationale**:
- Port 25 never requires authentication (RFC 5321 - MX mail delivery standard)
- nginx provides zero security value for port 25 (no auth to proxy)
- Postfix has robust spam filtering (Rspamd, DNSBL, rate limiting)
- Reduced latency for incoming mail (one less proxy hop)
- Improved reliability (nginx restart doesn't affect MX delivery)

**Authenticated ports (587, 465, 993, 995)** still route through Front (nginx) for protocol-aware authentication proxy.

### Adjusting Rate Limits

If you need to customize rate limits for your deployment size:

**Small deployments (< 50 users)**:
- Use default limits (60 conn/min, 100 msg/min)

**Medium deployments (50-500 users)**:
- Increase Traefik InFlightConn: `amount: 25`
- Increase Postfix limits:
  - `connection_rate_limit: 120`
  - `message_rate_limit: 200`

**Large deployments (500+ users)**:
- Increase Traefik InFlightConn: `amount: 50`
- Increase Postfix limits:
  - `connection_rate_limit: 180`
  - `message_rate_limit: 300`

**Note**: Rate limits should protect against abuse, not regulate legitimate traffic. Most legitimate mail servers send at well below these thresholds.

## Verify TLS Configuration

### Test HTTPS Access

```bash
# Should return 200 OK and valid TLS certificate
curl -I https://mail.example.com/admin

# Check certificate details
openssl s_client -connect mail.example.com:443 -servername mail.example.com < /dev/null 2>/dev/null | openssl x509 -noout -subject -dates
```

### Test Mail Protocols

**SMTP Submission (587)**:
```bash
openssl s_client -connect mail.example.com:587 -starttls smtp
# Should show TLS handshake success
```

**IMAPS (993)**:
```bash
openssl s_client -connect mail.example.com:993
# Should show TLS handshake and IMAP greeting
```

**SMTPS (465)**:
```bash
openssl s_client -connect mail.example.com:465
# Should show TLS handshake and SMTP greeting
```

### Configure Email Client

Use these settings in your email client (Thunderbird, Outlook, etc.):

**Incoming Mail (IMAP)**:
- Server: `mail.example.com`
- Port: `993`
- Security: `SSL/TLS`
- Authentication: `Normal password`

**Outgoing Mail (SMTP)**:
- Server: `mail.example.com`
- Port: `587` (or `465`)
- Security: `STARTTLS` (587) or `SSL/TLS` (465)
- Authentication: `Normal password`

## Troubleshooting

### Certificate not provisioned

**Symptom**: Certificate stuck in "Issuing" state or shows errors.

```bash
# Check certificate status
kubectl describe certificate -n mailu mailu-tls

# Check cert-manager logs
kubectl logs -n cert-manager deploy/cert-manager

# Common causes:
# - DNS not pointing to cluster
# - Firewall blocking port 80 (Let's Encrypt HTTP-01 challenge)
# - Rate limit exceeded (Let's Encrypt has rate limits)
```

**Solution**: Verify DNS and ensure port 80 is accessible from internet.

### Mail client cannot connect

**Symptom**: Email client shows connection timeout or certificate errors.

```bash
# Test connectivity from outside cluster
telnet mail.example.com 587
telnet mail.example.com 993

# Check IngressRoute status
kubectl get ingressroutetcp -n mailu

# Check Traefik logs
kubectl logs -n kube-system -l app.kubernetes.io/name=traefik
```

**Common causes**:
- Traefik entry points not configured for mail ports
- Firewall blocking mail ports
- Service type not LoadBalancer or NodePort

### TLS handshake failures

**Symptom**: `openssl s_client` fails or shows certificate errors.

**Solution**: Verify certificate secret exists and contains valid data:

```bash
# Check secret
kubectl get secret -n mailu mailu-tls-cert

# View certificate details
kubectl get secret -n mailu mailu-tls-cert -o jsonpath='{.data.tls\.crt}' | base64 -d | openssl x509 -noout -text
```

### Webmail not accessible over HTTPS

**Symptom**: HTTPS redirects failing or webmail shows "not found".

**Solution**: Check IngressRoute and service:

```bash
# Verify IngressRoute exists
kubectl get ingressroute -n mailu

# Test internal service
kubectl port-forward -n mailu svc/mailu-front 8080:80
curl http://localhost:8080/admin
```

## Alternative: NodePort for Testing

For testing without Traefik, use NodePort service type (not recommended for production):

```bash
# Expose Front service as NodePort (after deploying with cdk8s-mailu)
kubectl patch svc -n mailu mailu-front -p '{"spec":{"type":"NodePort"}}'

# Get assigned node ports
kubectl get svc -n mailu mailu-front

# Access via http://<node-ip>:<node-port>
```

**Note**: This exposes Mailu without TLS encryption. Only use for testing.

## See Also

- [Dovecot Submission Service](../explanation/dovecot-submission.md) - Understanding webmail email sending
- [Architecture](../explanation/architecture.md) - Component relationships
- [Manage Secrets](manage-secrets.md) - Creating TLS certificate secrets manually
- [Traefik Documentation](https://doc.traefik.io/traefik/routing/routers/) - IngressRoute configuration
- [cert-manager Documentation](https://cert-manager.io/docs/) - Certificate provisioning
