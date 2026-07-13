#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/RadioAtlas}"
SCENE_DIR="$APP_ROOT/shared/scene-artwork"

scene_count="$(find "$SCENE_DIR" -maxdepth 1 -type f \( -name '*.jpg' -o -name '*.png' \) | wc -l)"
quota_count=0
if [[ -f "$SCENE_DIR/.daily-usage.json" ]]; then
  quota_count="$(sed -n 's/.*"count":[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$SCENE_DIR/.daily-usage.json")"
  quota_count="${quota_count:-0}"
fi

echo "Scene artwork status: ready=$scene_count reserved_today=$quota_count"
if (( scene_count > 0 )); then
  exit 0
fi

echo "Recent sanitized scene-artwork warnings:"
PM2_HOME="${PM2_HOME:-$HOME/.pm2}" pm2 logs radioatlas-api --nostream --lines 240 2>&1 \
  | grep '\[scene-artwork\]' \
  | tail -n 24 \
  || true
