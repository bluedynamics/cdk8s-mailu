/**
 * Prints what MailuChart renders for the front, for run.sh to feed to a real
 * nginx in front of a Mailu stack.
 *
 * Usage: render-front-config.ts [config|image]
 */
import { Testing } from 'cdk8s';
import { MailuChart } from '../../src/mailu-chart';

const chart = new MailuChart(Testing.app(), 'integration', {
  namespace: 'mailu',
  domain: 'test.example',
  hostnames: ['mail.test.example'],
  // The compose network lies inside this subnet, like pods inside the pod network
  subnet: '10.42.0.0/16',
  database: {
    type: 'postgresql',
    postgresql: { host: 'postgres', secretName: 'postgres' },
  },
  redis: { host: 'redis' },
  secrets: { mailuSecretKey: 'mailu-secret-key' },
  // The test client sends a PROXY header, as Traefik does
  ingress: {
    enabled: false,
    type: 'traefik',
    traefik: { hostname: 'mail.test.example', proxyProtocolToFront: true },
  },
});

const front = chart.frontConstruct!;
const outputs: Record<string, string> = {
  config: front.configMap.data['nginx.conf'],
  image: `${front.deployment.containers[0].image}\n`,
};

const what = process.argv[2] ?? 'config';
if (!(what in outputs)) {
  process.stderr.write(`usage: render-front-config.ts [${Object.keys(outputs).join('|')}]\n`);
  process.exit(2);
}
process.stdout.write(outputs[what]);
