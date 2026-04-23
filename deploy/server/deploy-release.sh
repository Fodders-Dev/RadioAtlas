#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <release-sha>"
  exit 1
fi

RELEASE_SHA="$1"
APP_ROOT="/opt/RadioAtlas"
RELEASES_DIR="$APP_ROOT/releases"
CURRENT_LINK="$APP_ROOT/current"
SHARED_ENV_DIR="$APP_ROOT/shared/env"

RELEASE_DIR="$RELEASES_DIR/$RELEASE_SHA"
if [[ ! -d "$RELEASE_DIR" ]]; then
  echo "Release directory not found: $RELEASE_DIR"
  exit 1
fi

mkdir -p "$SHARED_ENV_DIR"

sync_nginx_config() {
  local source_conf="$CURRENT_LINK/deploy/radioatlas.nginx.conf"
  local target_conf="/etc/nginx/sites-available/radioatlas.conf"
  local target_link="/etc/nginx/sites-enabled/radioatlas.conf"

  if ! command -v nginx >/dev/null 2>&1; then
    return
  fi

  if [[ ! -f "$source_conf" ]]; then
    echo "Missing nginx config: $source_conf" >&2
    exit 1
  fi

  install -D -m 644 "$source_conf" "$target_conf"
  ln -sfn "$target_conf" "$target_link"
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  if command -v systemctl >/dev/null 2>&1; then
    systemctl reload nginx || nginx -s reload
  else
    nginx -s reload
  fi
}

wait_for_api_health() {
  local url="${1:-http://127.0.0.1:3001/health}"
  local attempts="${2:-20}"
  local delay_seconds="${3:-2}"

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl --fail --silent --show-error "$url" >/dev/null; then
      return 0
    fi
    sleep "$delay_seconds"
  done

  echo "API healthcheck did not pass after deploy: $url" >&2
  pm2 status || true
  pm2 logs radioatlas-api --lines 80 --nostream || true
  return 1
}

cd "$RELEASE_DIR"

if [[ -f "$SHARED_ENV_DIR/api.env" ]]; then
  cp "$SHARED_ENV_DIR/api.env" "apps/api/.env"
fi
if [[ -f "$SHARED_ENV_DIR/bot.env" ]]; then
  cp "$SHARED_ENV_DIR/bot.env" "apps/bot/.env"
fi
if [[ -f "$SHARED_ENV_DIR/webapp.env" ]]; then
  cp "$SHARED_ENV_DIR/webapp.env" "apps/webapp/.env.production"
fi

npm ci
npm --workspace apps/webapp run build
npm --workspace apps/api run build
npm --workspace apps/bot run build

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
sync_nginx_config

pm2 startOrReload "$CURRENT_LINK/ecosystem.config.cjs" --update-env
pm2 save
wait_for_api_health

find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort | head -n -5 | xargs -r rm -rf

echo "Deploy complete: $RELEASE_SHA"
