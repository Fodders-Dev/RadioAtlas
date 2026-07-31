#!/usr/bin/env bash
set -euo pipefail

# Installs a nightly, verified snapshot of the SQLite stores. Idempotent: safe to
# re-run after every deploy.
#
# The backup itself lives in the repo (deploy/server/backup-sqlite.mjs) and is
# invoked through the `current` symlink, so a deploy picks up changes to it
# without re-running this installer.

APP_ROOT="${APP_ROOT:-/opt/RadioAtlas}"
BACKUP_DIR="${BACKUP_DIR:-$APP_ROOT/backups}"
KEEP="${RADIOATLAS_BACKUP_KEEP:-14}"
# The R2 credentials for off-box replication live here, alongside the API's other
# secrets, and are deliberately not in git.
ENV_FILE="${ENV_FILE:-$APP_ROOT/shared/env/api.env}"
SERVICE=/etc/systemd/system/radioatlas-sqlite-backup.service
TIMER=/etc/systemd/system/radioatlas-sqlite-backup.timer
NODE_BIN="${NODE_BIN:-$(command -v node)}"

if [[ -z "$NODE_BIN" ]]; then
  echo "node not found on PATH; set NODE_BIN" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

cat > "$SERVICE" <<EOF
[Unit]
Description=Verified SQLite snapshot for RadioAtlas
After=network-online.target

[Service]
Type=oneshot
# Off-box replication reads R2_* from here. Without this line the job silently
# keeps reporting "not-configured" no matter what is put in the file, because
# systemd passes only what the unit names — that cost one round-trip already.
# Leading "-" so a box without the file still takes local snapshots.
# Listed before Environment= so the unit's own settings always win.
EnvironmentFile=-$ENV_FILE
Environment=RADIOATLAS_BACKUP_DIR=$BACKUP_DIR
Environment=RADIOATLAS_BACKUP_KEEP=$KEEP
ExecStart=$NODE_BIN --no-warnings $APP_ROOT/current/deploy/server/backup-sqlite.mjs
# A snapshot that fails verification exits non-zero, so a failed unit is a real
# signal rather than noise: systemctl status shows which store and why.
EOF

cat > "$TIMER" <<'EOF'
[Unit]
Description=Nightly verified SQLite snapshot for RadioAtlas

[Timer]
# Quiet hour: SQLite's online backup restarts if another connection writes
# mid-copy, so a low-traffic slot finishes in one pass.
OnCalendar=*-*-* 04:20:00 UTC
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now radioatlas-sqlite-backup.timer

echo "Installed radioatlas-sqlite-backup.timer -> $BACKUP_DIR (keep $KEEP)" >&2
systemctl list-timers radioatlas-sqlite-backup.timer --no-pager | sed -n 2p >&2
