import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { NginxPatchConfigMap } from '../src/constructs/nginx-patch-configmap';

describe('NginxPatchConfigMap', () => {
  let chart: any;
  let namespace: kplus.Namespace;

  beforeEach(() => {
    chart = Testing.chart();
    namespace = new kplus.Namespace(chart, 'test-namespace', {
      metadata: { name: 'test-mailu' },
    });
  });

  function synthScript(props: { proxyProtocolToFront?: boolean }): string {
    new NginxPatchConfigMap(chart, 'nginx-patch', {
      namespace,
      ...props,
    });
    const manifests = Testing.synth(chart);
    const cm = manifests.find(m => m.kind === 'ConfigMap');
    expect(cm).toBeDefined();
    return cm.data['entrypoint-wrapper.sh'] as string;
  }

  test('default: plain listen directives, no proxy_protocol keyword', () => {
    const script = synthScript({});

    for (const port of [587, 465, 993, 995]) {
      expect(script).toContain(`listen ${port};`);
      expect(script).not.toContain(`listen ${port} proxy_protocol;`);
    }

    // The injected patch marker must not carry the proxy_protocol suffix
    // when the flag is off. We check the marker string specifically rather
    // than the whole script, since the wrapper's explanatory comments may
    // legitimately mention "[proxy_protocol]".
    expect(script).toContain('"# Submission (port 587) for Traefik TLS termination"');
    expect(script).not.toContain('"# Submission (port 587) for Traefik TLS termination [proxy_protocol]"');
  });

  test('proxyProtocolToFront: true → adds proxy_protocol on 465/587/993/995', () => {
    const script = synthScript({ proxyProtocolToFront: true });

    for (const port of [587, 465, 993, 995]) {
      expect(script).toContain(`listen ${port} proxy_protocol;`);
      expect(script).not.toContain(`listen ${port};`);
    }
  });

  test('proxyProtocolToFront: true → idempotency marker carries the flag', () => {
    const script = synthScript({ proxyProtocolToFront: true });

    // The grep guard and the injected comment must agree, otherwise toggling
    // the flag at runtime would accept the previous (now-wrong) injection.
    expect(script).toContain('# Submission (port 587) for Traefik TLS termination [proxy_protocol]');
    // Must use -F (fixed-string): the marker contains `[proxy_protocol]`,
    // which is a regex character class under default grep and would never
    // match the literal injected string. Without -F, the wrapper crashloops.
    expect(script).toContain('grep -qF "# Submission (port 587) for Traefik TLS termination [proxy_protocol]"');
    expect(script).not.toMatch(/grep -q\s+"/); // no plain -q that would be regex-interpreted
  });

  test('proxyProtocolToFront: false explicit matches default', () => {
    const defaultScript = synthScript({});

    // Re-set up a fresh chart for the explicit-false case
    chart = Testing.chart();
    namespace = new kplus.Namespace(chart, 'test-namespace', {
      metadata: { name: 'test-mailu' },
    });
    const explicitFalseScript = synthScript({ proxyProtocolToFront: false });

    expect(explicitFalseScript).toEqual(defaultScript);
  });
});
