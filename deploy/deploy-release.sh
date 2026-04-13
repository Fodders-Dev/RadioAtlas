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

if pm2 describe radioatlas-api >/dev/null 2>&1; then
  pm2 startOrGracefulReload ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs --update-env
fi
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

mapfile -t old_releases < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d | sort -r)
if (( ${#old_releases[@]} > KEEP_RELEASES )); then
  for old_release in "${old_releases[@]:KEEP_RELEASES}"; do
    rm -rf "$old_release"
  done
fi

rm -f "$ARCHIVE_PATH"

echo "Deployed release: $RELEASE_NAME"
