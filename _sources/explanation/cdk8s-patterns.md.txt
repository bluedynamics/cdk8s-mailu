# CDK8S Patterns

**Understanding construct patterns and best practices in cdk8s-mailu.**

## Introduction

CDK8S (Cloud Development Kit for Kubernetes) allows you to define Kubernetes applications using familiar programming languages. cdk8s-mailu leverages CDK8S patterns to provide a type-safe, testable, and maintainable way to deploy Mailu.

## Core Concepts

### Constructs

**What is a Construct?**

A construct is a composable building block that encapsulates one or more Kubernetes resources. In cdk8s-mailu, each Mailu component is implemented as a construct.

```typescript
export class AdminConstruct extends Construct {
  constructor(scope: Construct, id: string, config: AdminConfig) {
    super(scope, id);

    // Create Deployment
    new Deployment(this, 'deployment', { ... });

    // Create Service
    new Service(this, 'service', { ... });
  }
}
```

**Benefits:**
- **Encapsulation** - Hide complex resource definitions
- **Reusability** - Use the same construct in multiple charts
- **Testability** - Unit test each construct independently
- **Composability** - Combine constructs to build applications

### Charts

**What is a Chart?**

A chart is a top-level construct that represents a complete Kubernetes application. It contains all the constructs and resources needed for deployment.

```typescript
export class MailuChart extends Chart {
  constructor(scope: Construct, id: string, props: MailuChartProps) {
    super(scope, id, props);

    // Create namespace
    const ns = new Namespace(this, 'namespace', { ... });

    // Create constructs
    new FrontConstruct(this, 'front', config);
    new AdminConstruct(this, 'admin', config);
    // ...
  }
}
```

**Characteristics:**
- Extends `Chart` from cdk8s
- Entry point for synthesis
- Manages shared resources (namespace, configmaps)
- Coordinates multiple constructs

### Apps

**What is an App?**

An app is the root of your CDK8S application. It contains one or more charts and is responsible for synthesizing Kubernetes manifests.

```typescript
const app = new App();
new MailuChart(app, 'mailu', { ... });
app.synth();  // Generate YAML files
```

## Design Patterns

### 1. Configuration Object Pattern

**Pattern:** Pass a single configuration object instead of many parameters

```typescript
// Good: Single configuration object
new AdminConstruct(this, 'admin', {
  namespace: 'mailu',
  resources: { requests: { cpu: '100m' } },
  image: { repository: 'mailu/admin', tag: '2.0' },
});

// Avoid: Many individual parameters
new AdminConstruct(this, 'admin',
  'mailu',
  { cpu: '100m' },
  'mailu/admin',
  '2.0'
);
```

**Benefits:**
- Type-safe with TypeScript interfaces
- Easy to add optional parameters
- Clear parameter names
- IDE autocomplete support

### 2. Shared Configuration Pattern

**Pattern:** Extract common configuration to shared objects

```typescript
// Shared environment ConfigMap
const sharedConfig = new ConfigMap(this, 'shared-config', {
  metadata: { namespace: config.namespace },
  data: {
    DOMAIN: config.domain,
    HOSTNAMES: config.hostnames.join(','),
  },
});

// Reference in multiple constructs
new AdminConstruct(this, 'admin', {
  ...config,
  sharedConfigMap: sharedConfig,
});
```

**Benefits:**
- Avoid duplication
- Single source of truth
- Easier to maintain
- Consistent across components

### 3. Conditional Resource Creation

**Pattern:** Create resources based on configuration flags

```typescript
export class MailuChart extends Chart {
  constructor(scope: Construct, id: string, config: MailuConfig) {
    super(scope, id);

    // Always create core components
    new FrontConstruct(this, 'front', config);
    new AdminConstruct(this, 'admin', config);

    // Conditionally create optional components
    if (config.components.clamav) {
      new ClamAVConstruct(this, 'clamav', config);
    }

    if (config.components.webdav) {
      new WebdavConstruct(this, 'webdav', config);
    }
  }
}
```

**Benefits:**
- Flexible deployments
- Only create what's needed
- Clear intent in code
- Reduces resource usage

### 4. Resource Requirements Pattern

**Pattern:** Provide sensible defaults with override capability

```typescript
interface ComponentConfig {
  resources?: {
    requests?: { cpu: string; memory: string };
    limits?: { cpu: string; memory: string };
  };
}

// In construct
const resources = config.resources ?? {
  requests: { cpu: '100m', memory: '256Mi' },
  limits: { cpu: '300m', memory: '512Mi' },
};
```

**Benefits:**
- Works out of the box
- Production-ready defaults
- Easy to customize
- Explicit resource management

### 5. Secret Reference Pattern

**Pattern:** Reference existing secrets instead of inline values

```typescript
interface SecretReference {
  name: string;  // Secret name
  key: string;   // Key within secret
}

// Usage
database: {
  password: {
    name: 'postgres-credentials',
    key: 'password',
  },
}

// In construct
const passwordEnv = EnvValue.fromSecretValue({
  secret: Secret.fromSecretName(this, 'db-secret', config.password.name),
  key: config.password.key,
});
```

**Benefits:**
- Never expose secrets in code
- Integrate with secret management tools
- Type-safe secret references
- Clear intent

## Testing Patterns

### 1. Snapshot Testing

**Pattern:** Verify generated manifests haven't changed unexpectedly

```typescript
test('generates expected manifests', () => {
  const app = Testing.app();
  const chart = new MailuChart(app, 'test', { ... });
  const results = Testing.synth(chart);
  expect(results).toMatchSnapshot();
});
```

**Benefits:**
- Catch unintended changes
- Document expected output
- Fast regression testing

### 2. Resource Count Testing

**Pattern:** Verify expected number of resources

```typescript
test('creates correct number of resources', () => {
  const app = Testing.app();
  const chart = new MailuChart(app, 'test', { ... });
  const results = Testing.synth(chart);

  expect(results.filter(r => r.kind === 'Deployment')).toHaveLength(5);
  expect(results.filter(r => r.kind === 'Service')).toHaveLength(5);
});
```

**Benefits:**
- Verify resource creation
- Catch missing/extra resources
- Quick validation

### 3. Configuration Validation Testing

**Pattern:** Test that invalid configurations are rejected

```typescript
test('rejects invalid domain', () => {
  const app = Testing.app();
  expect(() => {
    new MailuChart(app, 'test', {
      domain: 'invalid domain with spaces',
    });
  }).toThrow('Invalid domain format');
});
```

**Benefits:**
- Fail fast on bad config
- Clear error messages
- Prevent invalid deployments

## Best Practices

### 1. Type Everything

Use TypeScript interfaces for all configuration:

```typescript
interface MailuConfig {
  domain: string;
  namespace: string;
  components: ComponentToggles;
  // ... all fields typed
}
```

### 2. Validate Early

Validate configuration in construct constructors:

```typescript
if (!isValidDomain(config.domain)) {
  throw new Error(`Invalid domain: ${config.domain}`);
}
```

### 3. Provide Defaults

Make common configurations work with minimal input:

```typescript
const resources = config.resources ?? DEFAULT_RESOURCES;
const image = config.image ?? DEFAULT_IMAGE;
```

### 4. Document Decisions

Use JSDoc comments to explain choices:

```typescript
/**
 * Creates Front component with Nginx reverse proxy.
 *
 * Note: When using Traefik TLS termination, the nginx-patch-configmap
 * is automatically applied to wrap backend connections properly.
 */
export class FrontConstruct extends Construct { ... }
```

### 5. Keep Constructs Focused

Each construct should have a single responsibility:

```typescript
// Good: Single component
class AdminConstruct { ... }
class FrontConstruct { ... }

// Avoid: Multiple components in one construct
class AllMailuComponents { ... }
```

## See Also

- [Architecture Overview](architecture.md) - Overall system design
- [Configuration Reference](../reference/configuration-options.md) - Complete API docs
- [Quick Start Tutorial](../tutorials/01-quick-start.md) - Hands-on learning

---

*This is a placeholder explanation. Content will be expanded by the docwriter with:*
- More advanced patterns
- Anti-patterns to avoid
- Real-world examples
- Performance considerations
- Debugging techniques
- Migration patterns
