import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';

export interface DovecotOverrideConfigMapProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
}

/**
 * Dovecot Override ConfigMap
 *
 * Provides an override configuration file for dovecot proxy settings in the front container.
 * This fixes the submission_relay_port to use port 25 (postfix) instead of the default 10025.
 */
export class DovecotOverrideConfigMap extends Construct {
  public readonly configMap: kplus.ConfigMap;

  constructor(scope: Construct, id: string, props: DovecotOverrideConfigMapProps) {
    super(scope, id);

    const { namespace } = props;

    // Create override configuration for dovecot submission relay
    const dovecotOverrideConfig = `# Dovecot proxy override configuration
# This file is mounted at /overrides/dovecot/proxy.conf

# Override submission_relay_port to use port 25 (postfix SMTP) instead of 10025
# Dovecot submission service on front:10025 accepts webmail connections with token auth,
# then proxies to postfix:25 for actual mail delivery
submission_relay_port = 25
`;

    this.configMap = new kplus.ConfigMap(this, 'configmap', {
      metadata: {
        namespace: namespace.name,
      },
      data: {
        'proxy.conf': dovecotOverrideConfig,
      },
    });
  }
}
