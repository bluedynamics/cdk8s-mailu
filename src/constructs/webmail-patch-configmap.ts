import * as kplus from 'cdk8s-plus-33';
import { Construct } from 'constructs';

export interface WebmailPatchConfigMapProps {
  readonly namespace: kplus.Namespace;
}

/**
 * ConfigMap with wrapper script to patch Roundcube config for direct backend connections
 *
 * This solves the issue where Mailu's Roundcube template hardcodes FRONT_ADDRESS for IMAP/SMTP,
 * but TLS_FLAVOR=notls doesn't expose the internal ports (10143, 10025) on the front service.
 *
 * The wrapper script:
 * 1. Runs Mailu's start.py to generate Roundcube config
 * 2. Patches the generated config to use direct backend connections (imap:143, smtp:25)
 * 3. Continues normal startup
 */
export class WebmailPatchConfigMap extends Construct {
  public readonly configMap: kplus.ConfigMap;

  constructor(scope: Construct, id: string, props: WebmailPatchConfigMapProps) {
    super(scope, id);

    const wrapperScript = `#!/bin/sh
# Mailu Webmail wrapper script with Roundcube config patch
# Starts services in background, waits for config, patches it, then reloads nginx

set -e

echo "Starting Mailu Webmail with backend connection patch..."

RC_CONFIG="/var/www/roundcube/config/config.inc.php"

# Step 1: Start services in background via start.py
echo "Starting Roundcube services in background..."
python3 /start.py &
START_PY_PID=$!

# Step 2: Wait for config file to be generated (max 60 seconds)
echo "Waiting for Roundcube config generation..."
WAIT_COUNT=0
while [ ! -f "$RC_CONFIG" ] && [ $WAIT_COUNT -lt 60 ]; do
  sleep 1
  WAIT_COUNT=$((WAIT_COUNT + 1))
done

if [ ! -f "$RC_CONFIG" ]; then
  echo "ERROR: $RC_CONFIG not found after 60 seconds"
  exit 1
fi

# Give it one more second to finish writing
sleep 1

# Step 3: Patch Roundcube config to use direct backend connections
echo "Patching Roundcube config for direct IMAP/SMTP connections..."

# Use actual CDK8S-generated service names from environment
IMAP_HOST="\${IMAP_ADDRESS:-imap}"
SUBMISSION_HOST="\${SUBMISSION_ADDRESS:-dovecot-submission}"

# Patch IMAP host: Change FRONT_ADDRESS:10143 to actual dovecot service:143
# Use plaintext imap:// for internal connections (TLS_FLAVOR=notls)
echo "  - Patching IMAP host to \${IMAP_HOST}:143 (plaintext for internal cluster)..."
sed -i "s|tls://[^:]*:10143|imap://\${IMAP_HOST}:143|g" "$RC_CONFIG"

# Patch SMTP host: Use SUBMISSION_ADDRESS:10025 (dedicated dovecot submission service with token auth)
# Use plaintext smtp:// for internal connections (TLS_FLAVOR=notls)
# Port 10025 is the internal submission port that accepts token authentication from webmail
echo "  - Patching SMTP host to \${SUBMISSION_HOST}:10025 (plaintext submission with token auth)..."
sed -i "s|tls://[^:]*:10025|smtp://\${SUBMISSION_HOST}:10025|g" "$RC_CONFIG"

# Patch ManageSieve host: Change FRONT_ADDRESS:14190 to actual dovecot service:4190
# Use plaintext sieve:// for internal connections (TLS_FLAVOR=notls)
echo "  - Patching ManageSieve host to \${IMAP_HOST}:4190 (plaintext for internal cluster)..."
sed -i "s|tls://[^:]*:14190|sieve://\${IMAP_HOST}:4190|g" "$RC_CONFIG"

# Verify patches
echo "Verifying patches..."
if grep -q "imap://\${IMAP_HOST}:143" "$RC_CONFIG" && grep -q "smtp://\${SUBMISSION_HOST}:10025" "$RC_CONFIG"; then
  echo "Patch verification: OK - Config patched successfully"
  echo "IMAP: \$(grep 'imap_host' \$RC_CONFIG)"
  echo "SMTP: \$(grep 'smtp_host' \$RC_CONFIG)"
else
  echo "WARNING: Patches may not have been applied correctly"
  grep 'imap_host\|smtp_host' "$RC_CONFIG"
fi

# Step 4: Wait for nginx to start (check for pid file)
echo "Waiting for nginx to start..."
NGINX_WAIT=0
while [ ! -f "/var/run/nginx.pid" ] && [ $NGINX_WAIT -lt 30 ]; do
  sleep 1
  NGINX_WAIT=$((NGINX_WAIT + 1))
done

if [ -f "/var/run/nginx.pid" ]; then
  # Reload nginx to pick up patched config
  echo "Reloading nginx with patched configuration..."
  nginx -s reload
  echo "Nginx reloaded successfully"
else
  echo "WARNING: nginx pid file not found, configuration may not be active yet"
fi

echo "Webmail startup complete - monitoring start.py process"

# Wait for start.py process (keeps container running)
wait \$START_PY_PID
`;

    this.configMap = new kplus.ConfigMap(this, 'configmap', {
      metadata: {
        namespace: props.namespace.name,
      },
      data: {
        'entrypoint-wrapper.sh': wrapperScript,
      },
    });
  }
}
