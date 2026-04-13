#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/RadioAtlas"
SHARED_ENV_DIR="$APP_ROOT/shared/env"
RELEASES_DIR="$APP_ROOT/releases"

apt-get update
apt-get install -y curl git rsync caddy

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

npm install -g pm2

mkdir -p "$SHARED_ENV_DIR" "$RELEASES_DIR"

cat <<'ENVHELP'
Create env files before first deploy:
  /opt/RadioAtlas/shared/env/api.env
  /opt/RadioAtlas/shared/env/bot.env
  /opt/RadioAtlas/shared/env/webapp.env
ENVHELP

if [[ -f "$APP_ROOT/current/deploy/radioatlas.Caddyfile" ]]; then
  cp "$APP_ROOT/current/deploy/radioatlas.Caddyfile" /etc/caddy/Caddyfile
  systemctl restart caddy
fi

echo "Bootstrap complete"
