import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import * as k8s from '../imports/k8s';
import * as traefik from '../imports/traefik.io';

export interface TraefikIngressConstructProps {
  /**
   * Kubernetes namespace
   */
  namespace: string;

  /**
   * Mail domain (for documentation/labels)
   * @example "example.com"
   */
  domain: string;

  /**
   * Hostname for ingress (FQDN)
   * @example "mail.example.com"
   */
  hostname: string;

  /**
   * cert-manager ClusterIssuer name for TLS certificates
   * @default "letsencrypt-cluster-issuer"
   */
  certIssuer?: string;

  /**
   * Reference to the Mailu front service (nginx proxy for mail protocols)
   */
  frontService: kplus.Service;

  /**
   * Reference to the Mailu admin service (admin UI and SSO)
   */
  adminService: kplus.Service;

  /**
   * Reference to the Mailu webmail service (webmail UI)
   */
  webmailService: kplus.Service;

  /**
   * Reference to the Mailu postfix service (for direct SMTP routing)
   */
  postfixService: kplus.Service;

  /**
   * Reference to the Mailu rspamd service (for antispam web UI)
   */
  rspamdService: kplus.Service;

  /**
   * Enable TCP routes for mail protocols (SMTP, IMAP, POP3, etc.)
   * @default true
   */
  enableTcp?: boolean;

  /**
   * SMTP rate limiting (maximum concurrent connections per IP)
   * @default 15
   */
  smtpConnectionLimit?: number;

  /**
   * Enable SMTP port 25 for receiving mail from external servers
   * @default false
   */
  enableSmtp?: boolean;

  /**
   * Reference to the webmail auth proxy service (handles auth + redirect)
   * When provided, webmail ingress will route through this proxy instead of
   * using ForwardAuth middleware, enabling proper redirect on auth failure.
   */
  webmailAuthProxyService?: kplus.Service;
}

export class TraefikIngressConstruct extends Construct {
  public readonly httpIngress: k8s.KubeIngress;
  public readonly webmailIngress: k8s.KubeIngress;
  public readonly antispamIngress: k8s.KubeIngress;
  public readonly ssoPhpIngress: k8s.KubeIngress;
  public readonly tcpRoutes: traefik.IngressRouteTcp[];

  constructor(scope: Construct, id: string, props: TraefikIngressConstructProps) {
    super(scope, id);

    const certIssuer = props.certIssuer ?? 'letsencrypt-cluster-issuer';
    const enableTcp = props.enableTcp ?? true;
    const smtpConnectionLimit = props.smtpConnectionLimit ?? 15;
    const enableSmtp = props.enableSmtp ?? false; // Default false for security

    this.tcpRoutes = [];

    // HTTP/HTTPS Ingress for webmail and admin (uses cert-manager)
    // Routes different paths to appropriate services:
    // - /admin, /sso, /static → admin service (admin UI, SSO login, static assets)
    // - /webmail → webmail service (webmail UI)
    // - /health → front service (health check only)
    // - /internal → admin service (internal auth endpoints)
    //
    // NOTE: Front service does NOT serve general HTTP traffic - it only handles
    // mail protocols (SMTP, IMAP, POP3) via IngressRouteTCP resources.
    // The only HTTP endpoint on front service is /health for health checks.
    this.httpIngress = new k8s.KubeIngress(this, 'webmail-ingress', {
      metadata: {
        name: 'mailu-webmail',
        namespace: props.namespace,
        annotations: {
          // Use cert-manager to provision Let's Encrypt certificate
          'cert-manager.io/cluster-issuer': certIssuer,
        },
      },
      spec: {
        ingressClassName: 'traefik',
        tls: [
          {
            hosts: [props.hostname],
            secretName: 'mailu-tls',
          },
        ],
        rules: [
          {
            host: props.hostname,
            http: {
              paths: [
                // Admin paths (most specific first)
                {
                  path: '/admin',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: props.adminService.name,
                      port: {
                        number: 8080,
                      },
                    },
                  },
                },
                // SSO path (handled by Flask at /sso/login)
                // Note: /sso.php routes are handled by separate ssoPhpIngress with redirect middleware
                {
                  path: '/sso',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: props.adminService.name,
                      port: {
                        number: 8080,
                      },
                    },
                  },
                },
                {
                  path: '/static',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: props.adminService.name,
                      port: {
                        number: 8080,
                      },
                    },
                  },
                },
                {
                  path: '/internal',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: props.adminService.name,
                      port: {
                        number: 8080,
                      },
                    },
                  },
                },
                // NOTE: /webmail path is handled by separate webmailIngress with ForwardAuth middleware
                // Health check endpoint on front service
                {
                  path: '/health',
                  pathType: 'Exact',
                  backend: {
                    service: {
                      name: props.frontService.name,
                      port: {
                        number: 80,
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    });

    // Create TLSOption matching Mailu's nginx tls.conf settings
    // This ensures email clients get the same TLS configuration as if Mailu handled TLS directly
    new traefik.TlsOption(this, 'mail-tls-option', {
      metadata: {
        name: 'mailu-mail-tls',
        namespace: props.namespace,
      },
      spec: {
        minVersion: 'VersionTLS12', // Match Mailu's minimum (TLSv1.2)
        alpnProtocols: ['h2', 'http/1.1', 'acme-tls/1', 'imap'], // iOS Mail.app requires 'imap' ALPN
        cipherSuites: [
          // Match Mailu's cipher suite order (TLS 1.2 only, TLS 1.3 not configurable)
          'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
          'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
          'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
          'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
          'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305',
          'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305',
        ],
        // Note: Client chooses cipher (matches Mailu's preferServerCipherSuites: off)
        // Traefik doesn't have preferServerCipherSuites option, defaults to client preference
      },
    });

    // Create ForwardAuth Middleware for protecting admin-only routes
    // This middleware delegates authentication to the admin service's /internal/auth/admin endpoint
    // which verifies the user is logged in as a global admin before allowing access
    new traefik.Middleware(this, 'admin-auth-middleware', {
      metadata: {
        name: 'mailu-admin-auth',
        namespace: props.namespace,
      },
      spec: {
        forwardAuth: {
          // Point to admin service's internal auth endpoint
          address: `http://${props.adminService.name}.${props.namespace}.svc.cluster.local:8080/internal/auth/admin`,
          // Don't trust X-Forwarded-* headers from the authentication request
          trustForwardHeader: false,
        },
      },
    });

    // Create ForwardAuth Middleware for webmail authentication
    // This middleware checks if user is authenticated and passes user credentials to webmail
    // The auth endpoint returns X-User and X-User-Token headers that Roundcube uses for authentication
    new traefik.Middleware(this, 'webmail-auth-middleware', {
      metadata: {
        name: 'mailu-webmail-auth',
        namespace: props.namespace,
      },
      spec: {
        forwardAuth: {
          // Point to user auth endpoint that verifies session and returns user info headers
          address: `http://${props.adminService.name}.${props.namespace}.svc.cluster.local:8080/internal/auth/user`,
          // Pass through X-User and X-User-Token headers from auth response to webmail
          // The Roundcube plugin (patched) expects these headers for authentication
          authResponseHeaders: ['X-User', 'X-User-Token'],
          // Don't trust X-Forwarded-* headers from the authentication request
          trustForwardHeader: false,
        },
      },
    });

    // Create StripPrefix Middleware to remove /webmail before forwarding to webmail service
    // Webmail nginx expects requests at root /, but ingress sends /webmail/*
    new traefik.Middleware(this, 'webmail-strip-prefix', {
      metadata: {
        name: 'mailu-webmail-strip-prefix',
        namespace: props.namespace,
      },
      spec: {
        stripPrefix: {
          prefixes: ['/webmail'],
        },
      },
    });

    // Create StripPrefix Middleware to remove /admin/antispam before forwarding to Rspamd
    // Rspamd's web interface is at the root path /, not /admin/antispam/
    new traefik.Middleware(this, 'antispam-strip-prefix', {
      metadata: {
        name: 'mailu-antispam-strip-prefix',
        namespace: props.namespace,
      },
      spec: {
        stripPrefix: {
          prefixes: ['/admin/antispam'],
        },
      },
    });

    // Create RedirectRegex Middleware to redirect sso.php to /sso/login
    // Roundcube's mailu plugin expects sso.php but Flask serves /sso/login
    new traefik.Middleware(this, 'sso-php-redirect', {
      metadata: {
        name: 'mailu-sso-php-redirect',
        namespace: props.namespace,
      },
      spec: {
        redirectRegex: {
          regex: '^https?://([^/]+)(/webmail)?/sso\\.php(.*)$',
          replacement: 'https://${1}/sso/login${3}',
          permanent: false,
        },
      },
    });

    // Separate Ingress for sso.php redirect compatibility
    // Roundcube's mailu plugin redirects to sso.php but Flask serves /sso/login
    // This ingress catches sso.php requests and redirects to /sso/login
    this.ssoPhpIngress = new k8s.KubeIngress(this, 'sso-php-ingress', {
      metadata: {
        name: 'mailu-sso-php',
        namespace: props.namespace,
        annotations: {
          'cert-manager.io/cluster-issuer': certIssuer,
          // Apply redirect middleware to rewrite sso.php to /sso/login
          'traefik.ingress.kubernetes.io/router.middlewares': `${props.namespace}-mailu-sso-php-redirect@kubernetescrd`,
          // Higher priority to ensure this ingress is checked before mailu-webmail ingress
          'traefik.ingress.kubernetes.io/router.priority': '100',
        },
      },
      spec: {
        ingressClassName: 'traefik',
        tls: [
          {
            hosts: [props.hostname],
            secretName: 'mailu-tls',
          },
        ],
        rules: [
          {
            host: props.hostname,
            http: {
              paths: [
                {
                  path: '/sso.php',
                  pathType: 'Exact',
                  backend: {
                    service: {
                      name: props.adminService.name,
                      port: {
                        number: 8080,
                      },
                    },
                  },
                },
                {
                  path: '/webmail/sso.php',
                  pathType: 'Exact',
                  backend: {
                    service: {
                      name: props.adminService.name,
                      port: {
                        number: 8080,
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    });

    // Separate Ingress for webmail with authentication
    // When auth proxy is provided, route through it (handles auth + redirect on failure)
    // Otherwise, use ForwardAuth middleware (returns 403 on auth failure - legacy behavior)
    // NOTE: We do NOT strip /webmail prefix - the webmail nginx is configured (via WEB_WEBMAIL env)
    // to handle requests at /webmail and generate correct asset paths
    const useAuthProxy = !!props.webmailAuthProxyService;
    const webmailBackendService = useAuthProxy
      ? props.webmailAuthProxyService!
      : props.webmailService;

    // Build annotations - only include ForwardAuth when not using auth proxy
    const webmailIngressAnnotations: Record<string, string> = {
      // Use cert-manager to provision Let's Encrypt certificate
      'cert-manager.io/cluster-issuer': certIssuer,
    };
    if (!useAuthProxy) {
      // Apply ForwardAuth middleware when not using auth proxy (legacy behavior)
      webmailIngressAnnotations['traefik.ingress.kubernetes.io/router.middlewares'] =
        `${props.namespace}-mailu-webmail-auth@kubernetescrd`;
    }

    this.webmailIngress = new k8s.KubeIngress(this, 'webmail-auth-ingress', {
      metadata: {
        name: 'mailu-webmail-auth',
        namespace: props.namespace,
        annotations: webmailIngressAnnotations,
      },
      spec: {
        ingressClassName: 'traefik',
        tls: [
          {
            hosts: [props.hostname],
            secretName: 'mailu-tls',
          },
        ],
        rules: [
          {
            host: props.hostname,
            http: {
              paths: [
                {
                  path: '/webmail',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: webmailBackendService.name,
                      port: {
                        number: 80,
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    });

    // Separate Ingress for Rspamd antispam web UI with ForwardAuth middleware
    // This proxies /admin/antispam/* to Rspamd's web interface on port 11334
    // and ensures only authenticated global admins can access it
    this.antispamIngress = new k8s.KubeIngress(this, 'antispam-ingress', {
      metadata: {
        name: 'mailu-antispam',
        namespace: props.namespace,
        annotations: {
          // Use cert-manager to provision Let's Encrypt certificate
          'cert-manager.io/cluster-issuer': certIssuer,
          // Apply middlewares: ForwardAuth for authentication, StripPrefix for path rewriting
          'traefik.ingress.kubernetes.io/router.middlewares': `${props.namespace}-mailu-admin-auth@kubernetescrd,${props.namespace}-mailu-antispam-strip-prefix@kubernetescrd`,
        },
      },
      spec: {
        ingressClassName: 'traefik',
        tls: [
          {
            hosts: [props.hostname],
            secretName: 'mailu-tls',
          },
        ],
        rules: [
          {
            host: props.hostname,
            http: {
              paths: [
                {
                  path: '/admin/antispam',
                  pathType: 'Prefix',
                  backend: {
                    service: {
                      name: props.rspamdService.name,
                      port: {
                        number: 11334,
                      },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    });

    // TCP routes for mail protocols (SMTP, IMAP, etc)
    if (enableTcp) {
      // SMTP (port 25) - Only create if explicitly enabled
      // WARNING: Port 25 should only be enabled if you need to receive mail from external MTAs
      // and Postfix relay restrictions are properly configured with RELAYNETS=""
      if (enableSmtp) {
        // SMTP Rate Limiting Middleware
        // Limits simultaneous connections to protect against connection flooding
        new traefik.MiddlewareTcp(this, 'smtp-connection-limit', {
          metadata: {
            name: 'smtp-connection-limit',
            namespace: props.namespace,
          },
          spec: {
            inFlightConn: {
              amount: smtpConnectionLimit, // Max simultaneous connections per source IP
            },
          },
        });

        // SMTP (port 25)
        // Routes directly to Postfix (bypassing Front/nginx) with rate limiting
        // Port 25 never requires authentication (MX delivery standard)
        // Postfix handles spam filtering, DNSBL checks, and message rate limiting
        const smtpRoute = new traefik.IngressRouteTcp(this, 'smtp', {
          metadata: {
            name: 'mailu-smtp',
            namespace: props.namespace,
          },
          spec: {
            entryPoints: ['smtp'],
            routes: [
              {
                match: 'HostSNI(`*`)',
                middlewares: [
                  {
                    name: 'smtp-connection-limit',
                  },
                ],
                services: [
                  {
                    name: props.postfixService.name, // Direct to Postfix (bypass nginx)
                    port: k8s.IntOrString.fromNumber(25),
                    // Enable PROXY protocol v2 to preserve real client IP
                    // This is critical for relay restrictions to work correctly
                    proxyProtocol: {
                      version: 2,
                    },
                  },
                ],
              },
            ],
          },
        });
        this.tcpRoutes.push(smtpRoute);
      }

      // SMTPS (port 465) - SMTP over SSL
      // Traefik terminates TLS using mailu-tls certificate and mail TLS options
      const smtpsRoute = new traefik.IngressRouteTcp(this, 'smtps', {
        metadata: {
          name: 'mailu-smtps',
          namespace: props.namespace,
        },
        spec: {
          entryPoints: ['smtps'],
          routes: [
            {
              match: 'HostSNI(`*`)',
              services: [
                {
                  name: props.frontService.name,
                  port: k8s.IntOrString.fromNumber(465),
                },
              ],
            },
          ],
          tls: {
            secretName: 'mailu-tls',
            options: {
              name: 'mailu-mail-tls',
              namespace: props.namespace,
            },
          },
        },
      });
      this.tcpRoutes.push(smtpsRoute);

      // SMTP Submission (port 587) - SMTP with STARTTLS
      const submissionRoute = new traefik.IngressRouteTcp(this, 'submission', {
        metadata: {
          name: 'mailu-submission',
          namespace: props.namespace,
        },
        spec: {
          entryPoints: ['smtp-submission'],
          routes: [
            {
              match: 'HostSNI(`*`)',
              services: [
                {
                  name: props.frontService.name,
                  port: k8s.IntOrString.fromNumber(587),
                },
              ],
            },
          ],
        },
      });
      this.tcpRoutes.push(submissionRoute);

      // IMAPS (port 993)
      // Traefik terminates TLS using mailu-tls certificate and mail TLS options
      const imapsRoute = new traefik.IngressRouteTcp(this, 'imaps', {
        metadata: {
          name: 'mailu-imaps',
          namespace: props.namespace,
        },
        spec: {
          entryPoints: ['imaps'],
          routes: [
            {
              match: 'HostSNI(`*`)',
              services: [
                {
                  name: props.frontService.name,
                  port: k8s.IntOrString.fromNumber(993),
                },
              ],
            },
          ],
          tls: {
            secretName: 'mailu-tls',
            options: {
              name: 'mailu-mail-tls',
              namespace: props.namespace,
            },
          },
        },
      });
      this.tcpRoutes.push(imapsRoute);

      // POP3S (port 995)
      // Traefik terminates TLS using mailu-tls certificate and mail TLS options
      const pop3sRoute = new traefik.IngressRouteTcp(this, 'pop3s', {
        metadata: {
          name: 'mailu-pop3s',
          namespace: props.namespace,
        },
        spec: {
          entryPoints: ['pop3s'],
          routes: [
            {
              match: 'HostSNI(`*`)',
              services: [
                {
                  name: props.frontService.name,
                  port: k8s.IntOrString.fromNumber(995),
                },
              ],
            },
          ],
          tls: {
            secretName: 'mailu-tls',
            options: {
              name: 'mailu-mail-tls',
              namespace: props.namespace,
            },
          },
        },
      });
      this.tcpRoutes.push(pop3sRoute);
    }
  }
}
