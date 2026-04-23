#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/RadioAtlas}"
SHARED_DIR="$APP_ROOT/shared"
SHARED_ENV_DIR="$SHARED_DIR/env"
SHARED_DATA_DIR="$SHARED_DIR/data"
LEGACY_BOT_ENV="$APP_ROOT/apps/bot/.env"
DEFAULT_BASE_URL="${DEFAULT_BASE_URL:-https://radioatlas.duckdns.org}"

mkdir -p "$SHARED_ENV_DIR" "$SHARED_DATA_DIR" "$APP_ROOT/releases"

if [[ -f "$LEGACY_BOT_ENV" && ! -f "$SHARED_ENV_DIR/bot.env" ]]; then
  cp "$LEGACY_BOT_ENV" "$SHARED_ENV_DIR/bot.env"
fi

touch "$SHARED_ENV_DIR/bot.env" "$SHARED_ENV_DIR/api.env" "$SHARED_ENV_DIR/webapp.env"
chmod 600 "$SHARED_ENV_DIR"/*.env

set -a
source "$SHARED_ENV_DIR/bot.env" || true
source "$SHARED_ENV_DIR/api.env" || true
source "$SHARED_ENV_DIR/webapp.env" || true
set +a

BASE_URL="${WEBAPP_URL:-$DEFAULT_BASE_URL}"
BASE_URL="${BASE_URL%/}"
API_URL="${API_URL:-${BASE_URL}/api}"
PUBLIC_URL="${PUBLIC_URL:-$API_URL}"
ACCOUNT_STORE_PATH="${ACCOUNT_STORE_PATH:-$SHARED_DATA_DIR/account-store.sqlite}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-${BOT_TOKEN:-}}"
WEBAPP_DEEPLINK="${WEBAPP_DEEPLINK:-}"
BOT_USERNAME="${BOT_USERNAME:-}"
VK_CLIENT_ID="${VK_CLIENT_ID:-}"
VK_CLIENT_SECRET="${VK_CLIENT_SECRET:-}"
VK_REDIRECT_URI="${VK_REDIRECT_URI:-${BASE_URL}/api/auth/vk/callback}"
VITE_API_URL="${VITE_API_URL:-/api}"
VITE_TG_BOT="${VITE_TG_BOT:-}"
VITE_GOOGLE_CLIENT_ID="${VITE_GOOGLE_CLIENT_ID:-${GOOGLE_CLIENT_ID:-}}"

if [[ -z "$VITE_TG_BOT" ]]; then
  if [[ -n "$WEBAPP_DEEPLINK" ]]; then
    parsed_bot="$(printf '%s' "$WEBAPP_DEEPLINK" | sed -nE 's#https?://t\.me/([^/?]+).*#\1#p')"
    VITE_TG_BOT="${parsed_bot:-}"
  elif [[ -n "$BOT_USERNAME" ]]; then
    VITE_TG_BOT="$BOT_USERNAME"
  fi
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

upsert_env "$SHARED_ENV_DIR/bot.env" "WEBAPP_URL" "$BASE_URL"
upsert_env "$SHARED_ENV_DIR/bot.env" "API_URL" "$API_URL"

upsert_env "$SHARED_ENV_DIR/api.env" "PORT" "3001"
upsert_env "$SHARED_ENV_DIR/api.env" "PUBLIC_URL" "$PUBLIC_URL"
upsert_env "$SHARED_ENV_DIR/api.env" "ACCOUNT_STORE_PATH" "$ACCOUNT_STORE_PATH"
if [[ -n "$TELEGRAM_BOT_TOKEN" ]]; then
  upsert_env "$SHARED_ENV_DIR/api.env" "TELEGRAM_BOT_TOKEN" "$TELEGRAM_BOT_TOKEN"
fi
if [[ -n "${GOOGLE_CLIENT_ID:-}" ]]; then
  upsert_env "$SHARED_ENV_DIR/api.env" "GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_ID"
fi
if [[ -n "$VK_CLIENT_ID" ]]; then
  upsert_env "$SHARED_ENV_DIR/api.env" "VK_CLIENT_ID" "$VK_CLIENT_ID"
fi
if [[ -n "$VK_CLIENT_SECRET" ]]; then
  upsert_env "$SHARED_ENV_DIR/api.env" "VK_CLIENT_SECRET" "$VK_CLIENT_SECRET"
fi
if [[ -n "$VK_REDIRECT_URI" ]]; then
  upsert_env "$SHARED_ENV_DIR/api.env" "VK_REDIRECT_URI" "$VK_REDIRECT_URI"
fi

upsert_env "$SHARED_ENV_DIR/webapp.env" "VITE_API_URL" "$VITE_API_URL"
if [[ -n "$VITE_TG_BOT" ]]; then
  upsert_env "$SHARED_ENV_DIR/webapp.env" "VITE_TG_BOT" "$VITE_TG_BOT"
fi
if [[ -n "$VITE_GOOGLE_CLIENT_ID" ]]; then
  upsert_env "$SHARED_ENV_DIR/webapp.env" "VITE_GOOGLE_CLIENT_ID" "$VITE_GOOGLE_CLIENT_ID"
fi

echo "Bootstrap complete."
echo "Shared env dir: $SHARED_ENV_DIR"
echo "Shared data dir: $SHARED_DATA_DIR"
