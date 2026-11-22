/**
 * nginx configuration of the front: a mail proxy for the TLS-terminated mail
 * ports, authenticating every login against the Mailu admin.
 */

export interface FrontListener {
  /** Port name on the Service and the container */
  readonly name: 'smtps' | 'imaps' | 'pop3s';
  readonly protocol: 'smtp' | 'imap' | 'pop3';
  /** Public port. Admin decides on it, so it is what `Auth-Port` reports. */
  readonly servicePort: number;
  /** Unprivileged port nginx listens on, because it does not run as root */
  readonly containerPort: number;
}

// The container ports must never be 10025, 10143 or 14190: admin treats those
// values in `Auth-Port` as "webmail" and skips rate limiting for them.
export const FRONT_LISTENERS: readonly FrontListener[] = [
  { name: 'smtps', protocol: 'smtp', servicePort: 465, containerPort: 10465 },
  { name: 'imaps', protocol: 'imap', servicePort: 993, containerPort: 10993 },
  { name: 'pop3s', protocol: 'pop3', servicePort: 995, containerPort: 10995 },
];

export const FRONT_HEALTH_PORT = 8080;

export interface FrontNginxConfigOptions {
  /** Name the mail proxy greets clients with */
  readonly serverName: string;
  /** Mailu admin endpoint that decides every login, `http://<admin>:8080/internal/auth/email` */
  readonly adminAuthUrl: string;
  /** Advertised as the SMTP `SIZE` capability; must match the limit of postfix */
  readonly messageSizeLimitBytes: number;
  /** Whether the proxy in front (Traefik) sends a PROXY protocol header */
  readonly proxyProtocol: boolean;
  /** Networks whose PROXY header is trusted for the client address */
  readonly realIpFrom: readonly string[];
}

function renderListener(listener: FrontListener, proxyProtocol: boolean): string {
  return [
    '    server {',
    `        listen ${listener.containerPort}${proxyProtocol ? ' proxy_protocol' : ''};`,
    `        protocol ${listener.protocol};`,
    `        ${listener.protocol}_auth plain;`,
    `        auth_http_header Auth-Port ${listener.servicePort};`,
    // nginx sends the literal text; admin only logs it but rejects a missing header.
    '        auth_http_header Client-Port $remote_port;',
    '    }',
  ].join('\n');
}

export function renderFrontNginxConfig(options: FrontNginxConfigOptions): string {
  if (options.proxyProtocol && options.realIpFrom.length === 0) {
    // Without a trusted network admin sees the proxy's address for every
    // client, and its per-network rate limit locks everyone out together.
    throw new Error('Front nginx config: proxyProtocol needs at least one network in realIpFrom');
  }

  const realIp = options.proxyProtocol
    ? options.realIpFrom.map((network) => `    set_real_ip_from ${network};`)
    : [];

  return [
    // One worker per host core ("auto") wastes memory on large nodes.
    'worker_processes 2;',
    // "info" carries the "client login failed" lines that intrusion detection parses.
    'error_log /dev/stderr info;',
    'pid /tmp/nginx.pid;',
    '',
    'events {',
    '    worker_connections 1024;',
    '}',
    '',
    'mail {',
    `    server_name ${options.serverName};`,
    `    auth_http ${options.adminAuthUrl};`,
    '    proxy_pass_error_message on;',
    ...realIp,
    '',
    `    smtp_capabilities PIPELINING "SIZE ${options.messageSizeLimitBytes}" ETRN ENHANCEDSTATUSCODES 8BITMIME DSN;`,
    '',
    ...FRONT_LISTENERS.map((listener) => renderListener(listener, options.proxyProtocol)),
    '}',
    '',
    // Only the health endpoint for the probes. A TCP probe on a mail port
    // would log an error on every run, because it sends no PROXY header.
    'http {',
    '    access_log off;',
    '    client_body_temp_path /tmp/client_body;',
    '    proxy_temp_path /tmp/proxy;',
    '    fastcgi_temp_path /tmp/fastcgi;',
    '    uwsgi_temp_path /tmp/uwsgi;',
    '    scgi_temp_path /tmp/scgi;',
    '    server {',
    `        listen ${FRONT_HEALTH_PORT};`,
    '        location = /health {',
    '            return 204;',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');
}
