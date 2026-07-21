#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/RadioAtlas}"
SHARED_ENV_DIR="$APP_ROOT/shared/env"
API_ENV="$SHARED_ENV_DIR/api.env"
SCENE_DIR="$APP_ROOT/shared/scene-artwork"

IFS= read -r account_id_b64 || {
  echo "Missing encoded Cloudflare account id." >&2
  exit 1
}
IFS= read -r api_token_b64 || {
  echo "Missing encoded Cloudflare API token." >&2
  exit 1
}

account_id="$(printf '%s' "$account_id_b64" | base64 --decode)"
api_token="$(printf '%s' "$api_token_b64" | base64 --decode)"

if [[ ! "$account_id" =~ ^[a-fA-F0-9]{32}$ ]]; then
  echo "Cloudflare account id has an invalid format." >&2
  exit 1
fi
if [[ ! "$api_token" =~ ^cfut_[A-Za-z0-9_-]{20,}$ ]]; then
  echo "Cloudflare API token has an invalid format." >&2
  exit 1
fi

install -d -m 750 "$SHARED_ENV_DIR" "$SCENE_DIR"
touch "$API_ENV"
chmod 600 "$API_ENV"

upsert_env() {
  local key="$1"
  local value="$2"
  local temporary
  temporary="$(mktemp "$SHARED_ENV_DIR/.api.env.XXXXXX")"
  awk -v key="$key" 'index($0, key "=") != 1 { print }' "$API_ENV" > "$temporary"
  printf '%s=%s\n' "$key" "$value" >> "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$API_ENV"
}

upsert_env SCENE_ARTWORK_ENABLED 1
upsert_env CLOUDFLARE_ACCOUNT_ID "$account_id"
upsert_env CLOUDFLARE_API_TOKEN "$api_token"
upsert_env SCENE_ARTWORK_DIR "$SCENE_DIR"
upsert_env SCENE_ARTWORK_DAILY_CAP 60
upsert_env SCENE_ARTWORK_CONCURRENCY 1
upsert_env SCENE_ARTWORK_QUEUE_MAX 100
# THIS value — not DEFAULT_SCENE_STYLE_VERSION in apps/api/src/sceneArtwork.ts —
# is what actually reaches production scene keys. Bump both together or the new
# music-profile prompts silently keep serving old shared country+vibe images.
upsert_env SCENE_ARTWORK_STYLE_VERSION atlas-music-v3

echo "Persistent Workers AI scene cache configured."
