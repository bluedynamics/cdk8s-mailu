# Enable Optional Components

**How to enable or disable optional Mailu components based on your requirements.**

## Problem

You need to add optional features like webmail, antivirus scanning, CalDAV/CardDAV, or external email fetching to your Mailu deployment.

## Solution

The `MailuChart` accepts a `components` configuration object that controls which optional components are deployed. Core components (front, admin, postfix, dovecot, rspamd) are always enabled.

## Component Overview

### Core Components (Always Enabled)

| Component | Purpose | Can Disable? |
|-----------|---------|--------------|
| **Front** | Nginx reverse proxy | No (required) |
| **Admin** | Web admin interface | No (required) |
| **Postfix** | SMTP server | No (required) |
| **Dovecot** | IMAP/POP3 server | No (required) |
| **Rspamd** | Spam filter | No (required) |

### Optional Components (Disabled by Default)

| Component | Purpose | Resource Cost | Use Case |
|-----------|---------|---------------|----------|
| **Webmail** | Roundcube web interface | Low (100m/256Mi) | Web-based email access |
| **ClamAV** | Antivirus scanner | **High** (1000m/2Gi) | Virus scanning |
| **Fetchmail** | External account fetching | Low (50m/128Mi) | Consolidate external emails |
| **Webdav** | CalDAV/CardDAV server | Low (50m/128Mi) | Calendar/contact sync |

## Enable Webmail (Roundcube)

Add browser-based email access for users:

```typescript
import { App } from 'cdk8s';
import { MailuChart } from 'cdk8s-mailu';

const app = new App();

new MailuChart(app, 'mailu', {
  namespace: 'mailu',
  domain: 'example.com',
  hostnames: ['mail.example.com'],
  subnet: '10.42.0.0/16',

  // ... other config ...

  components: {
    webmail: true,  // Enable Roundcube webmail
  },
});

app.synth();
```

**Access webmail**: Navigate to `https://mail.example.com/webmail` (or your configured ingress hostname).

**Features**:
- Modern web interface for email
- Contact management
- Message filters and folders
- Mobile-responsive design

**Resources**: ~100m CPU, 256Mi memory (lightweight)

## Enable ClamAV (Antivirus)

⚠️ **Warning**: ClamAV is very resource-intensive. Only enable if virus scanning is a hard requirement.

```typescript
components: {
  clamav: true,
},

// ClamAV requires additional storage for virus signatures
storage: {
  storageClass: 'longhorn',
  clamav: { size: '10Gi' },  // Virus signature database
},

// Recommend higher resources for ClamAV
resources: {
  clamav: {
    requests: { cpu: '1000m', memory: '2Gi' },
    limits: { cpu: '4000m', memory: '4Gi' },
  },
},
```

**Startup time**: 5-10 minutes (downloads virus signatures on first start)

**Resources**: ~1000m CPU, 2Gi memory (very high)

**Consider alternatives**:
- Server-side scanning may not be necessary if users have endpoint antivirus
- Cloud-based scanning services (external)
- SPF/DKIM/DMARC for spam prevention (already included in Rspamd)

## Enable Fetchmail (External Account Fetching)

Pull emails from external POP3/IMAP accounts into Mailu:

```typescript
components: {
  fetchmail: true,
},
```

**Use case**: Consolidate multiple external email accounts (Gmail, Yahoo, etc.) into your Mailu server.

**Configuration**: After enabling, configure fetch rules via Mailu admin UI:
1. Login to Mailu admin: `https://mail.example.com/admin`
2. Navigate to **Fetch** section
3. Add external account credentials and fetch rules

**Resources**: ~50m CPU, 128Mi memory (minimal)

## Enable Webdav (CalDAV/CardDAV)

Add calendar and contact synchronization:

```typescript
components: {
  webdav: true,
},

// Webdav requires storage for calendar/contact data
storage: {
  storageClass: 'longhorn',
  webdav: { size: '20Gi' },  // Adjust based on user count
},
```

**Access**:
- **CalDAV**: `https://mail.example.com/webdav/<username>/calendar`
- **CardDAV**: `https://mail.example.com/webdav/<username>/contacts`

**Compatible clients**:
- Thunderbird (Lightning plugin)
- Apple Calendar and Contacts
- Android (DAVx⁵ app)
- iOS native calendar/contacts

**Resources**: ~50m CPU, 128Mi memory (minimal)

## Enable Multiple Optional Components

Combine multiple optional features:

```typescript
components: {
  webmail: true,    // Web-based email access
  fetchmail: true,  // External account consolidation
  webdav: true,     // Calendar and contacts
  clamav: false,    // Explicitly disabled (high resources)
},

storage: {
  storageClass: 'longhorn',
  webdav: { size: '20Gi' },
  // ClamAV storage not needed (disabled)
},
```

## Disable Optional Components

Optional components are disabled by default. Explicitly set to `false` if needed:

```typescript
components: {
  webmail: false,   // Disable webmail
  clamav: false,    // Disable antivirus
  fetchmail: false, // Disable external fetching
  webdav: false,    // Disable CalDAV/CardDAV
},
```

**Note**: Core components (front, admin, postfix, dovecot, rspamd) cannot be disabled.

## Apply Component Changes

After modifying component configuration:

```bash
# Regenerate manifests
npm run synth

# Apply changes
kubectl apply -f dist/mailu.k8s.yaml

# Watch new pods starting
kubectl get pods -n mailu -w
```

**Adding components**: New deployments and services will be created.

**Removing components**: Existing deployments and services will be deleted. PVCs are retained (manual cleanup required if desired).

## Verify Component Status

Check which components are running:

```bash
# List all Mailu pods
kubectl get pods -n mailu

# Expected pods with all optional components enabled:
# - mailu-front-*
# - mailu-admin-*
# - mailu-postfix-*
# - mailu-dovecot-*
# - mailu-rspamd-*
# - mailu-webmail-*        (if webmail enabled)
# - mailu-clamav-*         (if clamav enabled)
# - mailu-fetchmail-*      (if fetchmail enabled)
# - mailu-webdav-*         (if webdav enabled)

# Check services
kubectl get svc -n mailu
```

## Component-Specific Configuration

### Webmail Type (Roundcube vs SnappyMail)

Choose webmail client (Roundcube is default):

```typescript
components: {
  webmail: true,
},

mailu: {
  webmailType: 'roundcube',  // or 'snappymail'
},
```

**Roundcube**: Traditional, mature, full-featured PHP webmail (recommended).

**SnappyMail**: Modern, lightweight alternative.

## Resource Planning

Estimate total resource requirements with optional components:

### Minimal Deployment (Core Only)

**Total resources**:
- CPU requests: ~650m
- Memory requests: ~2.5Gi

```typescript
components: {
  // All optional components disabled (default)
},
```

### Full-Featured Deployment (All Optional)

**Total resources**:
- CPU requests: ~1.9Gi (including ClamAV)
- Memory requests: ~5.1Gi (including ClamAV)

```typescript
components: {
  webmail: true,
  clamav: true,
  fetchmail: true,
  webdav: true,
},
```

### Recommended Deployment (Webmail + Webdav)

**Total resources**:
- CPU requests: ~800m (no ClamAV)
- Memory requests: ~2.9Gi (no ClamAV)

```typescript
components: {
  webmail: true,
  fetchmail: false,  // Add if needed
  webdav: true,
  clamav: false,     // Skip unless required
},
```

## Troubleshooting

### ClamAV pod stuck in CrashLoopBackOff

**Symptom**: ClamAV pod fails to start with OOMKilled or initialization timeout.

**Solution**: Increase memory limits:

```typescript
resources: {
  clamav: {
    requests: { cpu: '1000m', memory: '2Gi' },
    limits: { cpu: '4000m', memory: '4Gi' },  // Increased
  },
},
```

Also ensure storage is adequate for virus signature database:

```bash
# Check PVC size
kubectl get pvc -n mailu | grep clamav
```

### Webmail not accessible

**Symptom**: `404 Not Found` when accessing `/webmail` URL.

**Solution**: Verify webmail component is enabled and pod is running:

```bash
# Check webmail pod status
kubectl get pods -n mailu | grep webmail

# Check webmail pod logs
kubectl logs -n mailu -l app.kubernetes.io/component=webmail

# Check service discovery
kubectl get configmap -n mailu mailu-config -o yaml | grep WEBMAIL
```

### Fetchmail not pulling emails

**Symptom**: External emails not appearing in Mailu mailboxes.

**Solution**: Check fetchmail configuration in admin UI and pod logs:

```bash
# Check fetchmail pod logs
kubectl logs -n mailu -l app.kubernetes.io/component=fetchmail

# Verify fetch rules configured in admin UI
# Navigate to https://mail.example.com/admin → Fetch
```

## See Also

- [Component Specifications](../reference/component-specifications.md) - Resource requirements per component
- [Scale Resources](scale-resources.md) - Adjust resource allocations
- [Customize Storage](customize-storage.md) - Configure PVC sizes
- [Configure TLS](configure-tls.md) - Set up ingress for webmail access
