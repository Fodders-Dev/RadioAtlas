#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/RadioAtlas}"
API_ENV="$APP_ROOT/shared/env/api.env"
SCENE_DIR="$APP_ROOT/shared/scene-artwork"
CURRENT_LINK="$APP_ROOT/current"

if [[ ! -f "$API_ENV" ]]; then
  echo "Scene pack skipped: shared API env is missing."
  exit 0
fi

set -a
# shellcheck disable=SC1090
source "$API_ENV"
set +a

if [[ "${SCENE_ARTWORK_ENABLED:-0}" != "1" ]]; then
  echo "Scene pack skipped: generation is disabled."
  exit 0
fi
if [[ -z "${INTERNAL_WEBHOOK_TOKEN:-}" ]]; then
  echo "Scene pack skipped: INTERNAL_WEBHOOK_TOKEN is unavailable."
  exit 0
fi

scene_count="$(find "$SCENE_DIR" -maxdepth 1 -type f \( -name '*.jpg' -o -name '*.png' \) | wc -l)"
if (( scene_count >= 8 )); then
  echo "Scene pack already has $scene_count reusable backgrounds; seeding skipped."
  exit 0
fi

quota_count=0
if [[ -f "$SCENE_DIR/.daily-usage.json" ]]; then
  quota_count="$(sed -n 's/.*"count":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$SCENE_DIR/.daily-usage.json")"
  quota_count="${quota_count:-0}"
fi
if (( quota_count >= 16 )); then
  echo "Scene pack already reserved $quota_count attempts today; retry skipped."
  exit 0
fi

cd "$CURRENT_LINK"
export RADIOATLAS_API_URL="http://127.0.0.1:3001"
export SCENE_PACK_LIMIT=16
node scripts/generateScenePack.mjs >/dev/null
echo "Queued a small reusable country-and-vibe scene pack."
