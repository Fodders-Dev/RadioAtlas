#!/usr/bin/env bash
# Install the SSH tunnel to the Telegram relay. Run this on the host that
# CANNOT reach api.telegram.org — the Russian one.
#
#   RELAY_HOST=root@1.2.3.4 bash deploy/server/install-telegram-tunnel.sh
#
# It forwards 127.0.0.1:<port> here to 127.0.0.1:<port> on the relay host, so
# our processes set TELEGRAM_API_ROOT=http://127.0.0.1:<port> and nothing else
# on this machine is affected. That last part is the point: this box also runs
# somebody else's Telegram bot, and a machine-wide redirect (an /etc/hosts
# entry, a transparent proxy) would silently reroute their traffic too.
#
# ⚠ The key it uses is generated here and authorised on the relay host with
# `restrict,port-forwarding,permitopen=` — it can open exactly one forward and
# cannot get a shell. A general-purpose root key would be a much larger thing to
# leave lying on a box that is, by construction, the one attackers can reach.
#
# ⚠ `restrict` turns EVERYTHING off, and `permitopen` alone does NOT turn
# forwarding back on — `port-forwarding` has to be in that list too. Without it
# the tunnel connects, systemd reports the unit active, and it forwards nothing:
# a green service that does not work, which is the shape of failure this project
# keeps paying for.
set -euo pipefail

PORT="${TELEGRAM_RELAY_PORT:-8399}"
# The same pipe carries the stream fallback: the API on the foreign host already
# exposes /stream?url=…, which is what media/foreignEgress.ts calls when every
# direct candidate for a station has failed. One tunnel, two jobs — a second
# channel would be a second thing to notice had died.
MEDIA_PORT="${MEDIA_EGRESS_PORT:-3399}"
MEDIA_REMOTE_PORT="${MEDIA_REMOTE_PORT:-3001}"
RELAY_HOST="${RELAY_HOST:-}"
KEY=/root/.ssh/radioatlas_telegram_tunnel
SERVICE=/etc/systemd/system/radioatlas-telegram-tunnel.service

if [[ -z "$RELAY_HOST" ]]; then
  echo "RELAY_HOST is required, e.g. RELAY_HOST=root@1.2.3.4" >&2
  exit 1
fi

if [[ ! -f "$KEY" ]]; then
  ssh-keygen -t ed25519 -N '' -C 'radioatlas-telegram-tunnel' -f "$KEY" >/dev/null
  echo "Generated $KEY" >&2
fi

echo "--- authorise this on the relay host, then re-run ---" >&2
echo "restrict,port-forwarding,permitopen=\"127.0.0.1:$PORT\",permitopen=\"127.0.0.1:$MEDIA_REMOTE_PORT\" $(cat "$KEY.pub")" >&2

cat > "$SERVICE" <<EOF
[Unit]
Description=RadioAtlas SSH tunnel to the Telegram relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# -N: no command, this is a pipe and nothing else.
# ExitOnForwardFailure: fail loudly rather than sit there with a dead forward,
# which would look exactly like Telegram being down.
# ServerAlive*: a silently dropped tunnel is the failure mode that matters, so
# notice it in 30s rather than whenever TCP gives up.
ExecStart=/usr/bin/ssh -N \\
  -o ExitOnForwardFailure=yes \\
  -o ServerAliveInterval=15 \\
  -o ServerAliveCountMax=2 \\
  -o StrictHostKeyChecking=accept-new \\
  -o BatchMode=yes \\
  -i $KEY \\
  -L 127.0.0.1:$PORT:127.0.0.1:$PORT \\
  -L 127.0.0.1:$MEDIA_PORT:127.0.0.1:$MEDIA_REMOTE_PORT \\
  $RELAY_HOST
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now radioatlas-telegram-tunnel.service
sleep 3

code=$(curl -s -o /dev/null -w '%{http_code}' -m 20 \
  "http://127.0.0.1:$PORT/bot123456:not-a-real-token/getMe" || echo 000)
if [[ "$code" != "401" ]]; then
  echo "Tunnel installed but Telegram is NOT reachable through it (expected 401, got $code)" >&2
  echo "If the key is not authorised on the relay host yet, that is why." >&2
  systemctl status radioatlas-telegram-tunnel.service --no-pager | tail -6 >&2
  exit 1
fi

echo "Telegram reachable via 127.0.0.1:$PORT (401 on an invalid token, as expected)" >&2
echo "Now set, in shared/env/*.env on this host:" >&2
echo "  bot.env + api.env : TELEGRAM_API_ROOT=http://127.0.0.1:$PORT" >&2
echo "  api.env           : MEDIA_FOREIGN_EGRESS_BASE=http://127.0.0.1:$MEDIA_PORT" >&2
