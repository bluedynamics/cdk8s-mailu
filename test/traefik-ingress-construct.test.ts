import { Testing } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { TraefikIngressConstruct } from '../src/constructs/traefik-ingress-construct';

describe('TraefikIngressConstruct', () => {
  let chart: any;

  function makeService(id: string, name: string): kplus.Service {
    return new kplus.Service(chart, id, {
      metadata: { name, namespace: 'test-mailu' },
      ports: [{ port: 80 }],
    });
  }

  beforeEach(() => {
    chart = Testing.chart();
  });

  function synthRoutes(props: { proxyProtocolToFront?: boolean; enableSmtp?: boolean }) {
    new TraefikIngressConstruct(chart, 'traefik-ingress', {
      namespace: 'test-mailu',
      domain: 'test.example.com',
      hostname: 'mail.test.example.com',
      frontService: makeService('front', 'mailu-front'),
      adminService: makeService('admin', 'mailu-admin'),
      webmailService: makeService('webmail', 'mailu-webmail'),
      postfixService: makeService('postfix', 'mailu-postfix'),
      rspamdService: makeService('rspamd', 'mailu-rspamd'),
      enableTcp: true,
      enableSmtp: props.enableSmtp ?? true,
      proxyProtocolToFront: props.proxyProtocolToFront,
    });
    const manifests = Testing.synth(chart);

    const byName = (name: string) =>
      manifests.find(m => m.kind === 'IngressRouteTCP' && m.metadata?.name === name);

    return {
      smtp: byName('mailu-smtp'),
      smtps: byName('mailu-smtps'),
      submission: byName('mailu-submission'),
      imaps: byName('mailu-imaps'),
      pop3s: byName('mailu-pop3s'),
    };
  }

  function serviceOf(route: any) {
    return route.spec.routes[0].services[0];
  }

  test('port 25 always uses PROXY v2 (independent of flag)', () => {
    for (const flag of [undefined, false, true]) {
      chart = Testing.chart();
      const { smtp } = synthRoutes({ proxyProtocolToFront: flag });
      expect(serviceOf(smtp).proxyProtocol).toEqual({ version: 2 });
    }
  });

  test('default: front-bound routes (465/587/993/995) have NO proxyProtocol', () => {
    const { smtps, submission, imaps, pop3s } = synthRoutes({});

    for (const route of [smtps, submission, imaps, pop3s]) {
      expect(serviceOf(route)).not.toHaveProperty('proxyProtocol');
    }
  });

  test('proxyProtocolToFront: true → all four front routes get PROXY v2', () => {
    const { smtps, submission, imaps, pop3s } = synthRoutes({ proxyProtocolToFront: true });

    for (const route of [smtps, submission, imaps, pop3s]) {
      expect(serviceOf(route).proxyProtocol).toEqual({ version: 2 });
    }
  });

  test('proxyProtocolToFront: false explicit matches default', () => {
    const defaultRoutes = synthRoutes({});

    chart = Testing.chart();
    const explicitFalseRoutes = synthRoutes({ proxyProtocolToFront: false });

    for (const port of ['smtps', 'submission', 'imaps', 'pop3s'] as const) {
      expect(serviceOf(explicitFalseRoutes[port])).toEqual(serviceOf(defaultRoutes[port]));
    }
  });
});
