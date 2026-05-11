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

  test('default: no set_real_ip_from injection (Patch 3 omitted)', () => {
    const script = synthScript({});

    // Without proxyProtocolToFront, Patch 3 is not emitted at all. The mail{}
    // block keeps its stock layout (port 25's own real_ip handling, governed
    // by Mailu's template, is unchanged because we don't touch error_log line).
    expect(script).not.toContain('Patch 3:');
    expect(script).not.toContain('set_real_ip_from');
    expect(script).not.toContain('REAL_IP_FROM');
  });

  test('proxyProtocolToFront: true → injects set_real_ip_from in mail context', () => {
    const script = synthScript({ proxyProtocolToFront: true });

    // Patch 3 must be present, anchored on a unique label so future edits
    // are easy to spot in the rendered manifest.
    expect(script).toContain('Patch 3:');
    expect(script).toContain('set_real_ip_from for mail context (PROXY protocol) [proxy_protocol]');
    // CIDR list comes from $REAL_IP_FROM at runtime; the wrapper must split
    // it on commas and emit one set_real_ip_from line per CIDR.
    expect(script).toContain('for cidr in $REAL_IP_FROM');
    expect(script).toContain('set_real_ip_from $(echo "$cidr" | tr -d \' \');');
    // Must hard-fail rather than silently no-op if REAL_IP_FROM is missing.
    expect(script).toMatch(/if \[ -z "\$REAL_IP_FROM" \];/);
    // awk is used for the actual insertion because multi-line sed-append
    // through bash variables is brittle in Alpine BusyBox.
    expect(script).toContain('awk -v injf=');
    expect(script).toContain('/^mail {/ { in_mail=1 }');
    expect(script).toContain('/^    error_log \\/dev\\/stderr info;$/');
  });

  test('proxyProtocolToFront: true → set_real_ip_from injection is idempotent', () => {
    const script = synthScript({ proxyProtocolToFront: true });

    // Re-runs of the wrapper must not double-inject. The flag-baked marker
    // gates the awk call so subsequent starts (Pod restart with unchanged
    // ConfigMap) are no-ops.
    expect(script).toMatch(/grep -qF "\$REALIP_MARKER"/);
    // The marker carries the flag suffix so toggling the flag forces a
    // re-patch (same pattern as Patch 2's idempotency marker).
    expect(script).toContain('[proxy_protocol]');
  });

  test('nginx -t validation runs unconditionally before exec', () => {
    // Independent hardening: catches future patch bugs (escape mishaps,
    // anchor drift) loudly in pod logs instead of silently breaking mail.
    for (const flag of [undefined, false, true]) {
      // Re-set up chart per case so synthScript stays single-shot
      chart = Testing.chart();
      namespace = new kplus.Namespace(chart, 'test-namespace', {
        metadata: { name: 'test-mailu' },
      });
      const script = synthScript(flag === undefined ? {} : { proxyProtocolToFront: flag });

      expect(script).toContain('Validating final nginx configuration...');
      expect(script).toContain('/usr/sbin/nginx -t -c "$NGINX_CONF"');
      // Validation must precede the `exec` so a bad config never reaches
      // a running nginx master.
      const tIdx = script.indexOf('/usr/sbin/nginx -t -c');
      const execIdx = script.indexOf('exec /usr/sbin/nginx -g');
      expect(tIdx).toBeGreaterThanOrEqual(0);
      expect(execIdx).toBeGreaterThan(tIdx);
    }
  });
});
