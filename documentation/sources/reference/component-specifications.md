# Component Specifications

**Technical specifications for all Mailu components deployed by cdk8s-mailu.**

This document provides detailed technical specifications for each component, including resource requirements, network ports, storage, and image versions.

## Core Components

Core components are always deployed and required for Mailu to function.

### Front (Nginx)

**Purpose**: Reverse proxy and protocol router for HTTP/S, SMTP, IMAP, and POP3.

**Image**: `ghcr.io/mailu/nginx:2024.06`

**Resources**:
- CPU Request: `100m`
- Memory Request: `256Mi`
- CPU Limit: `500m`
- Memory Limit: `512Mi`

**Network Ports**:
- `80/TCP` - HTTP (redirects to HTTPS)
- `443/TCP` - HTTPS (Web UI, admin, webmail)
- `25/TCP` - SMTP (mail submission)
- `465/TCP` - SMTPS (SMTP over TLS)
- `587/TCP` - Submission (mail submission with STARTTLS)
- `143/TCP` - IMAP (mail retrieval)
- `993/TCP` - IMAPS (IMAP over TLS)
- `110/TCP` - POP3 (mail retrieval)
- `995/TCP` - POP3S (POP3 over TLS)

**Storage**: None (stateless)

**Architecture Support**: AMD64, ARM64

**Environment Variables**:
- `TLS_FLAVOR=notls` - TLS handled by Traefik
- `SUBNET` - Kubernetes pod network CIDR
- `MESSAGE_SIZE_LIMIT` - Maximum email size (default: 50MB)
- `MESSAGE_RATELIMIT` - Rate limiting per user
- All service discovery variables from shared ConfigMap

---

### Admin

**Purpose**: Web-based administration interface and central configuration service.

**Image**: `ghcr.io/mailu/admin:2024.06`

**Resources**:
- CPU Request: `100m`
- Memory Request: `256Mi`
- CPU Limit: `500m`
- Memory Limit: `512Mi`

**Network Ports**:
- `80/TCP` - HTTP API and web interface

**Storage**:
- **PVC Size**: `5Gi` (default)
- **Mount Path**: `/data`
- **Contents**: User database, configuration, DKIM keys, TLS certificates (if not using Traefik)
- **Access Mode**: ReadWriteOnce
- **Storage Class**: Configurable (default: cluster default)

**Architecture Support**: AMD64, ARM64

**Environment Variables**:
- `SECRET_KEY` - Application secret for session encryption
- `DOMAIN` - Primary mail domain
- `HOSTNAMES` - Comma-separated list of all mail hostnames
- `POSTMASTER` - Postmaster email address
- `INITIAL_ADMIN_*` - Initial admin account configuration
- Database connection variables (PostgreSQL or SQLite)
- Redis connection variables

---

### Postfix

**Purpose**: SMTP server for sending and receiving email.

**Image**: `ghcr.io/mailu/postfix:2024.06`

**Resources**:
- CPU Request: `100m`
- Memory Request: `512Mi`
- CPU Limit: `500m`
- Memory Limit: `1Gi`

**Network Ports**:
- `25/TCP` - SMTP (internal relay)
- `10025/TCP` - LMTP (delivery from rspamd)

**Storage**:
- **PVC Size**: `5Gi` (default)
- **Mount Path**: `/queue`
- **Contents**: Mail queue
- **Access Mode**: ReadWriteOnce
- **Storage Class**: Configurable

**Architecture Support**: AMD64, ARM64

**Environment Variables**:
- `MESSAGE_SIZE_LIMIT` - Maximum message size
- `RELAYNETS` - Networks allowed to relay
- `RELAYHOST` - External SMTP relay (optional)
- Service discovery variables for dovecot, admin, rspamd

---

### Dovecot

**Purpose**: IMAP/POP3 server for mailbox access and mail storage.

**Image**: `ghcr.io/mailu/dovecot:2024.06`

**Resources**:
- CPU Request: `200m`
- Memory Request: `1Gi` (IMAP is memory-intensive)
- CPU Limit: `1000m`
- Memory Limit: `2Gi`

**Network Ports**:
- `143/TCP` - IMAP
- `993/TCP` - IMAPS
- `110/TCP` - POP3
- `995/TCP` - POP3S
- `2525/TCP` - LMTP (delivery to mailboxes)
- `4190/TCP` - ManageSieve (mail filtering)

**Storage**:
- **PVC Size**: `50Gi` (default, adjust based on user count)
- **Mount Path**: `/mail`
- **Contents**: User mailboxes (Maildir format)
- **Access Mode**: ReadWriteOnce
- **Storage Class**: Configurable
- **Sizing Guideline**: ~1-5GB per active user

**Architecture Support**: AMD64, ARM64

**Environment Variables**:
- `COMPRESSION` - Mail compression algorithm
- `COMPRESSION_LEVEL` - Compression level (1-9)
- Service discovery variables for admin, postfix

---

### Dovecot Submission

**Purpose**: Dedicated submission service for webmail email sending with token authentication.

**Image**: `dovecot/dovecot:2.3-latest`

**Resources**:
- CPU Request: `100m`
- Memory Request: `256Mi`
- CPU Limit: `300m`
- Memory Limit: `512Mi`

**Network Ports**:
- `10025/TCP` - Submission (webmail token auth)

**Storage**: None (relay-only service)

**Architecture Support**: AMD64 only

**Configuration**:
- Build-time substitution of `dovecot.conf`
- Static passdb with `nopassword=y`
- Relays to postfix:25 without authentication
- Trusts pod network (`submission_relay_trusted=yes`)

**Node Requirements**:
- Requires AMD64 node (official image limitation)
- Uses nodeSelector: `kubernetes.io/arch=amd64`
- Tolerates AMD64 taint if present

---

### Rspamd

**Purpose**: Spam filtering, DKIM signing/verification, and header manipulation.

**Image**: `ghcr.io/mailu/rspamd:2024.06`

**Resources**:
- CPU Request: `100m`
- Memory Request: `512Mi`
- CPU Limit: `500m`
- Memory Limit: `1Gi`

**Network Ports**:
- `11332/TCP` - HTTP API
- `11334/TCP` - Controller interface

**Storage**:
- **PVC Size**: `5Gi` (default)
- **Mount Path**: `/var/lib/rspamd`
- **Contents**: Bayes database, fuzzy hashes, statistics
- **Access Mode**: ReadWriteOnce
- **Storage Class**: Configurable

**Architecture Support**: AMD64, ARM64

**Environment Variables**:
- Service discovery variables for redis, admin

---

## Optional Components

Optional components can be enabled/disabled via configuration.

### Webmail (Roundcube)

**Purpose**: Browser-based email client with contact and calendar management.

**Image**: `ghcr.io/mailu/webmail:2024.06`

**Resources**:
- CPU Request: `100m`
- Memory Request: `256Mi`
- CPU Limit: `500m`
- Memory Limit: `512Mi`

**Network Ports**:
- `80/TCP` - HTTP interface

**Storage**: None (uses database for preferences)

**Architecture Support**: AMD64, ARM64

**Enabled by Default**: Yes

**Environment Variables**:
- `IMAP_ADDRESS` - Dovecot service name
- `SMTP_ADDRESS` - Postfix or dovecot-submission service name
- `SUBMISSION_ADDRESS` - Dovecot submission service name (for token auth)
- `WEBMAIL` - Service hostname

---

### ClamAV

**Purpose**: Antivirus scanning for email attachments.

**Image**: `ghcr.io/mailu/clamav:2024.06`

**Resources**:
- CPU Request: `500m`
- Memory Request: `1Gi` (virus database is large)
- CPU Limit: `2000m`
- Memory Limit: `2Gi`

**Network Ports**:
- `3310/TCP` - ClamAV daemon

**Storage**:
- **PVC Size**: `5Gi` (default)
- **Mount Path**: `/data`
- **Contents**: Virus signature database
- **Access Mode**: ReadWriteOnce
- **Storage Class**: Configurable

**Architecture Support**: AMD64, ARM64

**Enabled by Default**: No (high resource requirements)

**Startup Time**: 5-10 minutes (downloads virus database on first start)

---

### Fetchmail

**Purpose**: Fetch emails from external POP3/IMAP accounts.

**Image**: `ghcr.io/mailu/fetchmail:2024.06`

**Resources**:
- CPU Request: `50m`
- Memory Request: `128Mi`
- CPU Limit: `200m`
- Memory Limit: `256Mi`

**Network Ports**: None (outbound only)

**Storage**: None

**Architecture Support**: AMD64, ARM64

**Enabled by Default**: No

---

### WebDAV (Radicale)

**Purpose**: CalDAV and CardDAV server for calendar and contact sync.

**Image**: `ghcr.io/mailu/radicale:2024.06`

**Resources**:
- CPU Request: `50m`
- Memory Request: `128Mi`
- CPU Limit: `200m`
- Memory Limit: `256Mi`

**Network Ports**:
- `5232/TCP` - WebDAV interface

**Storage**:
- **PVC Size**: `5Gi` (default)
- **Mount Path**: `/data`
- **Contents**: Calendar and contact data
- **Access Mode**: ReadWriteOnce
- **Storage Class**: Configurable

**Architecture Support**: AMD64, ARM64

**Enabled by Default**: No

---

## External Dependencies

Components that must be provided externally.

### PostgreSQL

**Purpose**: Primary database for user accounts, aliases, and configuration.

**Recommended**: CloudNativePG (CNPG) operator for managed PostgreSQL

**Version**: PostgreSQL 12+ (tested with 15, 16)

**Connection**:
- Host: Service name (e.g., `postgres-rw` for CNPG read-write service)
- Port: `5432`
- Database: User-specified (e.g., `mailu`)
- Credentials: Via Kubernetes Secret

**Schema**: Automatically created by admin container on first start

**Replication**: Recommended (CNPG provides 3-replica HA by default)

---

### Redis

**Purpose**: Session storage and caching.

**Version**: Redis 6+ (tested with 7)

**Connection**:
- Host: Service name (e.g., `redis-master`)
- Port: `6379`
- No authentication required (cluster-internal)

**Persistence**: Optional (sessions can be regenerated)

**Replication**: Optional (single instance sufficient for most deployments)

---

## Resource Scaling Guidelines

### Small Deployment (< 50 users)

Use default resource requests. Suitable for:
- Personal use
- Small teams
- Development/testing

**Minimum Cluster Resources**: 4 CPU cores, 8GB RAM

---

### Medium Deployment (50-500 users)

Scale up memory-intensive components:
- Dovecot: `2Gi` memory request
- Rspamd: `1Gi` memory request
- Dovecot storage: `200Gi` (~4GB per user average)

**Recommended Cluster Resources**: 8 CPU cores, 16GB RAM

---

### Large Deployment (500+ users)

Consider:
- Multiple replicas (not yet supported by cdk8s-mailu)
- Dedicated PostgreSQL cluster with read replicas
- Redis cluster for HA
- Dovecot storage: Plan for 2-10GB per user
- Enable ClamAV only if virus scanning is required (high resource cost)

**Recommended Cluster Resources**: 16+ CPU cores, 32+ GB RAM

---

## Storage Recommendations

### Storage Class Selection

**Performance Tier** (Recommended for mailboxes):
- Dovecot PVC: Use fast storage (SSD-backed)
- High IOPS for mailbox operations

**Standard Tier** (Suitable for queues and caches):
- Postfix queue: Standard storage sufficient
- Rspamd data: Standard storage sufficient
- Admin data: Standard storage sufficient

**Example with Longhorn**:
- `longhorn` (2 replicas) for dovecot mailboxes
- `longhorn` (2 replicas) for other components
- `longhorn-redundant-app` (1 replica) if using database replication

---

## Network Policies

cdk8s-mailu does not currently create NetworkPolicy resources. Recommended policies:

**Ingress**:
- Front: Allow from ingress controller only
- Admin: Allow from front only
- Other services: Deny external ingress

**Egress**:
- All pods: Allow DNS
- Postfix: Allow to internet (port 25, 587) for mail delivery
- Fetchmail: Allow to internet (ports 110, 143, 993, 995)
- Other services: Cluster-internal only

---

## Image Version Management

**Version Strategy**: cdk8s-mailu uses fixed Mailu image versions for predictability.

**Current Version**: `2024.06`

**Updating Images**: Edit image references in construct files and rebuild manifests.

**Compatibility**:
- Mailu images are version-locked together (don't mix versions)
- Database schema migrations handled automatically by admin container
- Always backup before upgrading

---

## Health Checks

All components include liveness and readiness probes:

**Probe Types**:
- **TCP Socket**: Front, dovecot submission, dovecot, postfix
- **HTTP**: Admin, webmail, rspamd
- **Exec**: ClamAV (checks daemon status)

**Typical Settings**:
- Initial Delay: 10-30 seconds
- Period: 5-10 seconds
- Timeout: 3-5 seconds
- Failure Threshold: 3

**Long Startup Components**:
- ClamAV: 5-minute initial delay (virus database download)
- Dovecot submission: 30-second initial delay (AMD64 node scheduling)

---

## Security Context

**Non-Root Filesystem**: Disabled for mail services (require write access to system directories)

**User/Group IDs**:
- Most containers: Run as root (required for port binding <1024)
- Dovecot submission: UID 8 (mail user)

**Capabilities**: Default (no special capabilities required)

---

## See Also

- [Configuration Options](configuration-options.md) - Complete configuration reference
- [Scale Resources](../how-to/scale-resources.md) - Adjust CPU and memory based on these specs
- [Customize Storage](../how-to/customize-storage.md) - Configure PVC sizes for components
- [Enable Optional Components](../how-to/enable-optional-components.md) - Add/remove components
- [Architecture](../explanation/architecture.md) - Understanding component relationships
