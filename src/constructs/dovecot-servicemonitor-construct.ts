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
 * to scrape metrics from the Dovecot exporter sidecar.
 *
 * The Dovecot exporter reads from Dovecot's stats-reader socket and exposes
 * Prometheus metrics on port 9166.
 *
 * Metrics exposed:
 * - dovecot_up: Exporter health
 * - dovecot_auth_success_total: Successful authentications
 * - dovecot_auth_failures_total: Failed login attempts (brute force detection)
 * - dovecot_active_connections{protocol="imap|pop3"}: Active connections by protocol
 * - dovecot_mailbox_messages: Message counts per mailbox
 * - dovecot_mailbox_size_bytes: Mailbox sizes per user
 * - dovecot_disk_quota_bytes, dovecot_disk_used_bytes: Disk usage stats
 * - ~25 metrics total
 */
export class DovecotServiceMonitorConstruct extends Construct {
  public readonly serviceMonitor: monitoring.ServiceMonitor;

  constructor(scope: Construct, id: string, props: DovecotServiceMonitorConstructProps) {
    super(scope, id);

    const { namespace } = props;

    // Create ServiceMonitor for Dovecot metrics
    // This tells Prometheus Operator to scrape metrics from the Dovecot exporter sidecar
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
            port: 'metrics', // Port 9166 from Dovecot service
            interval: '30s',
            path: '/metrics',
          },
        ],
      },
    });
  }
}
