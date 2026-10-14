# Configure Spam Filtering

**Improve spam detection by configuring rspamd overrides and DNS-based blocklists.**

## Problem

The default rspamd configuration provides basic spam filtering, but does not include:
- DNS-based Real-time Blackhole Lists (RBLs) like Spamhaus
- Remote fuzzy hash checking against known spam databases
- Optimized scoring thresholds

In Kubernetes environments, RBL lookups fail because kube-dns forwards queries to public resolvers (e.g. Cloudflare, Google) which are blocked by RBL providers like Spamhaus.

## Solution Overview

cdk8s-mailu addresses this with:

1. **Unbound DNS sidecar** - A recursive DNS resolver running alongside rspamd that sends queries directly to authoritative DNS servers
2. **Rspamd configuration overrides** - Stricter thresholds, RBL lists, and remote fuzzy servers via ConfigMap

## How It Works

The `RspamdConstruct` automatically deploys:

- An **Unbound** container as a sidecar in the rspamd pod
- ConfigMaps with rspamd overrides mounted at `/overrides/`
- A DNS override (`options.inc`) pointing rspamd to `127.0.0.1:53` (Unbound)

```{mermaid}
graph LR
    A[Incoming Mail] --> B[Postfix]
    B -->|milter| C[rspamd]
    C -->|DNS queries| D[Unbound Sidecar]
    D -->|recursive| E[Spamhaus]
    D -->|recursive| F[Barracuda]
    D -->|recursive| G[Spamcop]
    D -->|forward| H[kube-dns]
    H -->|.cluster.local| I[K8s Services]
```

## DNS Configuration

The Unbound sidecar can be configured via the `dns` config option:

```yaml
dns:
  kubeDnsIp: "10.43.0.10"      # kube-dns ClusterIP (K3S default)
  unboundImage: "mvance/unbound:1.22.0"  # Pinned image version
```

### Default Behavior

Without explicit `dns` configuration, Unbound uses:
- `10.43.0.10` as kube-dns for `.cluster.local` forwarding
- Recursive resolution for all other queries (including RBL lookups)
- QNAME minimization disabled (required by Spamhaus)

## Rspamd Overrides

The following overrides are applied automatically:

### Scoring Thresholds (`actions.conf`)

```
reject = 12     # Reject messages with score >= 12 (default: 15)
add_header = 5  # Add X-Spam header at score >= 5 (default: 6)
greylist = 3    # Greylist at score >= 3 (default: 4)
```

### Bayes Auto-Learning (`classifier-bayes.conf`)

```
autolearn {
  spam_threshold = 5.0   # Learn as spam at score >= 5 (default: 6)
  ham_threshold = -1.0   # Learn as ham at score <= -1 (default: -0.5)
}
```

### Remote Fuzzy Servers (`fuzzy_check.conf`)

Checks incoming mail hashes against rspamd.com's global fuzzy database of known spam.

### RBL Blocklists (`rbl.conf`)

- **Spamhaus ZEN** (SBL + XBL + PBL) - IP-based blocklist
- **Spamhaus DBL** - Domain-based blocklist (DKIM, URLs, emails)
- **Barracuda RBL** - IP-based blocklist
- **Spamcop** - IP-based blocklist

## Troubleshooting

### RBL Lookups Not Working

Verify Unbound is running and resolving correctly:

```bash
# Check both containers are running
kubectl get pods -n mailu -l app.kubernetes.io/component=rspamd

# Test RBL resolution via Unbound
kubectl exec -n mailu deploy/rspamd -c unbound -- \
  drill @127.0.0.1 2.0.0.127.zen.spamhaus.org
```

### Too Many False Positives

If legitimate mail is being flagged:

1. Increase the `reject` threshold (e.g. to 15)
2. Lower the `greylist` threshold sensitivity
3. Check rspamd web UI for which symbols triggered

### Kubernetes DNS Still Working

Verify that `.cluster.local` resolution works through Unbound:

```bash
kubectl exec -n mailu deploy/rspamd -c rspamd -- \
  nslookup redis.mailu.svc.cluster.local 127.0.0.1
```

## See Also

- [Rspamd Architecture](../explanation/rspamd-architecture.md) - How spam filtering works
- [Component Specifications](../reference/component-specifications.md) - Rspamd technical details
- [Scale Resources](scale-resources.md) - Adjust resources for spam filtering load
