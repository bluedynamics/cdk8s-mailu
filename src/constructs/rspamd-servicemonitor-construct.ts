import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import * as monitoring from '../imports/monitoring.coreos.com';

export interface RspamdServiceMonitorConstructProps {
  readonly namespace: string;
  readonly service: kplus.Service;
}

/**
 * ServiceMonitor Construct for Rspamd metrics
 *
 * Creates a Prometheus Operator ServiceMonitor that tells Prometheus
 * to scrape metrics from the Rspamd HTTP interface.
 *
 * Rspamd exposes Prometheus metrics on its web interface (port 11334) at /metrics.
 *
 * Metrics exposed:
 * - rspamd_scanned_total: Total messages scanned
 * - rspamd_ham_count: Legitimate messages
 * - rspamd_spam_count: Spam messages
 * - rspamd_actions_total: Actions taken (reject, rewrite subject, etc.)
 * - rspamd_learn_spam_total, rspamd_learn_ham_total: Bayes learning stats
 * - rspamd_fuzzy_*: Fuzzy hash statistics
 * - ~15 metrics total
 */
export class RspamdServiceMonitorConstruct extends Construct {
  public readonly serviceMonitor: monitoring.ServiceMonitor;

  constructor(scope: Construct, id: string, props: RspamdServiceMonitorConstructProps) {
    super(scope, id);

    const { namespace } = props;

    // Create ServiceMonitor for Rspamd metrics
    // This tells Prometheus Operator to scrape metrics from Rspamd's HTTP interface
    this.serviceMonitor = new monitoring.ServiceMonitor(this, 'servicemonitor', {
      metadata: {
        name: 'mailu-rspamd',
        namespace,
        labels: {
          'app.kubernetes.io/name': 'mailu-rspamd',
          'app.kubernetes.io/component': 'rspamd',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      spec: {
        selector: {
          matchLabels: {
            'app.kubernetes.io/name': 'mailu-rspamd',
            'app.kubernetes.io/component': 'rspamd',
          },
        },
        endpoints: [
          {
            port: 'rspamd', // Port 11334 from Rspamd service
            interval: '30s',
            path: '/metrics',
          },
        ],
      },
    });
  }
}
