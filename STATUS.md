# CDK8S Mailu - Project Status

**Status**: Initial Setup Complete ✅
**Date**: 2025-11-09
**Phase**: A1 - Chart Project Setup

## What's Been Completed

### ✅ Project Infrastructure
- [x] Projen-based project setup (similar to cdk8s-plone)
- [x] TypeScript configuration with strict type checking
- [x] GitHub repository structure
- [x] Build scripts and development workflow
- [x] ESLint and Jest configuration
- [x] GitHub Actions workflows (build, PR lint, auto-upgrade)

### ✅ Core TypeScript Code
- [x] **Configuration Interface** (`src/config.ts`)
  - Comprehensive `MailuChartConfig` interface
  - Database configuration (PostgreSQL + SQLite support)
  - Redis configuration
  - Secret references (no inline values)
  - Storage configuration per component
  - Component toggles
  - Resource limits
  - Mailu-specific settings

- [x] **Main Chart Class** (`src/mailu-chart.ts`)
  - `MailuChart` class extending CDK8S Chart
  - Namespace creation
  - Shared ConfigMap for environment variables
  - Placeholder methods for all components (admin, front, postfix, dovecot, rspamd, webmail, clamav, fetchmail, webdav)
  - Component toggle logic

- [x] **Package Exports** (`src/index.ts`)
  - Exports configuration interface
  - Exports main chart class

### ✅ Documentation
- [x] Comprehensive README with:
  - Feature list
  - Installation instructions
  - Quick start guide
  - Configuration examples
  - Architecture overview
  - DNS configuration guide
  - Security considerations

### ✅ Examples
- [x] Simple deployment example (`examples/simple-deployment.ts`)
  - PostgreSQL + Redis setup
  - Core + optional components
  - Commented configuration
  - Usage instructions

### ✅ Build & Test
- [x] Project compiles successfully (`yarn build`)
- [x] No TypeScript errors
- [x] ESLint passes
- [x] Ready for development

## Project Structure

```
cdk8s-mailu/
├── .github/workflows/        # CI/CD workflows (auto-generated)
├── .projen/                  # Projen metadata
├── coverage/                 # Test coverage reports
├── dist/                     # Generated K8S manifests
├── examples/                 # Example deployments
│   └── simple-deployment.ts  ✅
├── lib/                      # Compiled JavaScript
├── src/                      # TypeScript source
│   ├── constructs/           # Component constructs (TODO)
│   ├── config.ts             ✅ Configuration interface
│   ├── index.ts              ✅ Package exports
│   └── mailu-chart.ts        ✅ Main chart class
├── test/                     # Unit tests (TODO)
├── .projenrc.ts              # Projen configuration
├── cdk8s.yaml                # CDK8S configuration
├── package.json              # NPM package definition
├── README.md                 ✅ Documentation
└── STATUS.md                 # This file
```

## What's Next

### Phase A2: Core Component Constructs (Day 2-3)

Need to implement construct files for each component:

1. **Admin Construct** (`src/constructs/admin-construct.ts`)
   - Deployment with environment variables
   - Service (ClusterIP)
   - PVC for data and DKIM keys
   - Health checks

2. **Front Construct** (`src/constructs/front-construct.ts`)
   - Deployment (or optional DaemonSet)
   - Service exposing all mail protocol ports
   - Volume mounts for TLS certificates

3. **Postfix Construct** (`src/constructs/postfix-construct.ts`)
   - Deployment
   - Service (ClusterIP)
   - PVC for mail queue
   - Rspamd integration

4. **Dovecot Construct** (`src/constructs/dovecot-construct.ts`)
   - Deployment
   - Service (ClusterIP)
   - PVC for mailboxes (largest volume)
   - Authentication backend configuration

5. **Rspamd Construct** (`src/constructs/rspamd-construct.ts`)
   - Deployment
   - Service (ClusterIP)
   - PVC for learned data
   - Redis integration

### Phase A3: Optional Component Constructs (Day 3-4)

6. **Webmail Construct** (`src/constructs/webmail-construct.ts`)
   - Roundcube deployment
   - Database integration (PostgreSQL)
   - Service

7. **ClamAV Construct** (`src/constructs/clamav-construct.ts`)
   - StatefulSet (requires stable storage)
   - Service
   - Large PVC for virus signatures

8. **Fetchmail Construct** (`src/constructs/fetchmail-construct.ts`)
9. **Webdav Construct** (`src/constructs/webdav-construct.ts`)

### Phase A4: Chart Integration and Testing (Day 4)

- [ ] Wire up constructs in main chart
- [ ] Unit tests for each construct
- [ ] Integration test (full deployment)
- [ ] Synthesize example and validate manifests
- [ ] Update documentation with API reference

## Development Commands

```bash
# Install dependencies
yarn install

# Build the project
yarn build

# Run in watch mode (auto-compile)
yarn watch

# Run tests
yarn test

# Synthesize example
yarn synth:example

# Generate API docs
yarn docgen
```

## Configuration for kup6s

Based on our planning session, the kup6s deployment will use:

### Decisions Made

1. **Repository**: Separate open-source repo on GitHub (this one)
2. **Domain**: `mail.kup6s.com` (initial), future migration from `mail.kup.tirol`
3. **Components**:
   - Core: admin, front, postfix, dovecot, rspamd ✓
   - Optional: webmail (Roundcube) ✓, clamav ✓
   - Not needed initially: fetchmail, webdav
4. **External Access**: Traefik TCP routing via Hetzner LoadBalancer
5. **Storage**:
   - Dovecot: 100Gi (2x current 40GB usage)
   - PostgreSQL: 10Gi (via CNPG)
6. **Database**: CNPG PostgreSQL (3 instances, HA)
7. **Secrets**: ESO in dp-infra layer
8. **Admin Account**: Auto-generate password, store in K8S secret
9. **Deployment**: Direct to "mailu" namespace
10. **License**: Apache-2.0 (open source)

## Integration with dp-infra

After this chart is functional, the `dp-infra/mailu` integration will:

- Create CNPG PostgreSQL cluster
- Deploy Redis
- Provision secrets via ESO
- Configure Traefik IngressRoute + TCPRoute
- Import and use this chart
- Pass database URLs, Redis URL, secret names
- Configure Longhorn storage classes
- Set up Prometheus ServiceMonitors

## GitHub Repository

**Repository**: https://github.com/bluedynamics/cdk8s-mailu
**Created**: 2025-11-09
**Status**: Empty (ready for initial commit)

## Next Immediate Actions

1. Review this STATUS.md with the team
2. Create first component construct (suggest starting with Admin - simplest)
3. Test compilation and manifest generation after each construct
4. Commit regularly to GitHub
5. Update README as constructs are implemented

## Notes

- This is a **reusable, infrastructure-agnostic** chart
- No dependencies on CNPG, ESO, Traefik, or Longhorn
- Configuration via TypeScript interface (type-safe)
- Secrets passed by reference (never inline values)
- Storage class configurable (not hardcoded)
- Can be published to npm for community use

## Questions/Blockers

None currently - ready to proceed with implementation!
