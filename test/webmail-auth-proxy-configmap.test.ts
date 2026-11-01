import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { WebmailAuthProxyConfigMap } from '../src/constructs/webmail-auth-proxy-configmap';

describe('WebmailAuthProxyConfigMap', () => {
  let chart: any;
  let namespace: kplus.Namespace;

  beforeEach(() => {
    chart = Testing.chart();
    namespace = new kplus.Namespace(chart, 'test-namespace', {
      metadata: { name: 'test-mailu' },
    });
  });

  function nginxConf(): string {
    new WebmailAuthProxyConfigMap(chart, 'auth-proxy-cm', { namespace });
    const manifests = Testing.synth(chart);
    const cm = manifests.find(
      (m: any) => m.kind === 'ConfigMap' && m.data?.['nginx.conf.template'],
    );
    expect(cm).toBeDefined();
    return cm.data['nginx.conf.template'];
  }

  test('redirects bare /webmail to /webmail/ so relative redirects resolve', () => {
    // Roundcube answers with relative Location headers (e.g. "index.php").
    // At /webmail (no trailing slash) the browser resolves those against "/",
    // landing on unrouted paths like /index.php — dead 404 and CSS-less pages.
    const conf = nginxConf();
    expect(conf).toContain('location = /webmail {');
    expect(conf).toContain('return 301 /webmail/;');
  });

  test('keeps Location headers that already carry the /webmail prefix', () => {
    // Roundcube builds absolute redirects from request_path (WEB_WEBMAIL=/webmail),
    // e.g. "/webmail/?_task=mail&_action=compose". Prefixing them again yields
    // /webmail/webmail/…, where every relative asset URL 404s.
    // nginx applies the first matching proxy_redirect, so order matters.
    const conf = nginxConf();
    const keepPrefixed = conf.indexOf('proxy_redirect /webmail/ /webmail/;');
    const addPrefix = conf.indexOf('proxy_redirect / /webmail/;');
    expect(keepPrefixed).toBeGreaterThan(-1);
    expect(addPrefix).toBeGreaterThan(keepPrefixed);
  });

  test('proxies /webmail/ paths to the webmail backend with auth', () => {
    const conf = nginxConf();
    expect(conf).toContain('auth_request /_auth;');
    expect(conf).toContain('proxy_pass http://webmail_backend');
  });

  test('every location that reaches the webmail backend requires auth', () => {
    // The webmail container hands unknown paths to index.php (try_files) and
    // *.php to PHP-FPM, so any unauthenticated route to it executes PHP.
    const conf = nginxConf();
    const locations = conf.split(/\n\s*location /).slice(1);
    const toWebmail = locations.filter((block) => block.includes('proxy_pass http://webmail_backend'));
    expect(toWebmail.length).toBeGreaterThan(0);
    for (const block of toWebmail) {
      const header = block.split('\n')[0];
      expect({ location: header, hasAuth: block.includes('auth_request /_auth;') })
        .toEqual({ location: header, hasAuth: true });
    }
  });
});
