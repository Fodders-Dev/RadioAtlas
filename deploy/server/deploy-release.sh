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

# T_audit_6: copy the previous release's built webapp chunks into the NEW
# release's assets dir BEFORE the symlink swap. Vite emits content-hashed chunk
# filenames, so a deploy that rebuilds (say) Home.tsx replaces Home-{oldHash}.js
# with Home-{newHash}.js and deletes the old file. Any tab that cached the old
# index-*.js then 404s on the next lazy nav and trips the ErrorBoundary.
# Additive rsync (--ignore-existing) keeps old hashes resolvable: same name?
# the new build wins; missing? the old chunk fills the gap. The ErrorBoundary
# reload is the safety net if a deeper deploy-chain still misses a hash.
preserve_previous_chunks() {
  local prev_target=""
  prev_target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"

  if [[ -z "$prev_target" ]]; then
    return 0  # first deploy
  fi
  if [[ "$prev_target" == "$RELEASE_DIR" ]]; then
    return 0  # re-deploying the same sha; nothing to merge
  fi

  local prev_assets="$prev_target/apps/webapp/dist/assets"
  local new_assets="$RELEASE_DIR/apps/webapp/dist/assets"

  if [[ ! -d "$prev_assets" || ! -d "$new_assets" ]]; then
    return 0
  fi

  rsync -a --ignore-existing "$prev_assets/" "$new_assets/"
  echo "Preserved previous-release chunks from $prev_target/apps/webapp/dist/assets" >&2
}

assert_webapp_dist() {
  local web_root="$CURRENT_LINK/apps/webapp/dist"
  local index_file="$web_root/index.html"

  if [[ ! -s "$index_file" ]]; then
    echo "Missing built webapp shell: $index_file" >&2
    return 1
  fi

  if [[ ! -d "$web_root/assets" ]]; then
    echo "Missing built webapp assets directory: $web_root/assets" >&2
    return 1
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

start_pm2_release() {
  # PM2 caches the resolved cwd / script path on first `start`. Even
  # after we move the `current` symlink to a new release, `pm2 reload`
  # and `pm2 restart` keep loading dist/index.js from the OLD release
  # dir because __dirname in ecosystem.config.cjs was resolved when the
  # process was first registered. The only reliable way to make the
  # config re-evaluate __dirname (and therefore pick up the new
  # release) is delete + start.
  pm2 delete radioatlas-api >/dev/null 2>&1 || true
  pm2 delete radioatlas-bot >/dev/null 2>&1 || true
  pm2 start "$CURRENT_LINK/ecosystem.config.cjs" --update-env
  pm2 save
}

restart_pm2_release_clean() {
  pm2 delete radioatlas-api >/dev/null 2>&1 || true
  pm2 delete radioatlas-bot >/dev/null 2>&1 || true
  pm2 start "$CURRENT_LINK/ecosystem.config.cjs" --update-env
  pm2 save
}

prune_old_releases() {
  local current_target=""
  local keep_extra=4
  local kept_extra=0
  local release=""

  current_target="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"

  while IFS= read -r release; do
    if [[ -n "$current_target" && "$release" == "$current_target" ]]; then
      continue
    fi

    if (( kept_extra < keep_extra )); then
      kept_extra=$((kept_extra + 1))
      continue
    fi

    rm -rf "$release"
  done < <(
    find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
      | sort -nr \
      | cut -d' ' -f2-
  )
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

# T_audit_6: must run AFTER the webapp build (so the new assets dir exists) and
# BEFORE the symlink swap (so $CURRENT_LINK still points at the previous release).
preserve_previous_chunks

ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"
assert_webapp_dist
# Caddy is the edge; the deploy does not touch the shared nginx unit.
# (T_infra_1 removed the nginx-sync step: it was the 2026-05-27 incident
#  vector — nginx EADDRINUSE on 80/443 since Caddy already owns those ports.)

start_pm2_release
if ! wait_for_api_health; then
  echo "PM2 reload finished but API is still down; retrying with a clean restart." >&2
  restart_pm2_release_clean
  wait_for_api_health
fi

prune_old_releases

echo "Deploy complete: $RELEASE_SHA"
