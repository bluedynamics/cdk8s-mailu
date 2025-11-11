# cdk8s-mailu Documentation

```{image} _static/mailu-logo.svg
:alt: cdk8s-mailu logo
:width: 200px
:align: center
```

**CDK8S Construct Library for Mailu Mail Server Deployment**

Welcome to the cdk8s-mailu documentation. This documentation covers everything from initial setup to advanced configuration and architectural concepts for deploying Mailu mail servers using CDK8S.

## About cdk8s-mailu

cdk8s-mailu is a TypeScript construct library for [CDK8S](https://cdk8s.io/) that enables programmatic deployment of [Mailu](https://mailu.io/) mail servers on Kubernetes. It provides type-safe, reusable constructs for all Mailu components with production-grade defaults.

**Key Features:**
- Type-safe TypeScript constructs for all Mailu components
- Production-grade defaults with full customization
- Integration with PostgreSQL and Redis
- Support for Traefik TLS termination
- Comprehensive resource management (CPU, memory, storage)
- Component-level enable/disable toggles
- Test coverage >90%

## Documentation Structure

This documentation follows the [Diátaxis framework](https://diataxis.fr/), organizing content into four categories based on what you need:

::::{grid} 2
:gutter: 3

:::{grid-item-card} Tutorials
:img-top: _static/kup6s-icon-tutorials.svg
:link: tutorials/index
:link-type: doc

**Learning-oriented**: Step-by-step lessons to build skills

*Start here if you're new to cdk8s-mailu*
:::

:::{grid-item-card} How-To Guides
:img-top: _static/kup6s-icon-howto.svg
:link: how-to/index
:link-type: doc

**Goal-oriented**: Solutions to specific problems

*Use these when you need to accomplish something*
:::

:::{grid-item-card} Reference
:img-top: _static/kup6s-icon-reference.svg
:link: reference/index
:link-type: doc

**Information-oriented**: Technical specifications and configurations

*Consult when you need detailed information*
:::

:::{grid-item-card} Explanation
:img-top: _static/kup6s-icon-explanation.svg
:link: explanation/index
:link-type: doc

**Understanding-oriented**: Concepts and design decisions

*Read to deepen your understanding*
:::

::::

## Quick Links

### Getting Started
- [Setup Prerequisites](how-to/setup-prerequisites.md) - Prepare cluster infrastructure
- [Setup PostgreSQL](how-to/setup-postgresql.md) - Deploy database (Bitnami or CNPG)
- [Setup Redis](how-to/setup-redis.md) - Deploy cache
- [Quick Start](tutorials/01-quick-start.md) - Deploy your first Mailu instance

### Common Tasks
- [Manage Secrets](how-to/manage-secrets.md) - Create Kubernetes secrets for Mailu
- [Scale Resources](how-to/scale-resources.md) - Adjust CPU and memory limits
- [Customize Storage](how-to/customize-storage.md) - Configure PVC sizes and storage classes
- [Enable Optional Components](how-to/enable-optional-components.md) - Add ClamAV, Webdav, Fetchmail
- [Configure TLS](how-to/configure-tls.md) - Set up Traefik TLS termination
- [Upgrade Mailu](how-to/upgrade-mailu.md) - Upgrade to newer versions
- [Backup and Restore](how-to/backup-restore.md) - Protect your mail data

### Architecture
- [Architecture Overview](explanation/architecture.md) - High-level design
- [Dovecot Submission Service](explanation/dovecot-submission.md) - Webmail email sending
- [Component Specifications](reference/component-specifications.md) - Technical specifications
- [Configuration Options](reference/configuration-options.md) - Complete API reference

## Table of Contents

```{toctree}
---
maxdepth: 3
caption: Documentation
titlesonly: true
---
tutorials/index
how-to/index
reference/index
explanation/index
```

---

**Last updated:** 2025-01-15
**cdk8s-mailu version:** 0.0.0
**CDK8S version:** ^2.70.26
