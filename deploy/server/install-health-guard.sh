#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/usr/local/bin"
GUARD_SCRIPT="$INSTALL_DIR/radioatlas-health-guard.sh"
SERVICE_FILE="/etc/systemd/system/radioatlas-health-guard.service"
TIMER_FILE="/etc/systemd/system/radioatlas-health-guard.timer"

install -d "$INSTALL_DIR"

cat > "$GUARD_SCRIPT" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:3001/health}"
API_OBSERVABILITY_URL="${API_OBSERVABILITY_URL:-http://127.0.0.1:3001/observability}"
PM2_HOME="${PM2_HOME:-/root/.pm2}"
CPU_THRESHOLD="${CPU_THRESHOLD:-95}"
INFLIGHT_THRESHOLD="${INFLIGHT_THRESHOLD:-7}"
API_ENV_FILE="${API_ENV_FILE:-/opt/RadioAtlas/shared/env/api.env}"

# /observability stopped being world-readable (it published the release path and
# the browser-error ring to anyone who asked). This guard is a legitimate
# consumer, so it must now authenticate. Read the token straight from the shared
# env file rather than baking a copy of it into this script.
INTERNAL_TOKEN=""
if [[ -r "$API_ENV_FILE" ]]; then
  INTERNAL_TOKEN="$(sed -n 's/^INTERNAL_WEBHOOK_TOKEN=//p' "$API_ENV_FILE" | tail -n 1 | tr -d '"'"'"'')"
fi

if ! curl --fail --silent --max-time 8 "$API_HEALTH_URL" >/dev/null; then
  PM2_HOME="$PM2_HOME" pm2 restart radioatlas-api --update-env >/dev/null 2>&1 || true
  exit 0
fi

payload="$(curl --fail --silent --max-time 8 -H "X-Internal-Token: ${INTERNAL_TOKEN}" "$API_OBSERVABILITY_URL" || true)"
if [[ -z "$payload" ]]; then
  # No payload means no CPU/inflight signal this tick. Deliberately NOT a
  # restart trigger: /health above already covers "the API is down", and a 404
  # here (missing/rotated token) must never turn into a restart loop.
  exit 0
fi

cpu="$(python3 - "$payload" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
gauges = data.get("gauges") or {}
print(gauges.get("runtime:process_cpu_percent", 0))
PY
)"
inflight="$(python3 - "$payload" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
gauges = data.get("gauges") or {}
print(gauges.get("media_inflight:shared", 0))
PY
)"

if python3 - "$cpu" "$inflight" "$CPU_THRESHOLD" "$INFLIGHT_THRESHOLD" <<'PY'
import sys
cpu = float(sys.argv[1])
inflight = float(sys.argv[2])
cpu_limit = float(sys.argv[3])
inflight_limit = float(sys.argv[4])
raise SystemExit(0 if cpu < cpu_limit or inflight < inflight_limit else 1)
PY
then
  exit 0
fi

PM2_HOME="$PM2_HOME" pm2 restart radioatlas-api --update-env >/dev/null 2>&1 || true
EOF

chmod +x "$GUARD_SCRIPT"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=RadioAtlas API health guard

[Service]
Type=oneshot
ExecStart=$GUARD_SCRIPT
EOF

cat > "$TIMER_FILE" <<'EOF'
[Unit]
Description=Run RadioAtlas API health guard every 2 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
Unit=radioatlas-health-guard.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now radioatlas-health-guard.timer
systemctl restart radioatlas-health-guard.timer

systemctl status --no-pager radioatlas-health-guard.timer
