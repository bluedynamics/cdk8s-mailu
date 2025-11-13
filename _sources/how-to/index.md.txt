```{image} ../_static/kup6s-icon-howto.svg
:align: center
:class: section-icon-large
```

# How-To Guides

**Goal-oriented guides showing you how to solve specific problems with cdk8s-mailu.**

How-to guides are recipes that take you through the steps involved in addressing specific tasks and problems. They are more advanced than tutorials and assume you have some knowledge of how cdk8s-mailu works.

## Prerequisites

**Set up required infrastructure before deploying Mailu:**

```{toctree}
---
maxdepth: 1
titlesonly: true
---
setup-prerequisites
setup-postgresql
setup-redis
```

## Configuration

```{toctree}
---
maxdepth: 1
titlesonly: true
---
configure-construct
scale-resources
customize-storage
enable-optional-components
configure-tls
manage-secrets
```

## Operations & Maintenance

```{toctree}
---
maxdepth: 1
titlesonly: true
---
upgrade-mailu
backup-restore
```

## Troubleshooting

*This section will be populated with troubleshooting guides in future releases.*

---

**New to cdk8s-mailu?** Start with the [Tutorials](../tutorials/index.md) for step-by-step lessons.

**Need technical specifications?** See the [Reference](../reference/index.md) section for API documentation.

**Want to understand concepts?** Read the [Explanation](../explanation/index.md) section for architecture and design decisions.
