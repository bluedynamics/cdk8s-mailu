# Component Specifications

**Technical specifications for all Mailu components deployed by cdk8s-mailu.**

This document provides detailed technical specifications for each component, including resource requirements, network ports, storage, and image versions.

## Port Reference Table

Complete reference of all network ports used by Mailu components:

| Component | Port | Protocol | Purpose | Exposed | Internal Only |
|-----------|------|----------|---------|---------|---------------|
| **Admin** | 8080 | HTTP | Admin API and web interface | ✓ | |
| **Admin** | 8080 | HTTP | auth_http endpoint (/internal/auth/email) | | ✓ |
| **ClamAV** | 3310 | ClamAV | Antivirus scanning | | ✓ |
| **Dovecot** | 110 | POP3 | Mail retrieval (via Front after auth) | ✓ | |
| **Dovecot** | 143 | IMAP | Mail retrieval (via Front after auth) | ✓ | |
| **Dovecot** | 993 | IMAPS | IMAP over TLS (via Front after auth) | ✓ | |
| **Dovecot** | 995 | POP3S | POP3 over TLS (via Front after auth) | ✓ | |
| **Dovecot** | 2525 | LMTP | Mail delivery from Postfix | | ✓ |
| **Dovecot-Sub** | 10025 | Submission | SMTP relay from webmail | | ✓ |
| **Front** | 465 | Submission | SMTP submission (plaintext from Traefik), container port 10465 | ✓ | |
| **Front** | 993 | IMAP | IMAP access (plaintext from Traefik), container port 10993 | ✓ | |
| **Front** | 995 | POP3 | POP3 access (plaintext from Traefik), container port 10995 | ✓ | |
| **Front** | 8080 | HTTP | Health endpoint `/health` for the probes, not on the Service | | ✓ |
| **Postfix** | 25 | SMTP | SMTP relay and MX reception | ✓ | |
| **Postfix** | 10025 | Submission | Authenticated submission relayed by Front | | ✓ |
| **Rspamd** | 11332 | Milter | Spam scanning from Postfix | | ✓ |
| **Rspamd** | 11333 | Fuzzy | Fuzzy hash storage | | ✓ |
| **Rspamd** | 11334 | HTTP | Web UI and API | ✓ | |
| **WebDAV** | 5232 | HTTP | CalDAV/CardDAV | ✓ | |
| **Webmail** | 80 | HTTP | Webmail interface | ✓ | |

**Notes**:
- **Exposed**: Accessible from outside the pod via Kubernetes Service
- **Internal Only**: Used for inter-component communication only
- **TLS_FLAVOR=notls Architecture** (used with Traefik ingress):
  - Traefik handles ALL TLS termination (HTTPS, SMTPS, IMAPS, POP3S)
  - Front is ONLY used for authenticated mail protocols (465/993/995)
  - Front receives **plaintext** traffic after Traefik decrypts
  - Front does NOT handle HTTP/HTTPS web traffic (Traefik routes directly to Admin/Webmail)
  - MX mail (port 25) routes directly to Postfix, bypassing Front
  - The Front Service has only the ports 465, 993, and 995
- **Front's Role**: Authentication proxy for mail protocols using nginx auth_http to validate credentials with Admin before relaying to backends

## Core Components

Core components are always deployed and required for Mailu to function.

### Front (Nginx)

**Purpose**: Mail proxy that authenticates SMTPS, IMAPS, and POP3S sessions against Admin and relays them to Postfix or Dovecot.
It serves no HTTP and receives no mail from other servers.

**Image**: `nginx:1.30.7-alpine`, the official nginx image.
Set another one with `images.front`.
`images.registry` and `images.tag` do not apply to the front.

**Command**: `nginx -c /etc/nginx/nginx.conf -g 'daemon off;'`

**Resources** (when `resources.front` is not set):
- CPU Request: `10m`
- Memory Request: `16Mi`
- CPU Limit: `100m`
- Memory Limit: `64Mi`

**Network Ports**:

| Service port | Container port | Protocol after TLS termination | Relayed to |
|---|---|---|---|
| `465/TCP` | `10465` | SMTP submission | Postfix `10025` |
| `993/TCP` | `10993` | IMAP | Dovecot `143` |
| `995/TCP` | `10995` | POP3 | Dovecot `110` |
| not on the Service | `8080` | HTTP, `/health` answers 204 | |

There is no port 587: Traefik cannot terminate STARTTLS for SMTP, and a plaintext listener would accept `AUTH PLAIN` without TLS.
Mail clients submit on 465.

**Configuration**: one ConfigMap with the key `nginx.conf`, mounted read-only at `/etc/nginx/nginx.conf`.
The configuration is derived from these options:

| Option | Effect on the configuration |
|---|---|
| `hostnames[0]` | `server_name`, the name in the greeting |
| `namespace` and the name of the Admin Service | host in `auth_http` |
| `mailu.messageSizeLimit` | `SIZE` in the SMTP capabilities |
| `ingress.traefik.proxyProtocolToFront` | `proxy_protocol` on every listener and `set_real_ip_from` |
| `subnet` | network in `set_real_ip_from` |

The pod template carries the annotation `checksum/config`.
A changed configuration changes the annotation and rolls the pod.

nginx resolves the host in `auth_http` only at start.

**Capacity**: about 1000 concurrent mail sessions.
nginx runs two worker processes with 1024 connections each, and a relayed session takes two connections.
Both values are fixed.

**Storage**: None (stateless), an `emptyDir` at `/tmp` for the pid file

**Architecture Support**: AMD64, ARM64

**Environment Variables**: None.
The front gets neither the shared ConfigMap nor a secret.

**Security Context**: user and group `101`, `runAsNonRoot`, read-only root filesystem, no privilege escalation, all capabilities dropped, seccomp profile `RuntimeDefault`

**Probes**: liveness and readiness with HTTP GET `/health` on port 8080

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
- `8080/TCP` - HTTP API and web interface (internal service port). The Ingress exposes only `/admin`, `/sso` and `/static`. The `/internal` API has no authentication and serves DKIM private keys, so only cluster components reach it through the Service.

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
- `25/TCP` - SMTP (MX mail reception and internal relay)
- `10025/TCP` - Internal submission relay (from dovecot-submission service)

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
- `4190/TCP` - ManageSieve (mail filtering) - **NOT EXPOSED** (Service does not include this port)

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
- `11332/TCP` - Milter protocol (spam scanning from Postfix)
- `11333/TCP` - Fuzzy hash storage (spam detection)
- `11334/TCP` - HTTP API and web interface

**Storage**:
- **PVC Size**: `5Gi` (default)
- **Mount Path**: `/var/lib/rspamd`
- **Contents**: Bayes database, fuzzy hashes, statistics
- **Access Mode**: ReadWriteOnce
- **Storage Class**: Configurable

**Architecture Support**: AMD64, ARM64

**Environment Variables**:
- Service discovery variables for redis, admin

**Sidecar: Unbound DNS Resolver**:
- **Image**: `crazymax/unbound:1.24.0` (multi-arch: AMD64, ARM64)
- **Port**: `53/TCP+UDP` (bound to `0.0.0.0`, access restricted to localhost and pod network)
- **CPU**: 10m request / 50m limit
- **Memory**: 32Mi request / 64Mi limit
- **Config Mount**: `/config/custom.conf` (via subPath from ConfigMap)
- **Purpose**: Recursive DNS for RBL lookups (Spamhaus, Barracuda, and the other rspamd default RBLs)

**Configuration Overrides** (mounted at `/overrides/`):

| File | Mailu handling | Purpose |
|------|----------------|---------|
| `actions.conf` | copied to `local.d/` | Scoring thresholds (reject=12, add_header=5, greylist=3) |
| `rbl.conf` | copied to `local.d/` | Adds the Barracuda RBL (`RBL_BARRACUDA`) |
| `groups.conf` | copied to `local.d/` | Score for `RBL_BARRACUDA` (2.0) |
| `metrics.conf` | merged into Mailu's file | Restores scores of `FUZZY_DENIED` (12), `FUZZY_PROB` (5), `FUZZY_WHITE` (-2.1), `FUZZY_UNKNOWN` (5) |
| `milter_headers.conf` | merged into Mailu's file | Adds the `X-Spamd-Result` header |

Overrides that Mailu merges must not set keys that Mailu's file already sets, because merging turns them into arrays.
Do not override `classifier-bayes.conf` or `fuzzy_check.conf`.

**DNS Override** (`/conf/options.inc`):
- Points rspamd DNS to Unbound sidecar at `127.0.0.1:53`

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
- Admin: Allow from the ingress controller and from the other Mailu components
- Postfix and Dovecot: Allow the backend ports only from the other Mailu components, because they trust every client inside `subnet`
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
- **TCP Socket**: Dovecot submission, dovecot, postfix
- **HTTP**: Front, admin, webmail, rspamd
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

**Read-Only Root Filesystem**: Enabled for Front, disabled for the Mailu images (they write to system directories)

**User/Group IDs**:
- Mailu images: Run as root (required for port binding <1024)
- Front: UID 101 (nginx user), listens on ports above 1024
- Dovecot submission: UID 8 (mail user)

**Capabilities**: All dropped for Front; default for the other containers

---

## See Also

- [Configuration Options](configuration-options.md) - Complete configuration reference
- [Scale Resources](../how-to/scale-resources.md) - Adjust CPU and memory based on these specs
- [Customize Storage](../how-to/customize-storage.md) - Configure PVC sizes for components
- [Enable Optional Components](../how-to/enable-optional-components.md) - Add/remove components
- [Architecture](../explanation/architecture.md) - Understanding component relationships
