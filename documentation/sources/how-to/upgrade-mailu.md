# Upgrade Mailu Version

**How to upgrade Mailu to a newer version safely.**

## Problem

You need to upgrade your Mailu deployment to a newer version to get security fixes, new features, or bug fixes.

## Solution

Update the image tag in your `MailuChart` configuration, regenerate manifests, and apply with proper backup and testing procedures.

## Before You Start

**Critical prerequisites**:
1. ✅ **Backup all data** (see [Backup and Restore](backup-restore.md))
2. ✅ **Review Mailu release notes** for breaking changes
3. ✅ **Test in non-production environment** first
4. ✅ **Schedule maintenance window** for production upgrades
5. ✅ **Document current version** for potential rollback

## Check Current Version

Identify your current Mailu version:

```bash
# Check image version in running pods
kubectl get pods -n mailu -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'

# Example output:
# mailu-admin-xxx    ghcr.io/mailu/admin:2024.06
# mailu-front-xxx    ghcr.io/mailu/nginx:2024.06
```

## Review Release Notes

Check [Mailu releases](https://github.com/Mailu/Mailu/releases) for:
- **Breaking changes** (configuration, database migrations)
- **New features** (optional components, configuration options)
- **Bug fixes** (relevant to your deployment)
- **Upgrade notes** (special procedures)

**Common breaking changes to watch for**:
- Database schema migrations
- Configuration file format changes
- Removed/renamed environment variables
- Component version incompatibilities

## Upgrade Procedure

### Step 1: Backup Everything

**Before making any changes**, create backups:

```bash
# Backup database
kubectl exec -n postgres postgres-1 -- pg_dump -U postgres mailu > mailu-db-backup-$(date +%Y%m%d).sql

# Backup PVCs (using Longhorn or your backup solution)
# See backup-restore.md for detailed procedures
```

### Step 2: Update Image Version

Edit your CDK8S configuration to specify the new version:

```typescript
import { App } from 'cdk8s';
import { MailuChart } from 'cdk8s-mailu';

const app = new App();

new MailuChart(app, 'mailu', {
  namespace: 'mailu',
  domain: 'example.com',
  hostnames: ['mail.example.com'],
  subnet: '10.42.0.0/16',

  // ... other config ...

  images: {
    registry: 'ghcr.io/mailu',
    tag: '2025.01',  // Updated from 2024.06
    pullPolicy: 'IfNotPresent',
  },
});

app.synth();
```

**Version selection**:
- **Stable releases**: Use tagged versions (e.g., `2024.06`, `2025.01`)
- **Latest stable**: Use `latest` tag (not recommended for production)
- **Testing**: Use `master` tag (pre-release, unstable)

### Step 3: Regenerate Manifests

```bash
# Compile and synthesize with new version
npm run build

# Review changes in generated manifests
git diff dist/mailu.k8s.yaml

# Look for image version changes
grep "image:" dist/mailu.k8s.yaml
```

### Step 4: Apply Upgrade (Rolling Update)

Apply the updated manifests using kubectl:

```bash
# Apply changes (triggers rolling update)
kubectl apply -f dist/mailu.k8s.yaml

# Watch rollout status
kubectl rollout status deployment -n mailu mailu-admin
kubectl rollout status deployment -n mailu mailu-front
kubectl rollout status deployment -n mailu mailu-postfix
kubectl rollout status deployment -n mailu mailu-dovecot
kubectl rollout status deployment -n mailu mailu-rspamd

# Watch pods restart with new images
kubectl get pods -n mailu -w
```

**Rolling update behavior**:
- Pods restart one at a time (high availability maintained)
- Old pods remain running until new pods are ready
- Database migrations run automatically on admin pod startup

### Step 5: Verify Upgrade

Check that all pods are running the new version:

```bash
# Verify image versions
kubectl get pods -n mailu -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}'

# Check pod status (all should be Running)
kubectl get pods -n mailu

# Check admin pod logs for migration messages
kubectl logs -n mailu -l app.kubernetes.io/component=admin | grep -i migration

# Test basic functionality
curl -I https://mail.example.com/admin  # Should return 200 OK
```

### Step 6: Test Functionality

Perform smoke tests after upgrade:

**Admin UI**:
- [ ] Login to admin interface: `https://mail.example.com/admin`
- [ ] Check user list loads
- [ ] Verify domain settings

**Webmail**:
- [ ] Login to webmail: `https://mail.example.com/webmail`
- [ ] Send test email
- [ ] Receive test email

**Mail Protocols**:
```bash
# Test SMTP (send mail)
telnet mail.example.com 587

# Test IMAP (check mailbox)
openssl s_client -connect mail.example.com:993
```

## Upgrade Patterns

### Minor Version Upgrade (Same Year)

Example: `2024.06` → `2024.12`

**Risk**: Low (usually bug fixes and minor features)

**Procedure**: Standard rolling update (steps above)

### Major Version Upgrade (Year Change)

Example: `2024.06` → `2025.01`

**Risk**: Medium (potential breaking changes)

**Additional steps**:
1. Review migration guide in release notes
2. Test in staging environment first
3. Plan for longer maintenance window
4. Have rollback plan ready

### Multi-Version Jump

Example: `2023.10` → `2025.01` (skipping versions)

**Risk**: High (multiple breaking changes possible)

**Recommended approach**:
1. **Don't skip major versions** - upgrade incrementally
2. Test each intermediate version in staging
3. Read all release notes between versions
4. Budget extra time for troubleshooting

**Safer path**: `2023.10` → `2024.06` → `2024.12` → `2025.01`

## Rollback Procedure

If the upgrade fails or causes issues, rollback to the previous version:

### Quick Rollback (Image Version Only)

```bash
# Revert to previous image version in CDK8S config
# images.tag: '2024.06'  # Back to previous version

# Regenerate and apply
npm run build
kubectl apply -f dist/mailu.k8s.yaml

# Force restart pods with old version
kubectl rollout restart deployment -n mailu mailu-admin
kubectl rollout restart deployment -n mailu mailu-front
# ... restart other components
```

### Full Rollback (Database Restore)

If database migrations caused problems:

```bash
# Stop Mailu pods
kubectl scale deployment -n mailu --all --replicas=0

# Restore database from backup
kubectl exec -n postgres postgres-1 -- psql -U postgres mailu < mailu-db-backup-YYYYMMDD.sql

# Restore PVCs if needed (see backup-restore.md)

# Start pods with old version
kubectl scale deployment -n mailu --all --replicas=1
```

## Automated Upgrade Testing

Create a test script to validate upgrades:

```bash
#!/bin/bash
set -e

NAMESPACE="mailu"
DOMAIN="mail.example.com"

echo "Testing Mailu deployment after upgrade..."

# Test 1: All pods running
echo "Checking pod status..."
kubectl wait --for=condition=ready pod -n $NAMESPACE -l app.kubernetes.io/part-of=mailu --timeout=300s

# Test 2: Admin UI accessible
echo "Testing admin UI..."
curl -f -s https://$DOMAIN/admin | grep -q "Mailu" || { echo "Admin UI test failed"; exit 1; }

# Test 3: Database connection
echo "Testing database connection..."
kubectl exec -n $NAMESPACE -l app.kubernetes.io/component=admin -- python3 -c "
from mailu import db
db.init_app()
print('Database connection: OK')
" || { echo "Database test failed"; exit 1; }

# Test 4: SMTP connectivity
echo "Testing SMTP..."
timeout 5 bash -c "echo 'QUIT' | openssl s_client -connect $DOMAIN:587 -starttls smtp 2>&1" | grep -q "250 HELP" || { echo "SMTP test failed"; exit 1; }

echo "All tests passed!"
```

Save as `test-upgrade.sh` and run after applying upgrade.

## Troubleshooting

### Pods stuck in ImagePullBackOff

**Symptom**: New pods cannot pull image.

**Causes**:
- Invalid image tag (version doesn't exist)
- Registry authentication issues
- Network connectivity problems

```bash
# Check image availability
docker pull ghcr.io/mailu/admin:2025.01

# Check pod events
kubectl describe pod -n mailu <pod-name> | grep -A 10 Events
```

**Solution**: Verify image tag exists at [ghcr.io/mailu](https://github.com/orgs/Mailu/packages).

### Database migration failures

**Symptom**: Admin pod CrashLoopBackOff with migration errors in logs.

```bash
# Check admin pod logs
kubectl logs -n mailu -l app.kubernetes.io/component=admin | grep -i error
```

**Solution**:
1. Check [Mailu migration documentation](https://mailu.io/master/migrate.html)
2. May require manual migration steps
3. Rollback and test in staging first

### Version mismatch between components

**Symptom**: Components unable to communicate, inconsistent behavior.

**Cause**: Not all pods updated to new version (partial rollout).

```bash
# Check versions across all pods
kubectl get pods -n mailu -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[0].image}{"\n"}{end}' | sort -u
```

**Solution**: Force restart all deployments:
```bash
kubectl rollout restart deployment -n mailu --all
```

### Performance degradation after upgrade

**Symptom**: Slower response times, higher resource usage.

**Investigation**:
```bash
# Check resource usage
kubectl top pods -n mailu

# Check logs for errors
kubectl logs -n mailu -l app.kubernetes.io/part-of=mailu --tail=100
```

**Solutions**:
- Adjust resource limits (see [Scale Resources](scale-resources.md))
- Review new configuration options in release notes
- Check for new default settings affecting performance

## Upgrade Checklist

Use this checklist for production upgrades:

**Pre-Upgrade**:
- [ ] Review Mailu release notes
- [ ] Backup database (pg_dump)
- [ ] Backup all PVCs
- [ ] Document current version
- [ ] Test upgrade in staging
- [ ] Schedule maintenance window
- [ ] Notify users of downtime

**Upgrade**:
- [ ] Update CDK8S configuration
- [ ] Regenerate manifests
- [ ] Review manifest diff
- [ ] Apply manifests
- [ ] Monitor pod rollout
- [ ] Check admin pod logs for migrations

**Post-Upgrade**:
- [ ] Verify all pods running
- [ ] Test admin UI
- [ ] Test webmail
- [ ] Test SMTP/IMAP
- [ ] Check logs for errors
- [ ] Monitor performance
- [ ] Document new version
- [ ] Notify users of completion

## See Also

- [Backup and Restore](backup-restore.md) - Critical for safe upgrades
- [Component Specifications](../reference/component-specifications.md) - Version compatibility
- [Mailu Documentation](https://mailu.io/) - Official upgrade guides
- [Scale Resources](scale-resources.md) - Adjust resources after upgrade
