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
   * Reference to the Mailu front service (nginx proxy)
   */
  frontService: kplus.Service;

  /**
   * Reference to the Mailu postfix service (for direct SMTP routing)
   */
  postfixService: kplus.Service;

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
}

export class TraefikIngressConstruct extends Construct {
  public readonly httpIngress: k8s.KubeIngress;
  public readonly tcpRoutes: traefik.IngressRouteTcp[];

  constructor(scope: Construct, id: string, props: TraefikIngressConstructProps) {
    super(scope, id);

    const certIssuer = props.certIssuer ?? 'letsencrypt-cluster-issuer';
    const enableTcp = props.enableTcp ?? true;
    const smtpConnectionLimit = props.smtpConnectionLimit ?? 15;

    this.tcpRoutes = [];

    // HTTP/HTTPS Ingress for webmail and admin (uses cert-manager)
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
                {
                  path: '/',
                  pathType: 'Prefix',
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

    // TCP routes for mail protocols (SMTP, IMAP, etc)
    if (enableTcp) {
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
                },
              ],
            },
          ],
        },
      });
      this.tcpRoutes.push(smtpRoute);

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

      // IMAP (port 143)
      const imapRoute = new traefik.IngressRouteTcp(this, 'imap', {
        metadata: {
          name: 'mailu-imap',
          namespace: props.namespace,
        },
        spec: {
          entryPoints: ['imap'],
          routes: [
            {
              match: 'HostSNI(`*`)',
              services: [
                {
                  name: props.frontService.name,
                  port: k8s.IntOrString.fromNumber(143),
                },
              ],
            },
          ],
        },
      });
      this.tcpRoutes.push(imapRoute);

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

      // POP3 (port 110)
      const pop3Route = new traefik.IngressRouteTcp(this, 'pop3', {
        metadata: {
          name: 'mailu-pop3',
          namespace: props.namespace,
        },
        spec: {
          entryPoints: ['pop3'],
          routes: [
            {
              match: 'HostSNI(`*`)',
              services: [
                {
                  name: props.frontService.name,
                  port: k8s.IntOrString.fromNumber(110),
                },
              ],
            },
          ],
        },
      });
      this.tcpRoutes.push(pop3Route);

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
