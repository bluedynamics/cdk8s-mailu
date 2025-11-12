/**
 * Configuration interface for Mailu mail server deployment
 */

/**
 * Database configuration
 */
export interface DatabaseConfig {
  /**
   * Database type
   */
  readonly type: 'postgresql' | 'sqlite';

  /**
   * PostgreSQL connection details (if type=postgresql)
   */
  readonly postgresql?: {
    /**
     * Database host (service name or FQDN)
     * @example "postgres-cluster-pooler" or "postgres.mailu.svc.cluster.local"
     */
    readonly host: string;

    /**
     * Database port
     * @default 5432
     */
    readonly port?: number;

    /**
     * Database name for Mailu admin
     * @default "mailu"
     */
    readonly database?: string;

    /**
     * Secret name containing PostgreSQL credentials
     */
    readonly secretName: string;

    /**
     * Keys within the secret for username and password
     * @default { username: "username", password: "password" }
     */
    readonly secretKeys?: {
      readonly username: string;
      readonly password: string;
    };
  };
}

/**
 * Redis configuration
 */
export interface RedisConfig {
  /**
   * Redis host (service name or FQDN)
   * @example "redis" or "redis.mailu.svc.cluster.local"
   */
  readonly host: string;

  /**
   * Redis port
   * @default 6379
   */
  readonly port?: number;

  /**
   * Secret name containing Redis password (optional)
   */
  readonly secretName?: string;

  /**
   * Key within the secret for the password
   * @default "password"
   */
  readonly secretKey?: string;
}

/**
 * Secret references (not values!)
 */
export interface SecretsConfig {
  /**
   * Secret name containing Mailu secret key
   * The secret should have a key named "secret-key"
   */
  readonly mailuSecretKey: string;

  /**
   * Secret name containing initial admin password (optional)
   * The secret should have a key named "password"
   */
  readonly initialAdminPassword?: string;

  /**
   * Secret name containing API token (optional)
   * The secret should have a key named "api-token"
   */
  readonly apiToken?: string;
}

/**
 * Storage configuration for a component
 */
export interface ComponentStorageConfig {
  /**
   * PVC size
   * @example "5Gi", "100Gi"
   */
  readonly size: string;

  /**
   * Storage class name
   * If not specified, uses the global storageClass
   */
  readonly storageClass?: string;
}

/**
 * Storage configuration for all components
 */
export interface StorageConfig {
  /**
   * Default storage class for all PVCs
   * @example "longhorn", "standard", "gp2"
   */
  readonly storageClass?: string;

  /**
   * Admin component storage (data + DKIM keys)
   */
  readonly admin?: ComponentStorageConfig;

  /**
   * Postfix component storage (mail queue)
   */
  readonly postfix?: ComponentStorageConfig;

  /**
   * Dovecot component storage (mailboxes - largest)
   */
  readonly dovecot?: ComponentStorageConfig;

  /**
   * Rspamd component storage (learned spam data)
   */
  readonly rspamd?: ComponentStorageConfig;

  /**
   * ClamAV component storage (virus signatures)
   * Only used if clamav component is enabled
   */
  readonly clamav?: ComponentStorageConfig;

  /**
   * Webmail component storage (Roundcube data)
   * Only used if webmail component is enabled
   */
  readonly webmail?: ComponentStorageConfig;

  /**
   * Webdav component storage (calendars and contacts)
   * Only used if webdav component is enabled
   */
  readonly webdav?: ComponentStorageConfig;
}

/**
 * Component toggle configuration
 */
export interface ComponentsConfig {
  /**
   * Enable admin web UI
   * @default true
   */
  readonly admin?: boolean;

  /**
   * Enable front (nginx) component
   * @default true
   */
  readonly front?: boolean;

  /**
   * Enable Postfix SMTP server
   * @default true
   */
  readonly postfix?: boolean;

  /**
   * Enable Dovecot IMAP/POP3 server
   * @default true
   */
  readonly dovecot?: boolean;

  /**
   * Enable Rspamd spam filter
   * @default true
   */
  readonly rspamd?: boolean;

  /**
   * Enable Roundcube webmail
   * @default false
   */
  readonly webmail?: boolean;

  /**
   * Enable ClamAV antivirus scanner
   * @default false
   */
  readonly clamav?: boolean;

  /**
   * Enable Fetchmail (external account fetching)
   * @default false
   */
  readonly fetchmail?: boolean;

  /**
   * Enable Webdav/Radicale (calendar/contacts)
   * @default false
   */
  readonly webdav?: boolean;
}

/**
 * Resource requests and limits
 */
export interface ResourcesConfig {
  readonly requests: {
    readonly cpu: string;
    readonly memory: string;
  };
  readonly limits: {
    readonly cpu: string;
    readonly memory: string;
  };
}

/**
 * Initial admin account configuration
 */
export interface InitialAccountConfig {
  /**
   * Enable creation of initial admin account
   * @default false
   */
  readonly enabled: boolean;

  /**
   * Admin username
   * @default "admin"
   */
  readonly username: string;

  /**
   * Admin email domain (will be user@domain)
   * @example "example.com"
   */
  readonly domain: string;

  /**
   * How to handle account creation
   * - create: Create account, fail if exists
   * - update: Create or update account
   * - ifmissing: Create only if doesn't exist
   * @default "update"
   */
  readonly mode?: 'create' | 'update' | 'ifmissing';
}

/**
 * Mailu-specific configuration
 */
export interface MailuConfig {
  /**
   * Log level
   * @default "WARNING"
   */
  readonly logLevel?: string;

  /**
   * Maximum message size in megabytes
   * @default 50
   */
  readonly messageSizeLimit?: number;

  /**
   * Initial admin account configuration
   */
  readonly initialAccount?: InitialAccountConfig;

  /**
   * Enable API
   * @default false
   */
  readonly apiEnabled?: boolean;

  /**
   * Webmail client to use
   * - roundcube: Traditional PHP webmail client (mature, full-featured)
   * - snappymail: Modern lightweight webmail client
   * @default "roundcube"
   */
  readonly webmailType?: 'roundcube' | 'snappymail';
}

/**
 * Image configuration
 */
export interface ImageConfig {
  /**
   * Container image registry
   * @default "ghcr.io/mailu"
   */
  readonly registry?: string;

  /**
   * Image tag (Mailu version)
   * @default "2024.06"
   */
  readonly tag?: string;

  /**
   * Image pull policy
   * @default "IfNotPresent"
   */
  readonly pullPolicy?: string;
}

/**
 * Traefik-specific ingress configuration
 */
export interface TraefikIngressConfig {
  /**
   * Hostname for ingress (FQDN)
   * @example "mail.example.com"
   */
  readonly hostname: string;

  /**
   * cert-manager ClusterIssuer name for TLS certificates
   * @default "letsencrypt-cluster-issuer"
   */
  readonly certIssuer?: string;

  /**
   * Enable TCP routes for mail protocols (SMTP, IMAP, POP3, etc.)
   * @default true
   */
  readonly enableTcp?: boolean;

  /**
   * SMTP rate limiting (maximum concurrent connections per IP)
   * @default 15
   */
  readonly smtpConnectionLimit?: number;
}

/**
 * Ingress configuration
 */
export interface IngressConfig {
  /**
   * Enable ingress resource creation
   * @default false
   */
  readonly enabled?: boolean;

  /**
   * Ingress controller type
   * @default "traefik"
   */
  readonly type?: 'traefik' | 'nginx' | 'none';

  /**
   * Traefik-specific configuration
   * Required if type is "traefik" and enabled is true
   */
  readonly traefik?: TraefikIngressConfig;
}

/**
 * Main configuration interface for Mailu chart
 */
export interface MailuChartConfig {
  /**
   * Kubernetes namespace to deploy to
   * @default "mailu"
   */
  readonly namespace?: string;

  /**
   * Primary mail domain
   * @example "example.com"
   */
  readonly domain: string;

  /**
   * Mail server hostnames (FQDN)
   * The first hostname will be used as the primary mail hostname
   * @example ["mail.example.com", "smtp.example.com"]
   */
  readonly hostnames: string[];

  /**
   * Kubernetes pod network subnet (CIDR)
   * @example "10.42.0.0/16"
   */
  readonly subnet: string;

  /**
   * Timezone
   * @default "UTC"
   */
  readonly timezone?: string;

  /**
   * Database configuration
   */
  readonly database: DatabaseConfig;

  /**
   * Redis configuration
   */
  readonly redis: RedisConfig;

  /**
   * Secret references
   */
  readonly secrets: SecretsConfig;

  /**
   * Storage configuration
   * Optional - only required if components need persistent storage
   */
  readonly storage?: StorageConfig;

  /**
   * Component toggles
   * @default All core components enabled, optional components disabled
   */
  readonly components?: ComponentsConfig;

  /**
   * Resource requests and limits per component
   */
  readonly resources?: {
    readonly front?: ResourcesConfig;
    readonly admin?: ResourcesConfig;
    readonly postfix?: ResourcesConfig;
    readonly dovecot?: ResourcesConfig;
    readonly rspamd?: ResourcesConfig;
    readonly webmail?: ResourcesConfig;
    readonly clamav?: ResourcesConfig;
    readonly fetchmail?: ResourcesConfig;
    readonly webdav?: ResourcesConfig;
  };

  /**
   * Mailu-specific settings
   */
  readonly mailu?: MailuConfig;

  /**
   * Image configuration
   */
  readonly images?: ImageConfig;

  /**
   * Ingress configuration (optional)
   * Enables automatic creation of ingress resources for external access
   * @default undefined (no ingress created)
   */
  readonly ingress?: IngressConfig;
}
