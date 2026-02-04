import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';

export interface UnboundConfigMapProps {
  readonly namespace: kplus.Namespace;
  /**
   * Kube-DNS ClusterIP for forwarding .cluster.local queries
   * @default "10.43.0.10"
   */
  readonly kubeDnsIp?: string;
}

/**
 * ConfigMap containing Unbound DNS resolver configuration
 *
 * Provides recursive DNS resolution optimized for rspamd RBL lookups.
 * RBL providers like Spamhaus block public DNS resolvers (Cloudflare, Google)
 * because they anonymize the query source. A local recursive resolver sends
 * queries directly to authoritative servers, avoiding this problem.
 *
 * Key configuration:
 * - Recursive resolution (not forwarding to public DNS)
 * - .cluster.local forwarded to kube-dns for K8s service discovery
 * - private-domain settings to allow RBL 127.0.0.x responses
 * - QNAME minimization disabled (Spamhaus recommendation)
 */
export class UnboundConfigMap extends Construct {
  public readonly configMap: kplus.ConfigMap;

  constructor(scope: Construct, id: string, props: UnboundConfigMapProps) {
    super(scope, id);

    const kubeDnsIp = props.kubeDnsIp || '10.43.0.10';

    const unboundConf = `# Unbound DNS resolver for rspamd RBL lookups
# Provides recursive DNS resolution so RBL providers accept our queries
server:
    interface: 0.0.0.0
    port: 53
    do-tcp: yes
    do-udp: yes

    # Allow localhost (rspamd container) and pod network (kubelet health probes)
    access-control: 0.0.0.0/0 refuse
    access-control: 127.0.0.0/8 allow
    access-control: 10.42.0.0/16 allow

    # Disable QNAME minimization (recommended by Spamhaus)
    qname-minimisation: no

    # Allow private IP responses from RBL domains
    # RBL servers return 127.0.0.x addresses to indicate spam categories
    private-domain: "zen.spamhaus.org"
    private-domain: "sbl.spamhaus.org"
    private-domain: "xbl.spamhaus.org"
    private-domain: "pbl.spamhaus.org"
    private-domain: "dbl.spamhaus.org"
    private-domain: "swl.spamhaus.org"
    private-domain: "multi.surbl.org"
    private-domain: "bl.spamcop.net"
    private-domain: "dnsbl.sorbs.net"
    private-domain: "ix.dnsbl.manitu.net"
    private-domain: "b.barracudacentral.org"

    # Bypass DNSSEC validation for RBL zones (127.0.0.x responses)
    domain-insecure: "zen.spamhaus.org"
    domain-insecure: "sbl.spamhaus.org"
    domain-insecure: "xbl.spamhaus.org"
    domain-insecure: "pbl.spamhaus.org"
    domain-insecure: "dbl.spamhaus.org"
    domain-insecure: "swl.spamhaus.org"
    domain-insecure: "multi.surbl.org"
    domain-insecure: "bl.spamcop.net"
    domain-insecure: "dnsbl.sorbs.net"
    domain-insecure: "ix.dnsbl.manitu.net"
    domain-insecure: "b.barracudacentral.org"

    # Lightweight sidecar profile
    num-threads: 1
    msg-cache-size: 4m
    rrset-cache-size: 8m

    cache-min-ttl: 60
    cache-max-ttl: 86400

    verbosity: 1
    logfile: ""
    use-syslog: no
    log-queries: no

# Forward .cluster.local queries to kube-dns
forward-zone:
    name: "cluster.local."
    forward-addr: ${kubeDnsIp}

# Forward reverse DNS for pod network to kube-dns
forward-zone:
    name: "in-addr.arpa."
    forward-addr: ${kubeDnsIp}

forward-zone:
    name: "ip6.arpa."
    forward-addr: ${kubeDnsIp}
`;

    this.configMap = new kplus.ConfigMap(this, 'configmap', {
      metadata: {
        namespace: props.namespace.name,
        labels: {
          'app.kubernetes.io/name': 'mailu-unbound',
          'app.kubernetes.io/component': 'dns',
          'app.kubernetes.io/part-of': 'mailu',
        },
      },
      data: {
        'unbound.conf': unboundConf,
      },
    });
  }
}
