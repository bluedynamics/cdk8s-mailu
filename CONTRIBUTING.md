# Contributing to cdk8s-mailu

Thank you for your interest in contributing to cdk8s-mailu! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

We are committed to providing a welcoming and inclusive environment. Please be respectful and constructive in all interactions.

## Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- Git
- Kubernetes cluster (for testing, optional)
- TypeScript knowledge

### Setting Up Development Environment

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/cdk8s-mailu.git
   cd cdk8s-mailu
   ```

2. **Install Dependencies**
   ```bash
   pnpm install
   ```

3. **Build the Project**
   ```bash
   pnpm run build
   ```

4. **Run Tests**
   ```bash
   pnpm test
   ```

## Development Workflow

### Project Structure

```
cdk8s-mailu/
├── src/
│   ├── config.ts              # Configuration interfaces
│   ├── mailu-chart.ts         # Main chart class
│   ├── constructs/            # Component constructs
│   │   ├── admin-construct.ts
│   │   ├── front-construct.ts
│   │   ├── postfix-construct.ts
│   │   └── ...
│   └── utils/                 # Utility functions
│       ├── resource-parser.ts
│       └── validators.ts
├── test/                      # Unit tests
├── examples/                  # Example deployments
└── dist/                      # Generated manifests (git-ignored)
```

### Making Changes

1. **Create a Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Your Changes**
   - Follow existing code patterns
   - Add tests for new functionality
   - Update documentation

3. **Run Tests and Linting**
   ```bash
   pnpm run build     # Runs compile, test, and synth
   pnpm test          # Run tests only
   pnpm run compile   # TypeScript compilation only
   ```

4. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "feat: add description of your feature"
   ```

### Commit Message Convention

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Test changes
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

**Examples:**
```
feat: add support for custom security contexts
fix: correct Dovecot health probe configuration
docs: update README with webdav configuration example
test: add tests for resource parser edge cases
```

## Code Guidelines

### TypeScript Style

- Use TypeScript strict mode
- Define explicit types for all function parameters and return values
- Use `readonly` for configuration interfaces
- Prefer `const` over `let`
- Use meaningful variable and function names

### Construct Pattern

When adding a new component construct:

1. **Create interface for props:**
   ```typescript
   export interface MyComponentConstructProps {
     readonly config: MailuChartConfig;
     readonly namespace: kplus.Namespace;
     readonly sharedConfigMap: kplus.ConfigMap;
   }
   ```

2. **Extend Construct class:**
   ```typescript
   export class MyComponentConstruct extends Construct {
     public readonly deployment: kplus.Deployment;
     public readonly service: kplus.Service;

     constructor(scope: Construct, id: string, props: MyComponentConstructProps) {
       super(scope, id);
       // Implementation
     }
   }
   ```

3. **Add comprehensive JSDoc comments:**
   ```typescript
   /**
    * MyComponent Construct - Brief description
    *
    * The MyComponent provides:
    * - Feature 1
    * - Feature 2
    *
    * Components:
    * - Deployment (service description)
    * - Service exposing port XXXX
    */
   ```

### Health Probes

All components should include appropriate health probes:

- **HTTP-based services:** Use `kplus.Probe.fromHttpGet()`
- **Process-based services:** Use `kplus.Probe.fromCommand()`
- Set reasonable `initialDelaySeconds` and `periodSeconds`

### Resource Configuration

Components should support optional resource requests and limits:

```typescript
resources: config.resources?.mycomponent
  ? {
      cpu: {
        request: parseCpuMillis(config.resources.mycomponent.requests?.cpu || '100m'),
        limit: config.resources.mycomponent.limits?.cpu
          ? parseCpuMillis(config.resources.mycomponent.limits.cpu)
          : undefined,
      },
      memory: {
        request: parseMemorySize(config.resources.mycomponent.requests?.memory || '256Mi'),
        limit: config.resources.mycomponent.limits?.memory
          ? parseMemorySize(config.resources.mycomponent.limits.memory)
          : undefined,
      },
    }
  : undefined,
```

## Testing

### Writing Tests

- Place tests in `test/` directory
- Name test files as `{component}-construct.test.ts`
- Use Jest testing framework
- Aim for >90% code coverage

### Test Structure

```typescript
import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { MyComponentConstruct } from '../src/constructs/my-component-construct';

describe('MyComponentConstruct', () => {
  let chart: any;
  let namespace: kplus.Namespace;
  let sharedConfigMap: kplus.ConfigMap;
  let config: MailuChartConfig;

  beforeEach(() => {
    chart = Testing.chart();
    // Setup test fixtures
  });

  test('creates all required resources', () => {
    const construct = new MyComponentConstruct(chart, 'test', {
      config,
      namespace,
      sharedConfigMap,
    });

    const manifests = Testing.synth(chart);

    // Assertions
    expect(construct.deployment).toBeDefined();
    // More assertions
  });
});
```

### Running Tests

```bash
pnpm test                    # Run all tests
pnpm run test:watch          # Watch mode
pnpm run test:coverage       # With coverage report
```

## Documentation

### Updating README

When adding new features:
- Update the features list
- Add configuration examples
- Update component descriptions
- Keep test coverage statistics current

### Code Documentation

- Add JSDoc comments to all public classes and methods
- Document configuration options
- Provide usage examples in comments

## Pull Request Process

1. **Ensure CI Passes**
   - All tests pass
   - No linting errors
   - TypeScript compiles without errors

2. **Update Documentation**
   - Update README.md if needed
   - Add JSDoc comments
   - Update examples if applicable

3. **Write a Clear PR Description**
   - Describe the changes made
   - Explain why the changes are needed
   - Reference any related issues

4. **Request Review**
   - Tag maintainers for review
   - Address review feedback promptly

5. **Squash and Merge**
   - Maintainers will squash and merge approved PRs

## Reporting Issues

### Bug Reports

Include:
- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node version, Kubernetes version)
- Generated manifest snippets (if relevant)

### Feature Requests

Include:
- Use case description
- Proposed solution
- Alternative approaches considered
- Willingness to implement

## Project Tooling

### Projen

This project uses [Projen](https://projen.io/) for project configuration:

- **Do not** edit `package.json`, `tsconfig.json`, or `.gitignore` directly
- Edit `.projenrc.ts` instead
- Run `npx projen` to regenerate configuration files

### CDK8S

Key CDK8S concepts:
- **Chart**: Collection of Kubernetes resources
- **Construct**: Reusable component
- **App**: Top-level container for charts

## Release Process

Releases are managed by maintainers:

1. Version bump in `package.json`
2. Update CHANGELOG.md
3. Create git tag
4. Publish to npm registry

## Questions?

- **Issues**: [GitHub Issues](https://github.com/bluedynamics/cdk8s-mailu/issues)
- **Discussions**: [GitHub Discussions](https://github.com/bluedynamics/cdk8s-mailu/discussions)

## License

By contributing, you agree that your contributions will be licensed under the Apache License 2.0.

---

Thank you for contributing to cdk8s-mailu!
