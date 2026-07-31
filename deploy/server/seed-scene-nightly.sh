#!/usr/bin/env bash
set -euo pipefail

# Nightly top-up of AI scene backgrounds for the RANKED discovery shelves.
#
# Why this exists: the only seeding that ever ran was the deploy-time bootstrap
# (seed-scene-artwork.sh), which stops entirely once the active style has >=8
# images. So the SCENE_ARTWORK_DAILY_CAP allowance was going unspent on almost
# every day of the year, and coverage only ever moved when someone ran a script
# by hand. This is the recurring job that actually spends it.
#
# Invoked through $APP_ROOT/current so a deploy picks up changes to the script
# and to scripts/generateScenePack.mjs without re-running the installer.

APP_ROOT="${APP_ROOT:-/opt/RadioAtlas}"
API_ENV="$APP_ROOT/shared/env/api.env"
SCENE_DIR="${SCENE_DIR:-$APP_ROOT/shared/scene-artwork}"
CURRENT_LINK="$APP_ROOT/current"
API_URL="${RADIOATLAS_API_URL:-http://127.0.0.1:3001}"

if [[ ! -f "$API_ENV" ]]; then
  echo "Scene top-up skipped: shared API env is missing."
  exit 0
fi

set -a
# shellcheck disable=SC1090
source "$API_ENV"
set +a

if [[ "${SCENE_ARTWORK_ENABLED:-0}" != "1" ]]; then
  echo "Scene top-up skipped: generation is disabled."
  exit 0
fi
if [[ -z "${INTERNAL_WEBHOOK_TOKEN:-}" ]]; then
  echo "Scene top-up skipped: INTERNAL_WEBHOOK_TOKEN is unavailable."
  exit 0
fi

if ! curl -fsS --max-time 10 "$API_URL/health" >/dev/null 2>&1; then
  echo "Scene top-up skipped: API is not answering on $API_URL."
  exit 0
fi

# The server enforces the cap itself (reserveDailyAttempt, fails closed on a
# corrupt file), so this is only about not posting a batch that is certain to be
# refused. The quota file is keyed by UTC day and this unit runs after UTC
# midnight, so on a normal night the whole allowance is free.
quota_count=0
if [[ -f "$SCENE_DIR/.daily-usage.json" ]]; then
  quota_today="$(sed -n 's/.*"utcDate":[[:space:]]*"\([0-9-]*\)".*/\1/p' "$SCENE_DIR/.daily-usage.json")"
  if [[ "$quota_today" == "$(date -u +%F)" ]]; then
    quota_count="$(sed -n 's/.*"count":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$SCENE_DIR/.daily-usage.json")"
    quota_count="${quota_count:-0}"
  fi
fi

daily_cap="${SCENE_ARTWORK_DAILY_CAP:-60}"
if [[ ! "$daily_cap" =~ ^[0-9]+$ ]]; then
  daily_cap=60
fi
remaining=$(( daily_cap - quota_count ))
if (( remaining <= 0 )); then
  echo "Scene top-up skipped: today's $daily_cap-attempt allowance is already spent."
  exit 0
fi

# One POST carries at most 50 station ids (MAX_BATCH_STATIONS). Anything left of
# the allowance after that is picked up by the next night's run — a paid retry
# after an output-filter rejection also claims its own slot, so leaving headroom
# is deliberate rather than a rounding loss.
pack_limit=50
if (( remaining < pack_limit )); then
  pack_limit="$remaining"
fi

cd "$CURRENT_LINK"
export RADIOATLAS_API_URL="$API_URL"
export SCENE_PACK_LIMIT="$pack_limit"
export SCENE_PACK_SKIP_COVERED=1
echo "Scene top-up: allowance $quota_count/$daily_cap used, queuing up to $pack_limit ranked stations."
node scripts/generateScenePack.mjs
