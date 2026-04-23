#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/RadioAtlas}"
OUT_BASE="${OUT_BASE:-$APP_ROOT/shared/incidents}"
SINCE="${SINCE:-6 hours ago}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT_DIR="$OUT_BASE/$STAMP-radioatlas-incident"

mkdir -p "$OUT_DIR"

echo "Saving incident artifacts to $OUT_DIR"

{
  echo "timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "hostname=$(hostname)"
  echo "since=$SINCE"
  echo "current_release=$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
} > "$OUT_DIR/context.txt"

uptime > "$OUT_DIR/uptime.txt" || true
df -h > "$OUT_DIR/df.txt" || true
free -m > "$OUT_DIR/free.txt" || true
ss -lntp > "$OUT_DIR/ss-lntp.txt" || true
ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%cpu > "$OUT_DIR/ps-cpu.txt" || true
ps -eo pid,ppid,cmd,%mem,%cpu --sort=-%mem > "$OUT_DIR/ps-mem.txt" || true

pm2 list > "$OUT_DIR/pm2-list.txt" || true
pm2 jlist > "$OUT_DIR/pm2-jlist.json" || true
pm2 logs --lines 400 --nostream radioatlas-api > "$OUT_DIR/radioatlas-api-pm2.log" || true
pm2 logs --lines 200 --nostream radioatlas-bot > "$OUT_DIR/radioatlas-bot-pm2.log" || true

journalctl -u caddy --since "$SINCE" --no-pager > "$OUT_DIR/caddy.log" || true
journalctl -u caddy --since "$SINCE" --no-pager | grep 'radioatlas.duckdns.org' > "$OUT_DIR/caddy-radioatlas.log" || true

python3 - "$OUT_DIR/caddy-radioatlas.log" "$OUT_DIR/caddy-radioatlas-summary.txt" <<'PY'
from collections import Counter
import json
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])

remote_ips = Counter()
user_agents = Counter()
uris = Counter()
hosts = Counter()

for raw_line in source.read_text(encoding="utf-8", errors="replace").splitlines():
    line = raw_line.strip()
    if not line.startswith("{"):
      continue
    try:
      payload = json.loads(line)
    except Exception:
      continue
    request = payload.get("request") or {}
    remote_ip = request.get("remote_ip")
    user_agent = ((request.get("headers") or {}).get("User-Agent") or [None])[0]
    uri = request.get("uri")
    host = request.get("host")
    if remote_ip:
      remote_ips[remote_ip] += 1
    if user_agent:
      user_agents[user_agent] += 1
    if uri:
      uris[uri] += 1
    if host:
      hosts[host] += 1

with target.open("w", encoding="utf-8") as handle:
    handle.write("== top remote_ip ==\n")
    for value, count in remote_ips.most_common(20):
        handle.write(f"{count}\t{value}\n")
    handle.write("\n== top user-agent ==\n")
    for value, count in user_agents.most_common(20):
        handle.write(f"{count}\t{value}\n")
    handle.write("\n== top uri ==\n")
    for value, count in uris.most_common(30):
        handle.write(f"{count}\t{value}\n")
    handle.write("\n== top host ==\n")
    for value, count in hosts.most_common(10):
        handle.write(f"{count}\t{value}\n")
PY

echo "$OUT_DIR"
