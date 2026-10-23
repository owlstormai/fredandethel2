#!/usr/bin/env bash
# Deploy Companion to Vercel with a Supabase (or any) Postgres.
# Requires: VERCEL_TOKEN, DATABASE_URL (production DB).
# Optional: OPENAI_API_KEY (if absent, the value already stored in Vercel is left untouched),
#           AUTH_SECRET (generated if absent), COMPANION_ENABLE_DEMO_PROFILES (default true),
#           VERCEL_SCOPE (team slug), VERCEL_PROJECT_NAME (default companion).
# Never prints secret values. Run from the repo root. Idempotent.
set -euo pipefail

: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"
AUTH_SECRET="${AUTH_SECRET:-$(openssl rand -base64 32)}"
DEMO="${COMPANION_ENABLE_DEMO_PROFILES:-true}"
PROJECT="${VERCEL_PROJECT_NAME:-companion}"
SCOPE_ARGS=()
if [ -n "${VERCEL_SCOPE:-}" ]; then SCOPE_ARGS=(--scope "$VERCEL_SCOPE"); fi

echo "==> 1/5 Database: migrate + seed"
npm run -s db:migrate
npm run -s db:seed

echo "==> 2/5 Verify OpenAI access and model availability"
npm run -s verify

echo "==> 3/5 Link Vercel project ($PROJECT)"
npx --yes vercel@latest link --yes --project "$PROJECT" --token "$VERCEL_TOKEN" "${SCOPE_ARGS[@]}" >/dev/null

set_env() { # name value
  local name="$1" value="$2"
  # Remove any existing production value, then add (vercel env add is not idempotent).
  npx --yes vercel@latest env rm "$name" production --yes --token "$VERCEL_TOKEN" "${SCOPE_ARGS[@]}" >/dev/null 2>&1 || true
  printf '%s' "$value" | npx --yes vercel@latest env add "$name" production --token "$VERCEL_TOKEN" "${SCOPE_ARGS[@]}" >/dev/null
  echo "    set $name"
}

echo "==> 4/5 Environment variables (production)"
if [ -n "${OPENAI_API_KEY:-}" ]; then set_env OPENAI_API_KEY "$OPENAI_API_KEY"; else echo "    OPENAI_API_KEY not in this environment — keeping the value stored in Vercel"; fi
set_env DATABASE_URL "$DATABASE_URL"
set_env AUTH_SECRET "$AUTH_SECRET"
set_env COMPANION_ENABLE_DEMO_PROFILES "$DEMO"
set_env COMPANION_DAILY_COST_CAP_USD "${COMPANION_DAILY_COST_CAP_USD:-20}"
set_env COMPANION_PER_USER_DAILY_COST_CAP_USD "${COMPANION_PER_USER_DAILY_COST_CAP_USD:-10}"
set_env COMPANION_MAX_SESSION_MINUTES "${COMPANION_MAX_SESSION_MINUTES:-30}"

echo "==> 5/5 Deploy (production)"
URL="$(npx --yes vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN" "${SCOPE_ARGS[@]}" 2>/dev/null | tail -1)"
echo "Deployed: $URL"
echo "Smoke test:"
curl -sS "$URL/api/health" && echo
