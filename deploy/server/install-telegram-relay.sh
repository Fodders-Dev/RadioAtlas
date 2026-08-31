#!/usr/bin/env bash
# Install the loopback Telegram relay. Run this on the host that CAN reach
# api.telegram.org — the foreign one.
#
#   APP_ROOT=/opt/RadioAtlas bash deploy/server/install-telegram-relay.sh
#
# Pairs with install-telegram-tunnel.sh on the host that cannot. See
# telegram-relay.mjs for why this exists and why it binds to loopback only.
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/RadioAtlas}"
PORT="${TELEGRAM_RELAY_PORT:-8399}"
SERVICE=/etc/systemd/system/radioatlas-telegram-relay.service
NODE_BIN="${NODE_BIN:-$(command -v node)}"
# The relay may have to live OUTSIDE a release directory: the foreign host is
# the one that no longer receives deploys, which is half the reason this exists.
RELAY_SCRIPT="${RELAY_SCRIPT:-$APP_ROOT/current/deploy/server/telegram-relay.mjs}"

if [[ -z "$NODE_BIN" ]]; then
  echo "node not found on PATH; set NODE_BIN" >&2
  exit 1
fi

if [[ ! -f "$RELAY_SCRIPT" ]]; then
  echo "relay script not found at $RELAY_SCRIPT; set RELAY_SCRIPT" >&2
  exit 1
fi

cat > "$SERVICE" <<EOF
[Unit]
Description=RadioAtlas loopback relay to the Telegram Bot API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=TELEGRAM_RELAY_PORT=$PORT
ExecStart=$NODE_BIN --no-warnings $RELAY_SCRIPT
Restart=always
RestartSec=3
# The bot token is in the path of every request this carries. Nothing here may
# widen that: no network beyond loopback, no new privileges, no writable paths.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now radioatlas-telegram-relay.service
sleep 2

# Prove it end to end with a DELIBERATELY INVALID token: Telegram answers 401,
# which shows the whole path works without putting the real token anywhere.
code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 \
  "http://127.0.0.1:$PORT/bot123456:not-a-real-token/getMe" || echo 000)
if [[ "$code" != "401" ]]; then
  echo "Relay installed but did NOT reach Telegram (expected 401, got $code)" >&2
  systemctl status radioatlas-telegram-relay.service --no-pager | tail -5 >&2
  exit 1
fi

echo "radioatlas-telegram-relay on 127.0.0.1:$PORT — reached Telegram (401 on an invalid token, as expected)" >&2
