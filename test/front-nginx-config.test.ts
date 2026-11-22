import { readFileSync } from 'fs';
import { FRONT_LISTENERS, renderFrontNginxConfig } from '../src/constructs/front-nginx-config';

describe('renderFrontNginxConfig', () => {
  const options = {
    serverName: 'mail.example.com',
    adminAuthUrl: 'http://admin.mailu-test.svc.cluster.local:8080/internal/auth/email',
    messageSizeLimitBytes: 52428800,
    proxyProtocol: true,
    realIpFrom: ['10.42.0.0/16'],
  };

  test('renders the reviewed configuration', () => {
    expect(renderFrontNginxConfig(options)).toBe(readFileSync('test/fixtures/front-nginx.conf', 'utf8'));
  });

  test('every listener reports its public port to admin, never the container port', () => {
    const conf = renderFrontNginxConfig(options);
    for (const l of FRONT_LISTENERS) {
      expect(conf).toMatch(
        new RegExp(`listen ${l.containerPort} proxy_protocol;\\s+protocol ${l.protocol};[^}]*auth_http_header Auth-Port ${l.servicePort};`),
      );
    }
    expect(conf).not.toMatch(/Auth-Port 10\d{3}/);
    expect(conf).not.toMatch(/\b(10025|10143|14190)\b/);
  });

  test('without PROXY protocol there is neither proxy_protocol nor set_real_ip_from', () => {
    const conf = renderFrontNginxConfig({ ...options, proxyProtocol: false });
    expect(conf).not.toContain('proxy_protocol');
    expect(conf).not.toContain('set_real_ip_from');
    expect(conf).toContain('listen 10993;');
  });

  test('one set_real_ip_from line per network', () => {
    const conf = renderFrontNginxConfig({ ...options, realIpFrom: ['10.42.0.0/16', 'fd00::/48'] });
    expect(conf.match(/set_real_ip_from /g)).toHaveLength(2);
  });

  test('the SMTP size capability follows the message size limit', () => {
    expect(renderFrontNginxConfig({ ...options, messageSizeLimitBytes: 10485760 })).toContain('"SIZE 10485760"');
  });

  test('no client name resolution, two workers, info log for CrowdSec', () => {
    const conf = renderFrontNginxConfig(options);
    expect(conf).not.toMatch(/^\s*resolver /m);
    expect(conf).toMatch(/^worker_processes 2;$/m);
    expect(conf).toMatch(/^error_log \/dev\/stderr info;$/m);
    expect(conf).not.toMatch(/^user /m);
  });

  test('proxyProtocol without a trusted network is rejected', () => {
    expect(() => renderFrontNginxConfig({ ...options, realIpFrom: [] })).toThrow(/realIpFrom/);
  });
});
