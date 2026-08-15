#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <release-sha>"
  exit 1
fi

RELEASE_SHA="$1"
if [[ ! "$RELEASE_SHA" =~ ^[0-9a-fA-F]{7,64}$ ]]; then
  echo "Invalid release SHA: expected 7-64 hexadecimal characters." >&2
  exit 1
fi
RELEASE_SHORT_SHA="${RELEASE_SHA:0:7}"

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

  # ...but with an expiry, or the carry-forward compounds forever: each release
  # inherited every chunk of every release before it. Measured before this:
  # 661 files under 43 distinct basenames in ONE release, 2.8GB across the five
  # kept releases on a box with 7.3GB free.
  #
  # Safe to expire, because Caddy serves index.html `no-store, no-cache,
  # must-revalidate`: a fresh page load always resolves the CURRENT hashes. Old
  # chunks are only needed by a session that was ALREADY open across a deploy,
  # which lives hours, not weeks. rsync -a preserves mtimes, so a carried chunk
  # keeps the mtime of the build that produced it; this build's own files are
  # brand new and can never match.
  local retention_days="${CHUNK_RETENTION_DAYS:-14}"
  local pruned=0
  pruned="$(find "$new_assets" -maxdepth 1 -type f -mtime "+${retention_days}" -print -delete | wc -l)"
  if (( pruned > 0 )); then
    echo "Pruned $pruned carried chunk(s) older than ${retention_days}d from $new_assets" >&2
  fi
}

# `ffmpeg-static` (a dependency of apps/bot) downloads its binary in a
# postinstall step and keeps every copy it has ever fetched in a cacache
# directory that nothing evicts. Every deploy runs `npm ci` in a fresh release
# dir, so every deploy adds another ~9MB entry. Measured 2026-08-14: 1188
# entries, 5.5GB — twice the size of all five kept releases combined, and the
# single largest consumer on a 59GB disk that had reached 96% full.
#
# A warm cache is worth keeping (it saves the download on the common deploy),
# so this caps rather than clears: past the cap the whole directory goes and the
# next install refills it with just what it needs.
prune_ffmpeg_download_cache() {
  local cache_dir="${FFMPEG_CACHE_DIR:-$HOME/.cache/ffmpeg-static-nodejs}"
  local cap_mb="${FFMPEG_CACHE_MAX_MB:-256}"
  local used_mb=""

  [[ -d "$cache_dir" ]] || return 0
  used_mb="$(du -sm "$cache_dir" 2>/dev/null | cut -f1)"
  [[ "$used_mb" =~ ^[0-9]+$ ]] || return 0

  if (( used_mb > cap_mb )); then
    rm -rf "$cache_dir"
    echo "Cleared ffmpeg-static download cache: ${used_mb}MB exceeded the ${cap_mb}MB cap" >&2
  fi
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

# The CSS filename stamp this used to check is gone: the toolchain's CSS hash is
# content-derived again, and stamping the commit into asset names rotated EVERY
# chunk filename each release (25 byte-identical 1MB maplibre copies piled up in
# one release's assets dir, and every listener re-downloaded the bundle on every
# deploy).
#
# The hazard it guarded is still real though — builds run ON the VPS, whose git
# checkout is frozen, so a build can silently be made from the wrong source. Guard
# that directly instead: __APP_COMMIT__ is compiled into the bundle, so the
# release sha MUST appear in the built output.
assert_webapp_build_provenance() {
  local dist_dir="$RELEASE_DIR/apps/webapp/dist"

  if [[ ! -d "$dist_dir/assets" ]]; then
    echo "Missing built webapp assets directory: $dist_dir/assets" >&2
    return 1
  fi

  if ! grep -rqF "$RELEASE_SHORT_SHA" "$dist_dir/index.html" "$dist_dir/assets" 2>/dev/null; then
    echo "Webapp build provenance check failed: $RELEASE_SHORT_SHA is absent from $dist_dir." >&2
    echo "The build did not see this release's source (SOURCE_COMMIT wiring or a stale checkout)." >&2
    return 1
  fi

  echo "Verified webapp build provenance: $RELEASE_SHORT_SHA is present in the built output." >&2
}

# Same guard, for the bot's Mini App stamp. Without it the stamp can go inert
# again in exactly the way it already did — silently, because nothing renders it
# anywhere a human looks.
assert_bot_release_stamp() {
  local bot_env="$RELEASE_DIR/apps/bot/.env"

  if [[ ! -f "$bot_env" ]]; then
    # No shared bot.env on this host (e.g. a bot-less deployment): nothing to
    # assert, and failing here would break an otherwise valid deploy.
    echo "No apps/bot/.env in this release; skipping bot stamp assert." >&2
    return 0
  fi

  if ! grep -q "^SOURCE_COMMIT=${RELEASE_SHA}$" "$bot_env"; then
    echo "Bot release stamp missing or stale: expected SOURCE_COMMIT=${RELEASE_SHA} in $bot_env" >&2
    return 1
  fi
  echo "Verified bot release stamp: SOURCE_COMMIT=${RELEASE_SHORT_SHA}" >&2
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
  # Scheduled one-shot harvester (gated OFF by default) — same delete+start so it
  # re-evaluates __dirname against the new release; a no-op until enabled.
  pm2 delete radioatlas-harvester >/dev/null 2>&1 || true
  pm2 start "$CURRENT_LINK/ecosystem.config.cjs" --update-env
  pm2 save
}

restart_pm2_release_clean() {
  pm2 delete radioatlas-api >/dev/null 2>&1 || true
  pm2 delete radioatlas-bot >/dev/null 2>&1 || true
  # Scheduled one-shot harvester (gated OFF by default) — same delete+start so it
  # re-evaluates __dirname against the new release; a no-op until enabled.
  pm2 delete radioatlas-harvester >/dev/null 2>&1 || true
  pm2 start "$CURRENT_LINK/ecosystem.config.cjs" --update-env
  pm2 save
}

prune_old_releases() {
  local current_target=""
  # Chunk preservation reads exactly ONE previous release; the extras exist only
  # for a manual rollback. At ~530MB each, four spares cost 2.1GB of a 59GB disk
  # for a rollback depth nobody has used — two is a real safety margin without
  # being the reason the box fills up.
  local keep_extra="${RELEASE_KEEP_EXTRA:-2}"
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
  # The bot stamps `?v=<short sha>` onto the Mini App URL from SOURCE_COMMIT
  # (apps/bot/src/urlRuntime.ts) — but nothing ever set it, so the stamp was
  # silently absent from every link the bot has ever sent. This is the runtime
  # sibling of the #180 build-time fix: the bot reads its env from THIS file at
  # start-up, so writing the release sha here is release-scoped and survives a
  # pm2 resurrect after a reboot.
  #
  # Honest scope: this does NOT fix HTTP caching — Caddy already serves the
  # shell with `no-store`. It matters only where Telegram reuses a Mini App
  # instance keyed by URL, and it makes the stamp truthful for diagnosis.
  sed -i '/^SOURCE_COMMIT=/d' "apps/bot/.env"
  printf '\nSOURCE_COMMIT=%s\n' "$RELEASE_SHA" >> "apps/bot/.env"
fi
if [[ -f "$SHARED_ENV_DIR/webapp.env" ]]; then
  cp "$SHARED_ENV_DIR/webapp.env" "apps/webapp/.env.production"
fi

npm ci
prune_ffmpeg_download_cache
# Pin the Vite build metadata to this release even if the VPS inherits a stale
# SOURCE_COMMIT. CSS is served immutable for one year, so reusing an old commit
# suffix can leave Telegram WebViews on stale styles after a successful deploy.
SOURCE_COMMIT="$RELEASE_SHA" npm --workspace apps/webapp run build
assert_webapp_build_provenance
npm --workspace apps/api run build
npm --workspace apps/bot run build
assert_bot_release_stamp

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
