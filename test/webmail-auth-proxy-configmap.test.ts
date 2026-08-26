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

  test('proxies /webmail/ paths to the webmail backend with auth', () => {
    const conf = nginxConf();
    expect(conf).toContain('auth_request /_auth;');
    expect(conf).toContain('proxy_pass http://webmail_backend');
  });
});
