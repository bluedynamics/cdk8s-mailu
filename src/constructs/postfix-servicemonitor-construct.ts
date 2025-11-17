import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import * as monitoring from '../imports/monitoring.coreos.com';

export interface PostfixServiceMonitorConstructProps {
  readonly namespace: string;
  readonly service: kplus.Service;
}

/**
 * ServiceMonitor Construct for Postfix metrics
 *
 * Creates a Prometheus Operator ServiceMonitor that tells Prometheus
 * to scrape metrics from the Postfix exporter sidecar.
 *
 * Metrics exposed:
 * - postfix_queue_size: Number of messages in mail queue
 * - postfix_up: Whether Postfix is running
 * - Additional Postfix metrics from kumina/postfix-exporter
 */
export class PostfixServiceMonitorConstruct extends Construct {
  public readonly serviceMonitor: monitoring.ServiceMonitor;

  constructor(scope: Construct, id: string, props: PostfixServiceMonitorConstructProps) {
    super(scope, id);

    const { namespace } = props;

    // Create ServiceMonitor for Postfix metrics
    // This tells Prometheus Operator to scrape metrics from the Postfix exporter
    this.serviceMonitor = new monitoring.ServiceMonitor(this, 'servicemonitor', {
      metadata: {
        name: 'mailu-postfix',
        namespace,
        labels: {
          'app.kubernetes.io/name': 'mailu-postfix',
          'app.kubernetes.io/component': 'postfix',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      spec: {
        selector: {
          matchLabels: {
            'app.kubernetes.io/name': 'mailu-postfix',
            'app.kubernetes.io/component': 'postfix',
          },
        },
        endpoints: [
          {
            port: 'metrics',
            interval: '30s',
            path: '/metrics',
          },
        ],
      },
    });
  }
}
