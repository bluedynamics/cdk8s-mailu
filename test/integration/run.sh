#!/usr/bin/env bash
# Runs the nginx configuration of the front against a Mailu built from the
# original images and checks what mail clients, admin, postfix and log parsers
# see of it.
#
# Usage: run.sh [--config <nginx.conf>]
#   Without --config the configuration comes from MailuChart
#   (render-front-config.ts). With --config the given file is tested, for
#   example the one a deployment renders. The test stack is built for a file
#   that trusts a network containing 10.42.203.0/24 in set_real_ip_from and
#   advertises SIZE 52428800.
# Environment:
#   MAILU_VERSION         tag of the Mailu images   (default 2024.06.72)
#   NGINX_IMAGE           image of the front        (default: the one MailuChart renders)
#   FRONT_TEST_LOG_DIR    if set, the container logs are kept there
# Needs docker with the compose plugin, python3 and node.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$here/../.." && pwd)

config=""
while [ $# -gt 0 ]; do
  case "$1" in
    --config)
      [ $# -ge 2 ] || { echo "run.sh: --config needs a file" >&2; exit 2; }
      config=$2
      shift 2
      ;;
    *)
      echo "usage: run.sh [--config <nginx.conf>]" >&2
      exit 2
      ;;
  esac
done

render() {
  (cd "$repo" && npx ts-node --project tsconfig.dev.json test/integration/render-front-config.ts "$1")
}

export MAILU_VERSION=${MAILU_VERSION:-2024.06.72}
if [ -z "${NGINX_IMAGE:-}" ]; then
  NGINX_IMAGE=$(render image)
fi
export NGINX_IMAGE

work=$(mktemp -d)
logs=${FRONT_TEST_LOG_DIR:-$work/logs}
mkdir -p "$logs"

export FRONT_TEST_CONFIG=$work/nginx.conf
export FRONT_TEST_ENV_FILE=$work/mailu.env

if [ -n "$config" ]; then
  cp "$config" "$FRONT_TEST_CONFIG"
else
  render config > "$FRONT_TEST_CONFIG"
fi
# The container reads it as user 101
chmod 644 "$FRONT_TEST_CONFIG"

# nginx resolves this name at start; in the test stack it is an alias of admin
FRONT_TEST_ADMIN_ALIAS=$(sed -nE 's|^[[:space:]]*auth_http[[:space:]]+http://([^:/;]+).*|\1|p' "$FRONT_TEST_CONFIG")
[ -n "$FRONT_TEST_ADMIN_ALIAS" ] || { echo "run.sh: no auth_http line in the configuration" >&2; exit 2; }
export FRONT_TEST_ADMIN_ALIAS

random() { python3 -c 'import secrets; print(secrets.token_hex(16))'; }
# The prefix matters: admin takes a password of exactly 32 hex digits for an
# application token and never checks it against the account password.
sed -e "s/@SECRET_KEY@/$(random)/" -e "s/@INITIAL_ADMIN_PW@/pw-$(random)/" "$here/mailu.env.template" > "$FRONT_TEST_ENV_FILE"

compose() { docker compose -f "$here/compose.yaml" "$@"; }

cleanup() {
  for service in front admin smtp imap antispam; do
    compose logs --no-log-prefix "$service" > "$logs/$service.log" 2>&1 || true
  done
  compose down -v > /dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

echo "# front: $NGINX_IMAGE, Mailu $MAILU_VERSION, admin as $FRONT_TEST_ADMIN_ALIAS"
compose up -d

failed=0
python3 "$here/mailtest.py" "$FRONT_TEST_ENV_FILE" || failed=1

for service in front admin smtp; do
  compose logs --no-log-prefix "$service" > "$logs/$service.log" 2>&1
done

check() {
  local name=$1
  shift
  if "$@"; then
    echo "ok   $name"
  else
    echo "FAIL $name"
    failed=1
  fi
}
log_has() { grep -Eq -- "$2" "$logs/$1.log"; }
log_lacks() { ! grep -Eq -- "$2" "$logs/$1.log"; }

echo
# A failed login must be logged in exactly this form: intrusion detection
# (CrowdSec, fail2ban) parses the line, and the client address must be the
# one from the PROXY header.
for port in 10465 10993 10995; do
  check "front logs the failed login on $port with the client address" log_has front \
    "^[0-9/]+ [0-9:]+ \[info\] [0-9]+#[0-9]+: \*[0-9]+ client login failed: \"[^\"]*\" while in http auth state, client: 203\.0\.113\.7, server: [^ ]+:$port, login: \"[^\"]*\"\$"
done
# admin rate-limits by client network; with the address of the front every
# client would share one bucket.
check "admin sees the client address from the PROXY header" log_has admin 'from: 203\.0\.113\.7/'
check "admin never sees an address of the stack as client" log_lacks admin 'Login attempt .* from: 10\.42\.'
# admin tells mail clients from the webmail by the port it is told. It must be
# the public port, never a port of the container.
for listener in smtp/465 imap/993 pop3/995; do
  check "admin is told the public port for $listener" log_has admin \
    "Login attempt for: [^ ]+/$listener from: 203\.0\.113\.7/"
done
check "postfix gets client address and login by XCLIENT" log_has smtp 'client=unknown\[203\.0\.113\.7\], sasl_method=XCLIENT'
check "front starts and runs without a warning" log_lacks front '\[(warn|emerg|alert|crit)\]'
check "front runs as user 101" test "$(compose exec -T front id -u)" = 101

echo
if [ "$failed" -eq 0 ]; then
  echo "integration test passed"
else
  echo "integration test FAILED"
  [ -z "${FRONT_TEST_LOG_DIR:-}" ] || echo "container logs: $logs"
fi
exit "$failed"
