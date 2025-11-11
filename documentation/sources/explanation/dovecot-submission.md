# Dovecot Submission Service

**Understanding the dedicated dovecot submission service for webmail email sending.**

## Overview

The `DovecotSubmissionConstruct` provides a dedicated dovecot submission service that enables email sending from Roundcube webmail. This service was introduced to solve configuration challenges with the bundled dovecot in the front container when using `TLS_FLAVOR=notls` (required for Traefik TLS termination).

## The Problem

When a user sends an email from webmail, the webmail backend needs to submit that email to the SMTP server. Mailu's standard architecture uses the bundled dovecot service in the `front` container for this, but with `TLS_FLAVOR=notls`, configuring this bundled dovecot becomes extremely difficult because:

1. The front container's dovecot configuration is deeply embedded in Mailu's startup scripts
2. Environment variable substitution doesn't work properly with dovecot syntax
3. Configuration files are generated at runtime in read-only locations
4. Modifying the bundled dovecot requires extensive wrapper script modifications

## The Solution

Instead of fighting with the bundled dovecot, cdk8s-mailu deploys a **separate dovecot submission service** using the official `dovecot/dovecot:2.3-latest` image with custom configuration.

### Architecture

```
Webmail (Roundcube)
    ↓ PLAIN auth with token (port 10025)
Dovecot Submission Service
    - Accepts: nopassword=y (static passdb)
    - User: uid=mail (8), gid=mail
    - Mail location: maildir:/tmp/mail
    ↓ submission_relay_host (port 25, no auth)
Postfix
    - Trusts: mynetworks (10.42.0.0/16 pod network)
    - Accepts: plaintext from pod network
    ↓
Email Delivery ✅
```

### Key Features

**Clean Configuration**
- Uses standard dovecot.conf syntax
- No complex wrapper script modifications
- Easy to understand and troubleshoot

**Token Authentication**
- Webmail uses Mailu session tokens
- Dovecot accepts with `nopassword=y` static passdb
- Token validation happens at webmail level, not dovecot

**Trusted Network Relay**
- Dovecot relays to postfix:25 without authentication
- Postfix trusts pod network (`10.42.0.0/16`)
- No complex SASL configuration required

**Service Isolation**
- Dedicated pod with clear logs
- Independent scaling and resource management
- No conflicts with front container's dovecot usage

## Implementation Details

### Dovecot Configuration

The construct generates a dovecot.conf template with key settings:

```dovecot
# Protocols - only submission
protocols = submission

# Allow low UIDs (mail user is UID 8)
first_valid_uid = 8
last_valid_uid = 0

# Mail location (relay-only, no actual storage needed)
mail_location = maildir:/tmp/mail

# Submission relay configuration
submission_relay_host = postfix.mailu.svc.cluster.local
submission_relay_port = 25
submission_relay_trusted = yes
submission_relay_ssl = no

# Authentication via static passdb
passdb {
  driver = static
  args = nopassword=y
}

# User database (static, minimal config for relay)
userdb {
  driver = static
  args = uid=mail gid=mail home=/tmp
}
```

### Environment Variable Substitution

Dovecot doesn't support shell-style `${VAR}` syntax natively. The construct uses an entrypoint wrapper script that:

1. Uses `sed` to substitute placeholders (DOMAIN_PLACEHOLDER, SMTP_ADDRESS_PLACEHOLDER)
2. Validates the generated configuration with `doveconf -c`
3. Starts dovecot with the generated config

```bash
#!/bin/sh
set -e

mkdir -p /var/run/dovecot/runtime

sed "s/DOMAIN_PLACEHOLDER/${DOMAIN}/g; s/SMTP_ADDRESS_PLACEHOLDER/${SMTP_ADDRESS}/g" \
  /etc/dovecot/config/dovecot.conf.template > /var/run/dovecot/runtime/dovecot.conf

doveconf -c /var/run/dovecot/runtime/dovecot.conf > /dev/null || exit 1

exec /usr/sbin/dovecot -F -c /var/run/dovecot/runtime/dovecot.conf
```

### Service Discovery

The dovecot submission service is registered in the shared ConfigMap as `SUBMISSION_ADDRESS`:

```typescript
if (this.dovecotSubmissionConstruct?.service) {
  this.sharedConfigMap.addData(
    'SUBMISSION_ADDRESS',
    `${this.dovecotSubmissionConstruct.service.name}.${namespace}.svc.cluster.local`
  );
}
```

Webmail uses this environment variable to connect to the correct service, handling CDK8S's hash-based service names automatically.

## Architecture Requirements

### AMD64 Only

The official `dovecot/dovecot:2.3-latest` image only supports AMD64 architecture. The construct automatically adds:

**Node Selector**:
```yaml
nodeSelector:
  kubernetes.io/arch: amd64
```

**Toleration** (for AMD64 taint):
```yaml
tolerations:
  - key: kubernetes.io/arch
    operator: Equal
    value: amd64
    effect: NoSchedule
```

This ensures the pod is scheduled to an AMD64 node in mixed-architecture clusters.

### Filesystem Permissions

The container's `/etc/dovecot/` directory is read-only. The construct works around this by:

1. Mounting ConfigMap with templates to `/etc/dovecot/config/` (read-only, `defaultMode: 0o755` for executable entrypoint)
2. Generating runtime config in writable `/var/run/dovecot/runtime/` directory
3. Starting dovecot with `-c /var/run/dovecot/runtime/dovecot.conf`

**Important**: Avoid using `/var/run/dovecot/config` - dovecot has an internal "config" service that conflicts with a directory by that name.

## Webmail Integration

The `WebmailPatchConfigMap` construct patches Roundcube's configuration to use the dovecot submission service:

```bash
SUBMISSION_HOST="${SUBMISSION_ADDRESS:-dovecot-submission}"

sed -i "s|tls://[^:]*:10025|smtp://${SUBMISSION_HOST}:10025|g" "$RC_CONFIG"
```

This replaces the hardcoded `FRONT_ADDRESS:10025` reference with the dynamically discovered dovecot submission service.

## Authentication Flow

1. **User sends email from webmail**: Roundcube submits to `${SUBMISSION_HOST}:10025`

2. **Dovecot authenticates**: Static passdb with `nopassword=y` accepts the connection
   - Token validation happens at webmail level, not dovecot

3. **Dovecot relays to postfix**: Using `submission_relay_host`, dovecot forwards to `postfix:25` without authentication
   - Trusted network (pod CIDR)

4. **Postfix accepts and delivers**: Postfix trusts connections from the pod network and delivers the email

## Why This Approach Works

**No Postfix Authentication Required**:
- Connections come from trusted pod network
- Only the dovecot submission service can connect to postfix:25 from within the cluster
- Webmail has already authenticated the user via Mailu's SSO

**Token Authentication at Webmail Level**:
- Roundcube uses Mailu's session tokens
- By the time a request reaches dovecot submission, user is already authenticated
- Dovecot just needs to relay (not validate credentials)

**Separate Service Isolation**:
- Simplifies configuration (clean dovecot.conf instead of patching Mailu's templates)
- Enables easy troubleshooting (dedicated pod with clear logs)
- Allows independent scaling and resource management

## Configuration Example

```typescript
import { App } from 'cdk8s';
import { MailuChart } from 'cdk8s-mailu';

const app = new App();

new MailuChart(app, 'mailu', {
  namespace: 'mailu',
  domain: 'example.com',
  hostnames: ['mail.example.com'],
  subnet: '10.42.0.0/16',

  // Database configuration
  database: {
    type: 'postgresql',
    postgresql: {
      host: 'postgres-rw',
      port: 5432,
      database: 'mailu',
      secretName: 'postgres-app',
      secretKeys: {
        username: 'username',
        password: 'password',
      },
    },
  },

  // Redis configuration
  redis: {
    host: 'redis',
    port: 6379,
  },

  // Secrets
  secrets: {
    mailuSecretKey: 'mailu-secrets',
    initialAdminPassword: 'mailu-secrets',
  },

  // Optional: Custom dovecot submission resources
  resources: {
    dovecot: {
      requests: {
        cpu: '100m',
        memory: '256Mi',
      },
      limits: {
        cpu: '300m',
        memory: '512Mi',
      },
    },
  },
});

app.synth();
```

The dovecot submission service is automatically deployed as part of the MailuChart. No additional configuration required!

## Troubleshooting

### Dovecot pod stuck in CrashLoopBackOff

**Check logs**:
```bash
kubectl logs -n mailu -l app.kubernetes.io/component=dovecot-submission --tail=50
```

**Common issues**:

1. **Invalid configuration**: Dovecot config validation failed
   - Check for syntax errors in dovecot.conf template
   - Verify environment variable substitution worked

2. **Architecture mismatch**: Pod scheduled to ARM64 node
   - Verify nodeSelector and toleration are applied

3. **UID errors**: `first_valid_uid` not set correctly
   - Ensure `first_valid_uid = 8` is in the configuration

### Webmail can't send email

**Check webmail logs**:
```bash
kubectl logs -n mailu -l app.kubernetes.io/component=webmail --tail=50 | grep -i smtp
```

**Verify service discovery**:
```bash
kubectl get configmap -n mailu -l 'app.kubernetes.io/part-of=mailu' -o yaml | grep SUBMISSION_ADDRESS
```

Should show the full service name.

**Test connection**:
```bash
POD=$(kubectl get pod -n mailu -l app.kubernetes.io/component=webmail -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n mailu $POD -- nc -zv <submission-service-name> 10025
```

## See Also

- [Architecture Overview](architecture.md) - High-level design
- [CDK8S Patterns](cdk8s-patterns.md) - Construct design patterns
- [Webmail Configuration](../how-to/configure-construct.md) - Customizing webmail
