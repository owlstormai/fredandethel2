#!/usr/bin/env bash
# Fails if any secret-looking string is present in the client bundles.
# Run after `next build`. Usage: scripts/check-secrets.sh [.next dir]
set -euo pipefail
DIST="${1:-.next}"
if [ ! -d "$DIST/static" ]; then
  echo "no $DIST/static directory — run next build first" >&2
  exit 2
fi
PATTERNS=(
  'sk-[A-Za-z0-9_-]\{20,\}'
  'postgres\(ql\)\?://'
  'AUTH_SECRET='
  'OPENAI_API_KEY='
  'local-dev-only-secret'
  'test-secret-0123456789abcdef'
)
status=0
for p in "${PATTERNS[@]}"; do
  if grep -rIl -e "$p" "$DIST/static" >/dev/null 2>&1; then
    echo "FAIL: pattern '$p' found in client bundle:" >&2
    grep -rIl -e "$p" "$DIST/static" >&2 || true
    status=1
  fi
done
# Server env values must not leak either: check the literal values from the environment.
for var in OPENAI_API_KEY DATABASE_URL AUTH_SECRET; do
  val="${!var:-}"
  if [ -n "$val" ] && [ "${#val}" -ge 12 ] && grep -rIlF -- "$val" "$DIST/static" >/dev/null 2>&1; then
    echo "FAIL: value of $var found in client bundle" >&2
    status=1
  fi
done
if [ $status -eq 0 ]; then echo "PASS: no secrets found in $DIST/static"; fi
exit $status
