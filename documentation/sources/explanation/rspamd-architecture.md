# Rspamd Architecture

**How rspamd provides spam filtering, DKIM signing, and content analysis in the Mailu mail flow.**

## Role in Mail Flow

Rspamd integrates with Postfix via the milter protocol. Every incoming and outgoing message passes through rspamd for analysis before delivery.

```{mermaid}
sequenceDiagram
    participant S as Sending MTA
    participant P as Postfix
    participant R as rspamd
    participant U as Unbound DNS
    participant D as Dovecot

    S->>P: SMTP delivery (port 25)
    P->>R: milter check (port 11332)
    R->>U: RBL/SPF/DKIM DNS queries
    U-->>R: DNS responses
    R-->>P: accept / reject / greylist
    P->>D: LMTP delivery (port 2525)
```

## Spam Detection Layers

Rspamd uses multiple detection methods in parallel:

### 1. DNS-Based Blocklists (RBLs)

RBL providers maintain lists of known spam-sending IP addresses and domains. Rspamd queries these via DNS. A positive response (e.g. `127.0.0.2` from Spamhaus) adds score to the message.

**Configured RBLs:**
- Spamhaus ZEN (SBL + XBL + PBL)
- Spamhaus DBL (domain-based)
- Barracuda RBL
- Spamcop

### 2. Bayesian Classification

Statistical analysis of message content. Rspamd learns from previous spam and ham (legitimate mail) to classify new messages.

- **Auto-learning**: Messages above spam threshold are automatically learned as spam, below ham threshold as ham
- **Storage**: Bayes database persisted in `/var/lib/rspamd` PVC

### 3. Fuzzy Hashing

Compares message content hashes against databases of known spam:

- **Local fuzzy storage**: Learns from locally identified spam (port 11333)
- **Remote fuzzy servers**: rspamd.com maintains a global fuzzy database with known spam hashes

### 4. Protocol Checks

- **SPF**: Sender Policy Framework verification
- **DKIM**: DomainKeys Identified Mail signature verification
- **DMARC**: Domain-based Message Authentication policy enforcement
- **ARC**: Authenticated Received Chain for forwarded messages

### 5. Scoring System

Each check adds or subtracts from a message score. Actions are taken based on thresholds:

| Threshold | Score | Action |
|-----------|-------|--------|
| Greylist | >= 3 | Temporary rejection (legitimate servers retry) |
| Add Header | >= 5 | Mark as spam via X-Spam header |
| Reject | >= 12 | Permanent rejection |

## Unbound DNS Sidecar

RBL providers like Spamhaus block queries from public DNS resolvers (Cloudflare, Google) because they anonymize the query source and prevent rate limiting.

The solution is a dedicated recursive DNS resolver (Unbound) running as a sidecar container in the rspamd pod:

```{mermaid}
graph TB
    subgraph "rspamd Pod"
        R[rspamd container<br/>port 11332-11334]
        U[Unbound container<br/>port 53]
        R -->|DNS queries<br/>127.0.0.1:53| U
    end

    U -->|recursive queries| RBL[RBL Providers<br/>Spamhaus, Barracuda, etc.]
    U -->|forward .cluster.local| KD[kube-dns<br/>10.43.0.10]
```

Key Unbound configuration:

- **Recursive resolution**: Queries go directly to authoritative DNS servers, not public resolvers
- **Kubernetes integration**: `.cluster.local` queries forwarded to kube-dns for service discovery
- **RBL compatibility**: `private-domain` settings allow 127.0.0.x responses from RBL zones
- **QNAME minimization disabled**: Required by Spamhaus for correct query handling

## Storage Architecture

Rspamd persists learned data in a 5Gi PVC:

- **Bayes database**: Statistical model trained on spam/ham samples
- **Fuzzy hashes**: Local fuzzy hash database
- **Statistics**: Historical processing data

This data survives pod restarts and is critical for maintaining spam detection accuracy over time.

## Web Interface

Rspamd provides an HTTP API and web UI on port 11334 for:

- Viewing message processing history
- Checking symbol scores and triggered rules
- Monitoring throughput statistics
- Manual spam/ham learning

Access is protected by Traefik ForwardAuth middleware (Mailu admin authentication).

## See Also

- [Configure Spam Filtering](../how-to/configure-spam-filtering.md) - Setup guide for spam filter improvements
- [Component Specifications](../reference/component-specifications.md) - Rspamd ports and resources
