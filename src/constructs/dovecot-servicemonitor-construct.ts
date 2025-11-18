import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import * as monitoring from '../imports/monitoring.coreos.com';

export interface DovecotServiceMonitorConstructProps {
  readonly namespace: string;
  readonly service: kplus.Service;
}

/**
 * ServiceMonitor Construct for Dovecot metrics
 *
 * Creates a Prometheus Operator ServiceMonitor that tells Prometheus
 * to scrape metrics from Dovecot's native OpenMetrics endpoint.
 *
 * Dovecot 2.3+ has built-in Prometheus support via the stats process.
 * Metrics are exposed on port 9900 at /metrics endpoint.
 *
 * Metrics exposed (configured via 10-metrics.conf):
 * - imap_command_*: IMAP operation counts and duration
 * - auth_success_total: Successful authentications
 * - auth_failures_total: Failed login attempts (brute force detection)
 * - mail_delivery_*: Message delivery events and duration
 * - Additional custom metrics can be configured via event filters
 *
 * Reference: https://doc.dovecot.org/configuration_manual/stats/openmetrics/
 */
export class DovecotServiceMonitorConstruct extends Construct {
  public readonly serviceMonitor: monitoring.ServiceMonitor;

  constructor(scope: Construct, id: string, props: DovecotServiceMonitorConstructProps) {
    super(scope, id);

    const { namespace } = props;

    // Create ServiceMonitor for Dovecot metrics
    // This tells Prometheus Operator to scrape metrics from Dovecot's native OpenMetrics endpoint
    this.serviceMonitor = new monitoring.ServiceMonitor(this, 'servicemonitor', {
      metadata: {
        name: 'mailu-dovecot',
        namespace,
        labels: {
          'app.kubernetes.io/name': 'mailu-dovecot',
          'app.kubernetes.io/component': 'dovecot',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      spec: {
        selector: {
          matchLabels: {
            'app.kubernetes.io/name': 'mailu-dovecot',
            'app.kubernetes.io/component': 'dovecot',
          },
        },
        endpoints: [
          {
            port: 'metrics', // Port 9900 from Dovecot service (native OpenMetrics)
            interval: '30s',
            path: '/metrics',
          },
        ],
      },
    });
  }
}
