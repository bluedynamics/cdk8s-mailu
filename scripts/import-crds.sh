#!/bin/bash
#
# Import CRDs for Traefik and Prometheus Operator
#
# This script regenerates TypeScript types from CRD YAML files.
# Run this script when:
# - Updating to a new Traefik version
# - Updating to a new Prometheus Operator version
# - Adding new CRDs

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "🔄 Importing CRDs..."

# Import Kubernetes core types
echo "  ↳ Kubernetes core API"
npx cdk8s import k8s

# Import Traefik CRDs
echo "  ↳ Traefik CRDs"
npx cdk8s import crds/traefik-crds.yaml

# Import Prometheus Operator ServiceMonitor CRD
echo "  ↳ Prometheus Operator ServiceMonitor CRD"
npx cdk8s import crds/prometheus-servicemonitor-crd.yaml

echo "✅ CRD imports completed successfully!"
echo ""
echo "Generated TypeScript types in src/imports/:"
ls -lh src/imports/*.ts | awk '{print "  - " $9 " (" $5 ")"}'
echo ""
echo "📝 Don't forget to commit the updated imports to git!"
