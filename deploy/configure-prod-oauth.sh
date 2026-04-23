#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/RadioAtlas}"
SHARED_ENV_DIR="${SHARED_ENV_DIR:-$APP_ROOT/shared/env}"
BASE_URL="${BASE_URL:-https://radioatlas.duckdns.org}"
BASE_URL="${BASE_URL%/}"

GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-${1:-}}"
VK_CLIENT_ID="${VK_CLIENT_ID:-${2:-}}"
VK_CLIENT_SECRET="${VK_CLIENT_SECRET:-${3:-}}"
VK_REDIRECT_URI="${VK_REDIRECT_URI:-${4:-${BASE_URL}/api/auth/vk/callback}}"
WEBAPP_GOOGLE_CLIENT_ID="${WEBAPP_GOOGLE_CLIENT_ID:-$GOOGLE_CLIENT_ID}"
WEBAPP_TELEGRAM_WEB_LOGIN="${WEBAPP_TELEGRAM_WEB_LOGIN:-}"

API_ENV="$SHARED_ENV_DIR/api.env"
WEBAPP_ENV="$SHARED_ENV_DIR/webapp.env"

if [[ ! -f "$API_ENV" || ! -f "$WEBAPP_ENV" ]]; then
  echo "Missing env files in $SHARED_ENV_DIR" >&2
  exit 1
fi

if [[ -z "$GOOGLE_CLIENT_ID" && -z "$VK_CLIENT_ID" ]]; then
  echo "Usage: GOOGLE_CLIENT_ID=... VK_CLIENT_ID=... VK_CLIENT_SECRET=... bash deploy/configure-prod-oauth.sh" >&2
  echo "   or: bash deploy/configure-prod-oauth.sh <google_client_id> <vk_client_id> <vk_client_secret> [vk_redirect_uri]" >&2
  exit 1
fi

upsert_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  local escaped

  escaped="${value//\\/\\\\}"
  escaped="${escaped//&/\\&}"
  escaped="${escaped//|/\\|}"

  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

if [[ -n "$GOOGLE_CLIENT_ID" ]]; then
  upsert_env "$API_ENV" "GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_ID"
  upsert_env "$WEBAPP_ENV" "VITE_GOOGLE_CLIENT_ID" "$WEBAPP_GOOGLE_CLIENT_ID"
fi

if [[ -n "$WEBAPP_TELEGRAM_WEB_LOGIN" ]]; then
  upsert_env "$WEBAPP_ENV" "VITE_TELEGRAM_WEB_LOGIN" "$WEBAPP_TELEGRAM_WEB_LOGIN"
fi

if [[ -n "$VK_CLIENT_ID" ]]; then
  if [[ -z "$VK_CLIENT_SECRET" ]]; then
    echo "VK_CLIENT_SECRET is required when VK_CLIENT_ID is provided." >&2
    exit 1
  fi
  upsert_env "$API_ENV" "VK_CLIENT_ID" "$VK_CLIENT_ID"
  upsert_env "$API_ENV" "VK_CLIENT_SECRET" "$VK_CLIENT_SECRET"
  upsert_env "$API_ENV" "VK_REDIRECT_URI" "$VK_REDIRECT_URI"
fi

cd "$APP_ROOT/current"
npm --workspace apps/webapp run build
pm2 restart radioatlas-api --update-env
pm2 restart radioatlas-bot --update-env

echo "OAuth env updated."
echo "Google configured: $( [[ -n "$GOOGLE_CLIENT_ID" ]] && echo yes || echo no )"
echo "VK configured: $( [[ -n "$VK_CLIENT_ID" ]] && echo yes || echo no )"
echo "Telegram web login enabled: $( [[ "$WEBAPP_TELEGRAM_WEB_LOGIN" == "1" ]] && echo yes || echo no )"
echo "VK redirect URI: $VK_REDIRECT_URI"
