# cdk8s-mailu

<table style="width: 100%; border: none;">
<tr>
<td style="border: none;">
<em>CDK8S construct library for deploying Mailu mail server to Kubernetes</em>
</td>
<td align="right" style="border: none;">
<img src="mailu-logo.png" alt="Mailu Logo" width="100"/>
</td>
</tr>
</table>

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

📚 **[Full Documentation](https://bluedynamics.github.io/cdk8s-mailu/)** | [Quick Start](#quick-start) | [Architecture](https://bluedynamics.github.io/cdk8s-mailu/explanation/architecture.html)

## Overview

`cdk8s-mailu` is a [CDK8S](https://cdk8s.io/) construct library that provides a **type-safe, production-grade** way to deploy [Mailu](https://mailu.io/) mail server to Kubernetes. Generate complete Kubernetes manifests from TypeScript code with compile-time validation and IDE autocomplete.

## Why cdk8s-mailu?

- **Type-Safe Configuration** - Catch errors at compile time, not deploy time
- **Production-Grade Defaults** - Resource limits and storage sizes based on real deployments
- **Modular Architecture** - Enable/disable components with simple flags
- **Dedicated Dovecot Submission Service** - Solves webmail email sending with clean architecture
- **Well-Documented** - Comprehensive documentation following Diátaxis framework
- **Battle-Tested** - Production deployment at kup6s.com with AMD64/ARM64 mixed nodes

**[See Complete Architecture →](https://bluedynamics.github.io/cdk8s-mailu/explanation/architecture.html)**

## Installation

```bash
npm install cdk8s-mailu
# or
yarn add cdk8s-mailu
```

**Prerequisites**: Kubernetes 1.28+, PostgreSQL, Redis, Node.js 18+

**[Full Prerequisites →](https://bluedynamics.github.io/cdk8s-mailu/tutorials/01-quick-start.html#prerequisites)**

## Quick Start

Create `mailu.ts`:

```typescript
import { App } from 'cdk8s';
import { MailuChart } from 'cdk8s-mailu';

const app = new App();

new MailuChart(app, 'mailu', {
  namespace: 'mailu',
  domain: 'example.com',
  hostnames: ['mail.example.com'],
  subnet: '10.42.0.0/16',  // Your Kubernetes pod CIDR
  timezone: 'UTC',

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

  redis: {
    host: 'redis',
    port: 6379,
  },

  secrets: {
    mailuSecretKey: 'mailu-secrets',
    initialAdminPassword: 'mailu-secrets',
  },

  components: {
    webmail: true,   // Roundcube webmail
    clamav: false,   // Antivirus (requires ~1GB RAM)
  },

  storage: {
    storageClass: 'longhorn',
    dovecot: { size: '50Gi' },  // Mailbox storage
  },

  // Optional: Traefik ingress (requires Traefik installed)
  ingress: {
    enabled: true,
    type: 'traefik',
    traefik: {
      hostname: 'mail.example.com',
      certIssuer: 'letsencrypt-cluster-issuer',
      enableTcp: true,  // SMTP/IMAP/POP3 routes
    },
  },
});

app.synth();
```

Generate and deploy:

```bash
npx ts-node mailu.ts
kubectl apply -f dist/mailu.k8s.yaml
```

**[Complete Tutorial with Secrets & DNS →](https://bluedynamics.github.io/cdk8s-mailu/tutorials/01-quick-start.html)**

## Documentation

Comprehensive documentation following the [Diátaxis](https://diataxis.fr/) framework:

### **[📘 Tutorials](https://bluedynamics.github.io/cdk8s-mailu/tutorials/)** - Learn by doing
- [Quick Start: Deploy Your First Instance](https://bluedynamics.github.io/cdk8s-mailu/tutorials/01-quick-start.html)

### **[🔧 How-To Guides](https://bluedynamics.github.io/cdk8s-mailu/how-to/)** - Practical solutions
- Configure components
- Customize resources
- Set up TLS termination

### **[💡 Explanation](https://bluedynamics.github.io/cdk8s-mailu/explanation/)** - Understanding the design
- [Architecture Overview](https://bluedynamics.github.io/cdk8s-mailu/explanation/architecture.html) - Component relationships and CDK8S patterns
- [Dovecot Submission Service](https://bluedynamics.github.io/cdk8s-mailu/explanation/dovecot-submission.html) - How webmail email sending works
- [CDK8S Patterns](https://bluedynamics.github.io/cdk8s-mailu/explanation/cdk8s-patterns.html) - Construct design patterns

### **[📚 Reference](https://bluedynamics.github.io/cdk8s-mailu/reference/)** - Technical specifications
- Configuration API reference
- Component options
- Resource defaults

## Development

```bash
npm run build      # Compile + test + synth
npm run test       # Run tests (>96% coverage)
npm run synth      # Generate manifests only
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

Apache License 2.0 - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Mailu](https://mailu.io/) - The mail server software
- [CDK8S](https://cdk8s.io/) - Cloud Development Kit for Kubernetes

---

**[📚 Full Documentation](https://bluedynamics.github.io/cdk8s-mailu/) | [🚀 Quick Start](https://bluedynamics.github.io/cdk8s-mailu/tutorials/01-quick-start.html) | [🏗️ Architecture](https://bluedynamics.github.io/cdk8s-mailu/explanation/architecture.html)**
