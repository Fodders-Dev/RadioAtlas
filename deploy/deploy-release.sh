#!/usr/bin/env bash
set -Eeuo pipefail

ARCHIVE_PATH="${1:-}"
SHA_LABEL="${2:-manual}"
APP_ROOT="${APP_ROOT:-/opt/RadioAtlas}"
RELEASES_DIR="$APP_ROOT/releases"
CURRENT_LINK="$APP_ROOT/current"
SHARED_ENV_DIR="$APP_ROOT/shared/env"
SHARED_DATA_DIR="$APP_ROOT/shared/data"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

if [[ -z "$ARCHIVE_PATH" || ! -f "$ARCHIVE_PATH" ]]; then
  echo "Usage: deploy-release.sh /tmp/release.tgz [sha-label]" >&2
  exit 1
fi

for required in tar npm node pm2 curl; do
  command -v "$required" >/dev/null 2>&1 || {
    echo "Missing required command: $required" >&2
    exit 1
  }
done

for env_file in "$SHARED_ENV_DIR/api.env" "$SHARED_ENV_DIR/bot.env" "$SHARED_ENV_DIR/webapp.env"; do
  if [[ ! -f "$env_file" ]]; then
    echo "Missing required env file: $env_file" >&2
    exit 1
  fi
done

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

mkdir -p "$RELEASES_DIR" "$SHARED_DATA_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%S)"
RELEASE_NAME="${STAMP}-${SHA_LABEL}"
RELEASE_DIR="$RELEASES_DIR/$RELEASE_NAME"

mkdir -p "$RELEASE_DIR"
tar -xzf "$ARCHIVE_PATH" -C "$RELEASE_DIR"

if [[ ! -f "$RELEASE_DIR/package.json" ]]; then
  echo "Archive does not contain repository root files." >&2
  exit 1
fi

ln -sfn "$SHARED_ENV_DIR/api.env" "$RELEASE_DIR/apps/api/.env"
ln -sfn "$SHARED_ENV_DIR/bot.env" "$RELEASE_DIR/apps/bot/.env"
ln -sfn "$SHARED_ENV_DIR/webapp.env" "$RELEASE_DIR/apps/webapp/.env"
ln -sfn "$SHARED_ENV_DIR/webapp.env" "$RELEASE_DIR/apps/webapp/.env.production"

rm -rf "$RELEASE_DIR/apps/api/data"
ln -sfn "$SHARED_DATA_DIR" "$RELEASE_DIR/apps/api/data"

cd "$RELEASE_DIR"
npm ci
npm run build

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
sync_nginx_config

pm2 delete radioatlas-api >/dev/null 2>&1 || true
pm2 delete radioatlas-bot >/dev/null 2>&1 || true
pm2 start "$CURRENT_LINK/ecosystem.config.cjs" --update-env
pm2 save

healthy=0
for _ in $(seq 1 15); do
  if curl --fail --silent http://127.0.0.1:3001/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done

if [[ "$healthy" -ne 1 ]]; then
  echo "API healthcheck did not pass after deploy." >&2
  exit 1
fi

bash "$CURRENT_LINK/deploy/post-deploy-smoke.sh"

mapfile -t old_releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r)
if (( ${#old_releases[@]} > KEEP_RELEASES )); then
  for old_release in "${old_releases[@]:KEEP_RELEASES}"; do
    rm -rf "$old_release"
  done
fi

rm -f "$ARCHIVE_PATH"

echo "Deployed release: $RELEASE_NAME"
