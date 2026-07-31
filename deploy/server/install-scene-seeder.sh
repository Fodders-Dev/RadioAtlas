#!/usr/bin/env bash
set -euo pipefail

# Installs the nightly scene-artwork top-up. Idempotent: safe to re-run after
# every deploy.
#
# The job itself lives in the repo (deploy/server/seed-scene-nightly.sh) and is
# invoked through the `current` symlink, so a deploy picks up changes to it
# without re-running this installer.
#
# Not being root is NOT an error here: the deploy must never fail because a box
# cannot install a unit. It reports and exits clean, and the owner can run this
# once by hand.

APP_ROOT="${APP_ROOT:-/opt/RadioAtlas}"
SERVICE=/etc/systemd/system/radioatlas-scene-seeder.service
TIMER=/etc/systemd/system/radioatlas-scene-seeder.timer

if [[ "$(id -u)" != "0" ]]; then
  echo "Scene seeder installer skipped: needs root to write $SERVICE." >&2
  exit 0
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "Scene seeder installer skipped: systemd is not available." >&2
  exit 0
fi

cat > "$SERVICE" <<EOF
[Unit]
Description=Nightly AI scene-background top-up for RadioAtlas
After=network-online.target

[Service]
Type=oneshot
Environment=APP_ROOT=$APP_ROOT
ExecStart=/usr/bin/env bash $APP_ROOT/current/deploy/server/seed-scene-nightly.sh
# Every guard inside the script exits 0 (disabled, no token, API down, allowance
# already spent), so a FAILED unit means the generation request itself failed —
# a real signal rather than noise.
EOF

cat > "$TIMER" <<'EOF'
[Unit]
Description=Nightly AI scene-background top-up for RadioAtlas

[Timer]
# After UTC midnight so the daily allowance is fresh, after the 03:25 UTC catalog
# artifact refresh so the ranked shelves are the current ones, and after the
# 04:20 UTC SQLite snapshot so the two never overlap.
OnCalendar=*-*-* 04:55:00 UTC
Persistent=true
RandomizedDelaySec=600

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now radioatlas-scene-seeder.timer

echo "Installed radioatlas-scene-seeder.timer" >&2
systemctl list-timers radioatlas-scene-seeder.timer --no-pager | sed -n 2p >&2
