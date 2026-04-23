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

cat <<'NGINXHELP'
RadioAtlas production shell is expected to be served directly by nginx from:
  /opt/RadioAtlas/current/apps/webapp/dist

Use deploy/radioatlas.nginx.conf as the source of truth for the nginx server block.
Each deploy is expected to refresh /etc/nginx/sites-available/radioatlas.conf and reload nginx.
NGINXHELP

echo "Bootstrap complete"
