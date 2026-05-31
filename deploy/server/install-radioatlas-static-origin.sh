#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${APP_ROOT:-/opt/RadioAtlas}"
CURRENT_LINK="$APP_ROOT/current"
SERVICE_NAME="radioatlas-static"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

if [[ ! -d "$CURRENT_LINK/apps/webapp/dist" ]]; then
  echo "Missing $CURRENT_LINK/apps/webapp/dist" >&2
  exit 1
fi

if systemctl list-unit-files | grep -q "^${SERVICE_NAME}\.service"; then
  systemctl disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
fi

rm -f "$SERVICE_PATH"
systemctl daemon-reload

echo "RadioAtlas no longer uses a local static-origin service."
echo "Caddy (the production edge) serves ${CURRENT_LINK}/apps/webapp/dist and reverse-proxies /api -> 127.0.0.1:3001."
