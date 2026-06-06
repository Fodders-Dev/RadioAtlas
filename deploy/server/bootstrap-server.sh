#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="/opt/RadioAtlas"
SHARED_ENV_DIR="$APP_ROOT/shared/env"
RELEASES_DIR="$APP_ROOT/releases"

apt-get update
apt-get install -y curl git rsync nginx

# Recording: the bot shells out to the SYSTEM ffmpeg (apt, dynamically linked).
# The bundled ffmpeg-static is fully static and SIGSEGVs on any network input on
# this VPS (static-glibc DNS-resolve bug); it stays only as a dev/CI fallback.
# NEEDRESTART_MODE=a is required or needrestart hangs on stdin on Ubuntu 22.04.
DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y ffmpeg

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
