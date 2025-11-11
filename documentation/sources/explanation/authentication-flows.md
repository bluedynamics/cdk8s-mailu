# Authentication Flows

**Understanding authentication mechanisms in cdk8s-mailu deployments.**

## Introduction

cdk8s-mailu uses multiple authentication mechanisms depending on the access path and component. Understanding these flows is crucial for security configuration and troubleshooting access issues.

## Authentication Methods

### nginx auth_http Protocol (Mail Clients)

**Used for**: Authenticated SMTP submission (587/465) and IMAP/POP3 access (993/995) from mail clients (Thunderbird, Outlook, mobile apps).

**How it works**:

1. **Client Connection**: Mail client connects to Traefik on port 587, 465, 993, or 995
2. **TLS Termination**: Traefik decrypts TLS and forwards plaintext connection to Front (Nginx)
3. **Authentication Subrequest**: Before proxying to backend, Nginx makes an HTTP subrequest to Admin
   - URL: `http://admin-service:8080/internal/auth/email`
   - Headers: `Auth-User`, `Auth-Pass`, `Auth-Protocol`, `Client-IP`
4. **Credential Validation**: Admin queries PostgreSQL/SQLite for user credentials
5. **Response**:
   - **Success (HTTP 200)**: Admin returns backend server address in `Auth-Status: OK` header
   - **Failure (HTTP 403)**: Admin returns `Auth-Status: Invalid credentials`
6. **Backend Routing**: If authenticated, Nginx proxies connection to appropriate backend:
   - SMTP (587/465) → Postfix:25
   - IMAP (993/143) → Dovecot:143
   - POP3 (995/110) → Dovecot:110

**Key Points**:
- Authentication happens on **every connection** (not just once)
- Credentials never reach the backend services (Front handles auth)
- Admin acts as centralized authentication backend for all protocols
- Uses standard SMTP/IMAP/POP3 username/password authentication

**Configuration**:
- Implemented in nginx-patch-configmap.ts via `auth_http` directive
- TLS_FLAVOR=notls ensures Front receives plaintext after Traefik TLS termination
- Admin endpoint `/internal/auth/email` is internal-only (not exposed via Ingress)

**Code Reference**:
```typescript
// src/constructs/nginx-patch-configmap.ts
server {
  listen 587;
  auth_http http://admin-service:8080/internal/auth/email;
  proxy_pass postfix-service:25;
}
```

### SSO Integration (Webmail)

**Used for**: Roundcube webmail access via browser.

**How it works**:

1. **User Access**: User navigates to `https://webmail.example.com` in browser
2. **SSO Check**: Webmail (Roundcube) checks for existing SSO session via Admin
3. **Login Prompt**: If no session, Webmail redirects to Admin login page
4. **Admin Authentication**: User enters credentials, Admin validates against database
5. **Session Creation**: Admin creates SSO session (stored in PostgreSQL/SQLite)
6. **Redirect Back**: Admin redirects user back to Webmail with session token
7. **Session Validation**: Webmail validates session token with Admin
8. **Access Granted**: User accesses webmail interface

**Key Points**:
- Single Sign-On: Login once, access both Admin and Webmail
- Session-based: Browser cookie maintains authentication state
- Shared database: Admin and Webmail use same PostgreSQL database for session storage
- No password re-entry: Webmail trusts Admin's authentication

**Configuration**:
- Webmail environment variable: `ADMIN_ADDRESS` points to Admin service
- Admin environment variable: `WEB_ADMIN` and `WEB_WEBMAIL` configure URLs
- Session storage: PostgreSQL (production) or SQLite (development)

**Database Tables**:
- `user` - User accounts and credentials
- `domain` - Email domains
- Admin SSO session table (managed by Mailu Admin)

### Network Isolation Trust (Dovecot-Submission)

**Used for**: Webmail sending emails (Roundcube → Dovecot-Submission → Postfix).

**How it works**:

1. **User Composes Email**: User writes email in Roundcube web interface
2. **Session Already Authenticated**: User already logged in via Admin SSO
3. **Webmail → Dovecot-Submission**: Roundcube connects to `dovecot-submission-service:10025`
4. **Trust Model**: Dovecot-Submission accepts connection **without password validation**
   - Configuration: `auth_mechanisms = plain` with `nopassword=y`
   - Trust basis: Only webmail pod can reach this service (Kubernetes NetworkPolicy)
5. **Relay to Postfix**: Dovecot-Submission relays message to Postfix:25
6. **Delivery**: Postfix delivers to recipient's MX server

**Key Points**:
- **Not actual token authentication**: Despite documentation mentioning "tokens", this is network isolation trust
- **Network isolation**: Dovecot-Submission:10025 only accessible from webmail namespace/pods
- **No credential storage**: Webmail doesn't store user passwords
- **Session-based trust**: User authenticated to webmail session = trusted sender
- **Separate from Front**: Webmail bypasses Front/Nginx entirely for sending

**Why This Architecture?**

The separate dovecot-submission service exists because:
1. **Front's bundled dovecot was not configurable** for this use case
2. **Webmail needs to send without prompting for password again**
3. **Network isolation provides security** (only webmail can access submission port)
4. **Simplifies webmail configuration** (no complex credential management)

**Configuration**:

Dovecot-Submission service configuration (ConfigMap):
```
# Dovecot submission configuration
auth_mechanisms = plain
service auth {
  unix_listener auth-userdb {
    mode = 0600
    user = dovecot
  }
}
# Network isolation trust
passdb {
  driver = static
  args = nopassword=y allow_nets=0.0.0.0/0
}
```

Webmail environment variable:
```
SUBMISSION_HOST=dovecot-submission-service
SUBMISSION_PORT=10025
```

**Code Reference**:
- `src/constructs/dovecot-submission-construct.ts` - Separate submission service
- `src/constructs/webmail-construct.ts` - Webmail SUBMISSION_HOST configuration

### MX Mail Reception (No Authentication)

**Used for**: Receiving inbound email from internet mail servers.

**How it works**:

1. **External MTA → Traefik:25**: Internet mail server connects to your MX record
2. **Traefik → Postfix:25**: Traefik routes directly to Postfix (bypasses Front/Nginx)
3. **No Authentication Required**: SMTP MX reception is unauthenticated by design (RFC 5321)
4. **Spam Filtering**: Postfix calls Rspamd for spam/virus scanning
5. **Delivery**: If accepted, Postfix delivers via LMTP to Dovecot:2525

**Key Points**:
- **No credentials required**: MX reception must accept from any sender
- **Bypasses Front**: Port 25 traffic goes directly to Postfix
- **Spam protection**: Rspamd provides spam/virus filtering instead of authentication
- **Rate limiting**: Traefik InFlightConn + Postfix anvil limits prevent abuse

**Configuration**:
- Traefik IngressRouteTCP for port 25 routes directly to Postfix service
- Postfix configuration: `smtpd_relay_restrictions` controls who can relay
- No nginx auth_http on port 25

## Authentication Flow Comparison

| Access Path | Method | Authentication | Backend | Notes |
|-------------|--------|----------------|---------|-------|
| **Mail client SMTP (587/465)** | nginx auth_http | Username/password | Admin:8080 → Postfix:25 | Every connection authenticated |
| **Mail client IMAP/POP3 (993/995)** | nginx auth_http | Username/password | Admin:8080 → Dovecot:143/110 | Every connection authenticated |
| **Webmail access (HTTPS)** | SSO session | Username/password (first login) | Admin database | Session cookie for subsequent access |
| **Webmail sending (SMTP)** | Network isolation | None (trust) | Dovecot-Submission:10025 → Postfix:25 | Webmail session = trusted |
| **MX mail (port 25)** | None | None | Postfix:25 directly | Standard SMTP, spam filtering only |

## Security Considerations

### Credential Storage

- **User passwords**: Hashed in PostgreSQL/SQLite (bcrypt or similar)
- **Admin credentials**: Never stored in Kubernetes Secrets (only in database)
- **Webmail**: No password storage (relies on Admin SSO session)
- **API token**: Optional, stored in Secret if API enabled

### Network Security

- **TLS Termination**: Traefik handles all TLS (HTTPS, SMTPS, IMAPS, POP3S)
- **Plaintext backends**: All backend services receive plaintext (TLS_FLAVOR=notls)
- **Internal traffic**: Kubernetes service mesh (no encryption needed within cluster)
- **Dovecot-Submission isolation**: Only webmail namespace can access port 10025

### Authentication Best Practices

1. **Use PostgreSQL in production**: SQLite suitable only for small deployments
2. **Enable strong passwords**: Configure password complexity requirements in Admin
3. **Monitor auth failures**: Watch Admin logs for brute-force attempts
4. **Rate limiting**: Configure Traefik and Postfix rate limits
5. **API token protection**: If enabling API, use strong random token in Secret

## Troubleshooting Authentication Issues

### Mail Client Authentication Failures

**Symptoms**: "Invalid credentials" or "Authentication failed" in mail client

**Check**:
1. Verify credentials in Admin web UI (`https://admin.example.com`)
2. Check Admin logs for auth_http requests:
   ```bash
   kubectl logs -n mailu deployment/admin-deployment | grep auth/email
   ```
3. Verify Front can reach Admin:
   ```bash
   kubectl exec -n mailu deployment/front-deployment -- curl http://admin-service:8080/internal/auth/email
   ```
4. Check database connectivity (PostgreSQL or SQLite)

### Webmail Login Failures

**Symptoms**: Cannot login to webmail, or login page redirects loop

**Check**:
1. Verify SSO configuration in Admin environment variables:
   ```bash
   kubectl get deployment admin-deployment -n mailu -o jsonpath='{.spec.template.spec.containers[0].env}' | grep -E 'WEB_ADMIN|WEB_WEBMAIL'
   ```
2. Check database connection (Admin and Webmail share database)
3. Verify session storage is working (check Admin logs)
4. Clear browser cookies and retry

### Webmail Sending Failures

**Symptoms**: Cannot send email from webmail, but receiving works

**Check**:
1. Verify dovecot-submission service is running:
   ```bash
   kubectl get pods -n mailu | grep dovecot-submission
   ```
2. Check Webmail can reach dovecot-submission:
   ```bash
   kubectl exec -n mailu deployment/webmail-deployment -- nc -zv dovecot-submission-service 10025
   ```
3. Check dovecot-submission logs:
   ```bash
   kubectl logs -n mailu deployment/dovecot-submission-deployment
   ```
4. Verify SUBMISSION_HOST environment variable in Webmail

### MX Reception Issues

**Symptoms**: Cannot receive email from internet

**Check**:
1. Verify MX DNS records point to your server
2. Check Traefik IngressRouteTCP for port 25:
   ```bash
   kubectl get ingressroutetcp -A
   ```
3. Test SMTP from external server:
   ```bash
   telnet mail.example.com 25
   ```
4. Check Postfix logs for delivery errors:
   ```bash
   kubectl logs -n mailu deployment/postfix-deployment | grep 'status='
   ```

## See Also

- [Architecture Overview](architecture.md) - Complete system architecture with all flows
- [Component Specifications](../reference/component-specifications.md) - Port and service details
- [Nginx Configuration Patches](nginx-configuration-patches.md) - How nginx auth_http is implemented
- [Manage Secrets](../how-to/manage-secrets.md) - Secret management for credentials
