# Configure Constructs

**How to customize Mailu component settings and resources.**

## Problem

You need to customize the configuration of Mailu components, adjust resource limits, or enable/disable specific services.

## Solution

The MailuChart accepts a comprehensive configuration object that controls all aspects of the deployment.

## Basic Configuration

```typescript
import { MailuChart } from 'cdk8s-mailu';

new MailuChart(app, 'mailu', {
  namespace: 'mailu',
  config: {
    domain: 'mail.example.com',
    hostnames: ['mail.example.com'],
    secretKey: {
      name: 'mailu-secrets',
      key: 'SECRET_KEY',
    },
    // Additional configuration...
  },
});
```

## Configure Database Backend

### PostgreSQL (Recommended)

```typescript
config: {
  database: {
    type: 'postgresql',
    host: 'postgres-service',
    port: 5432,
    name: 'mailu',
    user: {
      name: 'postgres-credentials',
      key: 'username',
    },
    password: {
      name: 'postgres-credentials',
      key: 'password',
    },
  },
}
```

### SQLite (Default)

```typescript
config: {
  database: {
    type: 'sqlite',
    path: '/data/main.db',
  },
}
```

## Configure Redis

```typescript
config: {
  redis: {
    enabled: true,
    host: 'redis-service',
    port: 6379,
    password: {
      name: 'redis-credentials',
      key: 'password',
    },
  },
}
```

## Customize Resources

*[Content placeholder for docwriter]*

```typescript
config: {
  resources: {
    front: {
      requests: { cpu: '200m', memory: '256Mi' },
      limits: { cpu: '500m', memory: '512Mi' },
    },
    admin: {
      requests: { cpu: '100m', memory: '256Mi' },
      limits: { cpu: '300m', memory: '512Mi' },
    },
    // Additional components...
  },
}
```

## Enable Optional Components

```typescript
config: {
  components: {
    clamav: true,    // Enable antivirus scanning
    webdav: true,    // Enable CalDAV/CardDAV
    fetchmail: true, // Enable external email fetching
    webmail: true,   // Enable Roundcube webmail
  },
}
```

## Configure Storage

```typescript
config: {
  storage: {
    data: {
      size: '10Gi',
      storageClassName: 'longhorn',
    },
    mail: {
      size: '50Gi',
      storageClassName: 'longhorn',
    },
  },
}
```

## See Also

- [Configuration Options Reference](../reference/configuration-options.md) - Complete API reference
- [Architecture](../explanation/architecture.md) - Understand component relationships

---

*This is a placeholder how-to guide. Content will be expanded by the docwriter with:*
- Complete configuration examples for all components
- Advanced scenarios (custom images, security settings, networking)
- Troubleshooting tips
- Best practices
- Real-world examples
