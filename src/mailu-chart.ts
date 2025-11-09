import { Chart, ChartProps } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { MailuChartConfig } from './config';
import { AdminConstruct } from './constructs/admin-construct';
import { ClamavConstruct } from './constructs/clamav-construct';
import { DovecotConstruct } from './constructs/dovecot-construct';
import { FetchmailConstruct } from './constructs/fetchmail-construct';
import { FrontConstruct } from './constructs/front-construct';
import { PostfixConstruct } from './constructs/postfix-construct';
import { RspamdConstruct } from './constructs/rspamd-construct';
import { WebdavConstruct } from './constructs/webdav-construct';
import { WebmailConstruct } from './constructs/webmail-construct';
import { validateDomainFormat, validateCidrFormat } from './utils/validators';

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

  /**
   * Shared ConfigMap with environment variables
   */
  private readonly sharedConfigMap: kplus.ConfigMap;

  /**
   * Component constructs (public to allow access if needed)
   */
  public adminConstruct?: AdminConstruct;
  public frontConstruct?: FrontConstruct;
  public postfixConstruct?: PostfixConstruct;
  public dovecotConstruct?: DovecotConstruct;
  public rspamdConstruct?: RspamdConstruct;
  public webmailConstruct?: WebmailConstruct;
  public clamavConstruct?: ClamavConstruct;
  public fetchmailConstruct?: FetchmailConstruct;
  public webdavConstruct?: WebdavConstruct;

  constructor(scope: Construct, id: string, config: MailuChartConfig, props?: ChartProps) {
    super(scope, id, props);

    // Validate critical configuration values
    validateDomainFormat(config.domain, 'domain');
    validateCidrFormat(config.subnet, 'subnet');

    // Validate all hostnames
    config.hostnames.forEach((hostname, index) => {
      validateDomainFormat(hostname, `hostnames[${index}]`);
    });

    // Validate initial account domain if configured
    if (config.mailu?.initialAccount?.domain) {
      validateDomainFormat(config.mailu.initialAccount.domain, 'mailu.initialAccount.domain');
    }

    this.config = config;

    // Create namespace
    this.mailuNamespace = new kplus.Namespace(this, 'namespace', {
      metadata: {
        name: config.namespace || 'mailu',
      },
    });

    // Create shared ConfigMap with environment variables
    // Note: Front service discovery address will be added after front component creation
    this.sharedConfigMap = this.createSharedConfigMap();

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

    // Update ConfigMap with service discovery addresses after all components are created
    this.updateConfigMapWithServiceDiscovery();
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

      // TLS configuration - 'notls' for Kubernetes Ingress (temporarily)
      // TODO: This disables TLS for mail protocols - need proper solution
      // Web traffic: HTTP on port 80 (Ingress handles HTTPS)
      // Mail protocols: Currently unencrypted (IngressRouteTCP should handle TLS)
      TLS_FLAVOR: 'notls',

      // Proxy configuration - trust X-Forwarded headers from pod network
      REAL_IP_HEADER: 'X-Forwarded-For',
      REAL_IP_FROM: this.config.subnet, // Trust the entire pod network

      // Kubernetes/Helm deployment marker - required to bypass Docker-only checks
      MAILU_HELM_CHART: 'true',

      // Web paths - URL paths for admin interface and webmail
      WEB_ADMIN: '/admin',
      WEB_WEBMAIL: '/webmail',

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

    // Note: FRONT_ADDRESS is added after component creation via updateConfigMapWithServiceDiscovery()
    // to use the dynamically generated service name

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
   */
  private createAdminComponent(): void {
    this.adminConstruct = new AdminConstruct(this, 'admin', {
      config: this.config,
      namespace: this.mailuNamespace,
      sharedConfigMap: this.sharedConfigMap,
    });
  }

  /**
   * Creates the Front component (Nginx frontend)
   */
  private createFrontComponent(): void {
    this.frontConstruct = new FrontConstruct(this, 'front', {
      config: this.config,
      namespace: this.mailuNamespace,
      sharedConfigMap: this.sharedConfigMap,
    });
  }

  /**
   * Creates the Postfix component (SMTP server)
   */
  private createPostfixComponent(): void {
    this.postfixConstruct = new PostfixConstruct(this, 'postfix', {
      config: this.config,
      namespace: this.mailuNamespace,
      sharedConfigMap: this.sharedConfigMap,
    });
  }

  /**
   * Creates the Dovecot component (IMAP/POP3 server)
   */
  private createDovecotComponent(): void {
    this.dovecotConstruct = new DovecotConstruct(this, 'dovecot', {
      config: this.config,
      namespace: this.mailuNamespace,
      sharedConfigMap: this.sharedConfigMap,
    });
  }

  /**
   * Creates the Rspamd component (spam filter)
   */
  private createRspamdComponent(): void {
    this.rspamdConstruct = new RspamdConstruct(this, 'rspamd', {
      config: this.config,
      namespace: this.mailuNamespace,
      sharedConfigMap: this.sharedConfigMap,
    });
  }

  /**
   * Creates the Webmail component (Roundcube)
   */
  private createWebmailComponent(): void {
    this.webmailConstruct = new WebmailConstruct(this, 'webmail', {
      config: this.config,
      namespace: this.mailuNamespace,
      sharedConfigMap: this.sharedConfigMap,
      frontService: this.frontConstruct?.service, // Pass front service for inter-component communication
    });
  }

  /**
   * Creates the ClamAV component (antivirus)
   */
  private createClamavComponent(): void {
    this.clamavConstruct = new ClamavConstruct(this, 'clamav', {
      config: this.config,
      namespace: this.mailuNamespace,
      sharedConfigMap: this.sharedConfigMap,
    });
  }

  /**
   * Creates the Fetchmail component (external account fetching)
   */
  private createFetchmailComponent(): void {
    this.fetchmailConstruct = new FetchmailConstruct(this, 'fetchmail', {
      config: this.config,
      namespace: this.mailuNamespace,
      sharedConfigMap: this.sharedConfigMap,
    });
  }

  /**
   * Creates the Webdav component (calendar/contacts)
   */
  private createWebdavComponent(): void {
    this.webdavConstruct = new WebdavConstruct(this, 'webdav', {
      config: this.config,
      namespace: this.mailuNamespace,
      sharedConfigMap: this.sharedConfigMap,
    });
  }

  /**
   * Updates ConfigMap with service discovery addresses after components are created
   * This is needed because we need the dynamically generated service names
   */
  private updateConfigMapWithServiceDiscovery(): void {
    if (this.sharedConfigMap) {
      // Add service addresses for inter-component communication
      // Use full Kubernetes DNS names for reliable resolution (namespace.svc.cluster.local)
      // Note: nginx template adds ports automatically (e.g., :8080 for admin, :11334 for antispam)
      const namespace = this.config.namespace;

      if (this.adminConstruct?.service) {
        this.sharedConfigMap.addData('ADMIN_ADDRESS', `${this.adminConstruct.service.name}.${namespace}.svc.cluster.local`);
      }
      if (this.frontConstruct?.service) {
        this.sharedConfigMap.addData('FRONT_ADDRESS', `${this.frontConstruct.service.name}.${namespace}.svc.cluster.local`);
      }
      if (this.webmailConstruct?.service) {
        this.sharedConfigMap.addData('WEBMAIL_ADDRESS', `${this.webmailConstruct.service.name}.${namespace}.svc.cluster.local`);
      }
      if (this.rspamdConstruct?.service) {
        this.sharedConfigMap.addData('ANTISPAM_ADDRESS', `${this.rspamdConstruct.service.name}.${namespace}.svc.cluster.local`);
      }
    }
  }
}
