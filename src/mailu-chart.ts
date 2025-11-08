import { Chart, ChartProps } from 'cdk8s';
import * as kplus from 'cdk8s-plus-28';
import { Construct } from 'constructs';
import { MailuChartConfig } from './config';

/**
 * Mailu Mail Server Chart
 *
 * This chart deploys a complete Mailu mail server with configurable components.
 *
 * @example
 * ```typescript
 * import { App } from 'cdk8s';
 * import { MailuChart } from 'cdk8s-mailu';
 *
 * const app = new App();
 * new MailuChart(app, 'mailu', {
 *   namespace: 'mailu',
 *   domain: 'example.com',
 *   hostnames: ['mail.example.com'],
 *   subnet: '10.42.0.0/16',
 *   database: {
 *     type: 'postgresql',
 *     postgresql: {
 *       host: 'postgres-pooler',
 *       secretName: 'postgres-credentials',
 *     },
 *   },
 *   redis: {
 *     host: 'redis',
 *   },
 *   secrets: {
 *     mailuSecretKey: 'mailu-secret-key',
 *   },
 *   storage: {
 *     storageClass: 'longhorn',
 *     admin: { size: '5Gi' },
 *     postfix: { size: '5Gi' },
 *     dovecot: { size: '100Gi' },
 *     rspamd: { size: '5Gi' },
 *   },
 * });
 * app.synth();
 * ```
 */
export class MailuChart extends Chart {
  /**
   * The Kubernetes namespace where Mailu is deployed
   */
  public readonly mailuNamespace: kplus.Namespace;

  /**
   * The configuration used for this deployment
   */
  public readonly config: MailuChartConfig;

  constructor(scope: Construct, id: string, config: MailuChartConfig, props?: ChartProps) {
    super(scope, id, props);

    this.config = config;

    // Create namespace
    this.mailuNamespace = new kplus.Namespace(this, 'namespace', {
      metadata: {
        name: config.namespace || 'mailu',
      },
    });

    // Create shared ConfigMap with environment variables
    this.createSharedConfigMap();

    // Deploy core components (always enabled)
    if (config.components?.admin !== false) {
      this.createAdminComponent();
    }

    if (config.components?.front !== false) {
      this.createFrontComponent();
    }

    if (config.components?.postfix !== false) {
      this.createPostfixComponent();
    }

    if (config.components?.dovecot !== false) {
      this.createDovecotComponent();
    }

    if (config.components?.rspamd !== false) {
      this.createRspamdComponent();
    }

    // Deploy optional components (only if enabled)
    if (config.components?.webmail) {
      this.createWebmailComponent();
    }

    if (config.components?.clamav) {
      this.createClamavComponent();
    }

    if (config.components?.fetchmail) {
      this.createFetchmailComponent();
    }

    if (config.components?.webdav) {
      this.createWebdavComponent();
    }
  }

  /**
   * Creates shared ConfigMap with environment variables common to all components
   */
  private createSharedConfigMap(): kplus.ConfigMap {
    const envVars: Record<string, string> = {
      // Core configuration
      DOMAIN: this.config.domain,
      HOSTNAMES: this.config.hostnames.join(','),
      SUBNET: this.config.subnet,
      TIMEZONE: this.config.timezone || 'UTC',

      // Mail configuration
      POSTMASTER: this.config.mailu?.initialAccount?.username || 'postmaster',
      MESSAGE_SIZE_LIMIT: String((this.config.mailu?.messageSizeLimit || 50) * 1024 * 1024),

      // Database configuration
      DB_FLAVOR: this.config.database.type === 'postgresql' ? 'postgresql' : 'sqlite',
    };

    // Add PostgreSQL connection details if configured
    if (this.config.database.type === 'postgresql' && this.config.database.postgresql) {
      const pg = this.config.database.postgresql;
      envVars.DB_HOST = pg.host;
      envVars.DB_PORT = String(pg.port || 5432);
      envVars.DB_NAME = pg.database || 'mailu';
    }

    // Add Redis connection details
    envVars.REDIS_ADDRESS = `${this.config.redis.host}:${this.config.redis.port || 6379}`;

    // Add log level
    if (this.config.mailu?.logLevel) {
      envVars.LOG_LEVEL = this.config.mailu.logLevel;
    }

    return new kplus.ConfigMap(this, 'env-config', {
      metadata: {
        namespace: this.mailuNamespace.name,
      },
      data: envVars,
    });
  }

  /**
   * Creates the Admin component (web UI)
   * TODO: Implement in admin-construct.ts
   */
  private createAdminComponent(): void {
    // Placeholder - will be implemented in separate construct file
    console.warn('Admin component not yet implemented');
  }

  /**
   * Creates the Front component (Nginx frontend)
   * TODO: Implement in front-construct.ts
   */
  private createFrontComponent(): void {
    // Placeholder - will be implemented in separate construct file
    console.warn('Front component not yet implemented');
  }

  /**
   * Creates the Postfix component (SMTP server)
   * TODO: Implement in postfix-construct.ts
   */
  private createPostfixComponent(): void {
    // Placeholder - will be implemented in separate construct file
    console.warn('Postfix component not yet implemented');
  }

  /**
   * Creates the Dovecot component (IMAP/POP3 server)
   * TODO: Implement in dovecot-construct.ts
   */
  private createDovecotComponent(): void {
    // Placeholder - will be implemented in separate construct file
    console.warn('Dovecot component not yet implemented');
  }

  /**
   * Creates the Rspamd component (spam filter)
   * TODO: Implement in rspamd-construct.ts
   */
  private createRspamdComponent(): void {
    // Placeholder - will be implemented in separate construct file
    console.warn('Rspamd component not yet implemented');
  }

  /**
   * Creates the Webmail component (Roundcube)
   * TODO: Implement in webmail-construct.ts
   */
  private createWebmailComponent(): void {
    // Placeholder - will be implemented in separate construct file
    console.warn('Webmail component not yet implemented');
  }

  /**
   * Creates the ClamAV component (antivirus)
   * TODO: Implement in clamav-construct.ts
   */
  private createClamavComponent(): void {
    // Placeholder - will be implemented in separate construct file
    console.warn('ClamAV component not yet implemented');
  }

  /**
   * Creates the Fetchmail component (external account fetching)
   * TODO: Implement in fetchmail-construct.ts
   */
  private createFetchmailComponent(): void {
    // Placeholder - will be implemented in separate construct file
    console.warn('Fetchmail component not yet implemented');
  }

  /**
   * Creates the Webdav component (calendar/contacts)
   * TODO: Implement in webdav-construct.ts
   */
  private createWebdavComponent(): void {
    // Placeholder - will be implemented in separate construct file
    console.warn('Webdav component not yet implemented');
  }
}
