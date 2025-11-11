# Configuration Options

**Complete reference for all configuration options in the MailuConfig interface.**

## MailuConfig Interface

The `MailuConfig` interface defines all configuration options for deploying Mailu.

### Core Configuration

#### domain (required)
- **Type:** `string`
- **Description:** Primary mail domain for the Mailu instance
- **Example:** `'mail.example.com'`

#### hostnames (required)
- **Type:** `string[]`
- **Description:** List of hostnames for the mail server
- **Example:** `['mail.example.com', 'imap.example.com']`

#### secretKey (required)
- **Type:** `SecretReference`
- **Description:** Reference to Kubernetes secret containing the Mailu secret key
- **Example:**
  ```typescript
  {
    name: 'mailu-secrets',
    key: 'SECRET_KEY'
  }
  ```

### Database Configuration

#### database
- **Type:** `DatabaseConfig`
- **Description:** Database backend configuration (PostgreSQL or SQLite)

**PostgreSQL:**
```typescript
{
  type: 'postgresql',
  host: string,
  port: number,
  name: string,
  user: SecretReference,
  password: SecretReference
}
```

**SQLite (default):**
```typescript
{
  type: 'sqlite',
  path: string  // Default: '/data/main.db'
}
```

### Redis Configuration

#### redis
- **Type:** `RedisConfig`
- **Description:** Redis configuration for caching and session storage

```typescript
{
  enabled: boolean,
  host: string,
  port: number,
  password?: SecretReference
}
```

### Component Toggles

#### components
- **Type:** `ComponentToggles`
- **Description:** Enable/disable optional Mailu components

```typescript
{
  admin: boolean,      // Default: true
  webmail: boolean,    // Default: true
  clamav: boolean,     // Default: false
  webdav: boolean,     // Default: false
  fetchmail: boolean,  // Default: false
  radicale: boolean    // Default: false
}
```

### Resource Configuration

#### resources
- **Type:** `Record<string, ResourceRequirements>`
- **Description:** CPU and memory resources for each component

```typescript
{
  [componentName]: {
    requests: {
      cpu: string,    // e.g., '100m'
      memory: string  // e.g., '256Mi'
    },
    limits: {
      cpu: string,
      memory: string
    }
  }
}
```

**Components:**
- `front` - Nginx reverse proxy
- `admin` - Web admin interface
- `postfix` - SMTP server
- `dovecot` - IMAP/POP3 server
- `rspamd` - Spam filter
- `webmail` - Roundcube webmail
- `clamav` - Antivirus scanner
- `webdav` - CalDAV/CardDAV server
- `fetchmail` - External mail fetching

### Storage Configuration

#### storage
- **Type:** `StorageConfig`
- **Description:** Persistent storage configuration

```typescript
{
  data: {
    size: string,              // e.g., '10Gi'
    storageClassName?: string  // e.g., 'longhorn'
  },
  mail: {
    size: string,
    storageClassName?: string
  },
  // Additional storage for components
}
```

### Image Configuration

#### images
- **Type:** `Record<string, ImageConfig>`
- **Description:** Container image configuration for each component

```typescript
{
  [componentName]: {
    repository: string,
    tag: string,
    pullPolicy?: 'Always' | 'IfNotPresent' | 'Never'
  }
}
```

### Additional Configuration

*[Content placeholder for docwriter]*

Additional configuration sections to be documented:
- Network/service configuration
- Security settings
- TLS/certificate configuration
- SMTP relay settings
- Admin user configuration
- Feature flags
- Environment variable overrides

## See Also

- [Configure Constructs](../how-to/configure-construct.md) - How-to guide for configuration
- [Architecture](../explanation/architecture.md) - Understanding configuration design

---

*This is a placeholder reference. Content will be expanded by the docwriter with:*
- Complete TypeScript interface definitions
- All available options with types and defaults
- Validation rules and constraints
- Migration guides for version changes
- Examples for each option
