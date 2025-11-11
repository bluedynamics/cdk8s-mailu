# Egress Gateway Considerations for Mail Delivery

## The Problem

Kubernetes uses the node's IP address as the source IP for outbound connections from pods. In a multi-node cluster, this means your mail server can send emails from different IP addresses depending on which node hosts the pod at any given time.

**Why this matters for email**:
- **SPF (Sender Policy Framework)** requires you to list all authorized sending IPs in DNS
- Multiple sending IPs means larger SPF records and brittle configuration
- Adding/removing nodes requires DNS updates
- Inconsistent sender IPs may hurt email reputation

## Solution Options

### Option 1: List All Node IPs in SPF

Add every node's public IP to your SPF record.

**When to use**:
- Small, stable cluster (2-3 nodes)
- Nodes rarely change
- Simple infrastructure without CNI egress features

**Trade-offs**:
- ❌ Brittle - every node change requires DNS update
- ❌ SPF records have 10 DNS lookup limit
- ❌ No consistent sender identity

### Option 2: Cilium Egress Gateway (Recommended)

Configure a dedicated egress node to route all mail traffic through a single IP.

**When to use**:
- Cluster uses Cilium CNI (1.17.0+)
- Need consistent sender IP for reputation
- Want flexibility in pod placement

**Trade-offs**:
- ✅ Single IP in SPF record
- ✅ Node changes don't affect SPF
- ✅ Consistent sender identity
- ⚠️ Requires CNI support (Cilium)
- ⚠️ Additional configuration complexity

### Option 3: LoadBalancer with Static Egress IP

Use a cloud LoadBalancer's static IP for outbound traffic.

**When to use**:
- Cloud provider supports egress via LoadBalancer
- Need high availability with automatic failover
- Budget allows for LoadBalancer costs

**Trade-offs**:
- ✅ HA with automatic failover
- ✅ Cloud-native solution
- ⚠️ Additional cost (cloud LoadBalancer)
- ⚠️ Limited provider support for egress

## IP Stability Choices

When implementing egress gateway, you can use:

### Server's Native IP
The node's assigned public IP.

**When to use**: Cost-sensitive deployments, low node turnover

**Considerations**:
- Zero additional cost
- IP changes if node is replaced
- Requires DNS update when node changes

### Floating IP
Cloud provider's reassignable static IP (e.g., Hetzner Floating IP).

**When to use**: Need to survive node replacements without DNS changes

**Considerations**:
- Additional cost (~€1-2/month)
- IP survives node replacement
- Can be reassigned to new node

## IPv6 Considerations

**Cilium egress gateway** (as of v1.17.0):
- ✅ Full support for IPv4 egress policies
- ⚠️ Limited IPv6 support - uses node's native IPv6 address

If dual-stack IPv6 is critical:
- Include node's IPv6 address in SPF record
- Configure reverse DNS (PTR) for IPv6 address
- Monitor Cilium roadmap for IPv6 egress gateway support

## Reverse DNS (PTR Records)

Email servers check that your sending IP resolves to your mail server hostname.

**Requirements**:
- PTR record: `your-ip` → `mail.example.com`
- Forward DNS: `mail.example.com` → `your-ip`
- Matches HELO hostname in SMTP

**Configuration**: Set in cloud provider console (e.g., Hetzner: Servers → Networking → Reverse DNS)

## The cdk8s-mailu Library

This library generates Kubernetes manifests for Mailu but **does not configure egress routing** - that's a cluster-level networking concern.

**What this library provides**:
- Pod manifests for all Mailu components
- Service definitions for internal routing
- Configuration for TLS, storage, databases

**What you must configure separately**:
- Egress gateway (via Cilium, CNI, or cloud provider)
- DNS SPF records authorizing sending IPs
- PTR (reverse DNS) records
- LoadBalancer or Ingress for inbound traffic

## Implementation Examples

For complete implementation guides, see your deployment's documentation:

- **kup6s deployment**: Uses Cilium egress gateway with server native IP
  - [How-to: Configure Egress Gateway](https://docs.kup6s.com/deployments/mailu/how-to/configure-egress-gateway.html)
  - [Explanation: Egress Gateway for SPF Compliance](https://docs.kup6s.com/deployments/mailu/explanation/egress-gateway-spf-compliance.html)

## See Also

- [SPF Record Syntax (RFC 7208)](https://www.rfc-editor.org/rfc/rfc7208.html)
- [Cilium Egress Gateway Documentation](https://docs.cilium.io/en/stable/network/egress-gateway/)
- [Mailu Documentation - DNS Configuration](https://mailu.io/master/dns.html)
