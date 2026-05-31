#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/RadioAtlas"
SHARED_ENV_DIR="$APP_ROOT/shared/env"
RELEASES_DIR="$APP_ROOT/releases"

apt-get update
apt-get install -y curl git rsync nginx

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

cat <<'CADDYHELP'
RadioAtlas is served by Caddy (the production edge): it serves the static shell
from /opt/RadioAtlas/current/apps/webapp/dist and reverse-proxies /api -> 127.0.0.1:3001.

The deploy does NOT touch nginx. deploy/radioatlas.nginx.conf is kept only as a
reference for the /api proxy + gzip settings; nginx is not in the serving path.
CADDYHELP

echo "Bootstrap complete"
