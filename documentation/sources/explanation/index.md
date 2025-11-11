```{image} ../_static/kup6s-icon-explanation.svg
:align: center
:class: section-icon-large
```

# Explanation

**Understanding-oriented discussion of concepts, architecture, and design decisions.**

Explanation guides clarify and illuminate particular topics. They broaden the understanding of cdk8s-mailu and help you make informed decisions about how to use it.

## Architecture & Concepts

```{toctree}
---
maxdepth: 1
titlesonly: true
---
architecture
authentication-flows
nginx-configuration-patches
storage-architecture
dovecot-submission
egress-gateway-considerations
cdk8s-patterns
```

## Key Topics

*This section explains:*
- Mailu architecture and component relationships
- Authentication mechanisms (nginx auth_http, SSO, network trust)
- Nginx configuration patching for Traefik TLS termination
- Storage architecture and sizing for mail data
- CDK8S construct patterns and best practices
- Dovecot submission service for webmail sending
- Egress gateway considerations for consistent sender IPs

*Future topics:*
- Security considerations
- Scaling and high availability considerations

## Design Decisions

*This section will document:*
- Why certain defaults were chosen
- Trade-offs in configuration approaches
- Integration strategies with external services
- Testing philosophy

---

**Ready to get started?** Jump into the [Tutorials](../tutorials/index.md) for hands-on lessons.

**Need to solve a problem?** See the [How-To Guides](../how-to/index.md) for task-oriented solutions.

**Looking for specifications?** Check the [Reference](../reference/index.md) section for API documentation.
