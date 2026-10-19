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

### Additional RBL (`rbl.conf`, `groups.conf`)

Adds the Barracuda RBL as `RBL_BARRACUDA` with a score of 2.0.
Spamhaus ZEN and DBL and the other rspamd default RBLs stay active without an override.

### Fuzzy scores (`metrics.conf`)

Restores the scores of the rspamd.com fuzzy symbols (`FUZZY_DENIED` 12, `FUZZY_PROB` 5, `FUZZY_WHITE` -2.1), which Mailu's own `metrics.conf` drops.

### Spam diagnosis header (`milter_headers.conf`)

Adds `X-Spamd-Result` to every scanned message.
Read it in the headers of a missed spam message to see which symbols fired.

### Bayes learning

The Bayes classifier uses Mailu's defaults.
It stores its data in Redis, so give Redis persistent storage.
Bayes adds no score until it has learned 200 spam and 200 ham messages.
Moving a message into the Junk folder learns it as spam.

```{warning}
Do not add a `classifier-bayes.conf` or `fuzzy_check.conf` override.
Mailu merges these with its own files, turns repeated keys into arrays, and breaks Bayes autolearning.
See [Rspamd Architecture](../explanation/rspamd-architecture.md) for details.
```

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
