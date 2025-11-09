import { Duration } from 'cdk8s';
import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';
import { MailuChartConfig } from '../config';
import { parseMemorySize, parseCpuMillis } from '../utils/resource-parser';

export interface FetchmailConstructProps {
  readonly config: MailuChartConfig;
  readonly namespace: kplus.Namespace;
  readonly sharedConfigMap: kplus.ConfigMap;
}

/**
 * Fetchmail Construct - External email account fetching
 *
 * The Fetchmail component provides:
 * - Polling of external email accounts (POP3/IMAP)
 * - Delivery of fetched emails to local mailboxes
 * - Scheduled fetching at configurable intervals
 * - Support for multiple external accounts per user
 *
 * Components:
 * - Deployment (fetchmail daemon)
 * - No persistent storage required (stateless)
 * - No service required (internal component)
 */
export class FetchmailConstruct extends Construct {
  public readonly deployment: kplus.Deployment;

  constructor(scope: Construct, id: string, props: FetchmailConstructProps) {
    super(scope, id);

    const { config, namespace, sharedConfigMap } = props;

    // Create Deployment
    this.deployment = new kplus.Deployment(this, 'deployment', {
      metadata: {
        namespace: namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-fetchmail',
          'app.kubernetes.io/component': 'fetchmail',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      replicas: 1,
      podMetadata: {
        labels: {
          'app.kubernetes.io/name': 'mailu-fetchmail',
          'app.kubernetes.io/component': 'fetchmail',
        },
      },
      securityContext: {
        // Mailu containers run as root for privileged operations
        ensureNonRoot: false,
      },
    });

    // Configure container
    const container = this.deployment.addContainer({
      name: 'fetchmail',
      image: `${config.images?.registry || 'ghcr.io/mailu'}/fetchmail:${config.images?.tag || '2024.06'}`,
      imagePullPolicy: kplus.ImagePullPolicy.IF_NOT_PRESENT,
      securityContext: {
        ensureNonRoot: false,
        readOnlyRootFilesystem: false,
      },
      resources: config.resources?.fetchmail
        ? {
          cpu: {
            request: parseCpuMillis(config.resources.fetchmail.requests?.cpu || '100m'),
            limit: config.resources.fetchmail.limits?.cpu
              ? parseCpuMillis(config.resources.fetchmail.limits.cpu)
              : undefined,
          },
          memory: {
            request: parseMemorySize(config.resources.fetchmail.requests?.memory || '256Mi'),
            limit: config.resources.fetchmail.limits?.memory
              ? parseMemorySize(config.resources.fetchmail.limits.memory)
              : undefined,
          },
        }
        : undefined,
      // Liveness probe - check if process is running
      liveness: kplus.Probe.fromCommand(
        ['pgrep', '-f', 'fetchmail'],
        {
          initialDelaySeconds: Duration.seconds(30),
          periodSeconds: Duration.seconds(60),
          timeoutSeconds: Duration.seconds(5),
          failureThreshold: 3,
        },
      ),
      // Readiness probe - same as liveness for fetchmail
      readiness: kplus.Probe.fromCommand(
        ['pgrep', '-f', 'fetchmail'],
        {
          initialDelaySeconds: Duration.seconds(10),
          periodSeconds: Duration.seconds(10),
          timeoutSeconds: Duration.seconds(3),
          failureThreshold: 3,
        },
      ),
    });

    // Add environment variables from shared ConfigMap
    container.env.copyFrom(kplus.Env.fromConfigMap(sharedConfigMap));

    // Environment variables specific to fetchmail
    container.env.addVariable('FETCHMAIL_DELAY', kplus.EnvValue.fromValue('600')); // Fetch every 10 minutes
  }
}
