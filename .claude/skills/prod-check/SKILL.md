---
name: prod-check
description: Take a full snapshot of the live RadioAtlas production box — release, processes, health, memory, and the telemetry counters worth watching. Use after a deploy, when something is reported broken, or before concluding that production is fine.
---

# Production snapshot

Production is a shared VPS at `ssh rodnya`, application in `/opt/RadioAtlas`.
The system ssh on this machine is broken — always use Git's client
(`.claude/rules/windows-shell.md`).

**Never print a secret value.** Read tokens into a shell variable and use them;
report presence and length only.

## One pass

```bash
"/c/Program Files/Git/usr/bin/ssh.exe" -o BatchMode=yes -o ConnectTimeout=25 rodnya '
  echo "=== release ==="; readlink -f /opt/RadioAtlas/current | xargs basename
  node -v
  echo "=== processes ==="
  pm2 jlist | node -pe "JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")).map(p=>p.name+\"=\"+p.pm2_env.status+\"/\"+Math.round(p.monit.memory/1048576)+\"MB restarts=\"+p.pm2_env.restart_time).join(String.fromCharCode(10))"
  echo "=== endpoints ==="
  curl -sS -o /dev/null -m 20 -w "  local /health      %{http_code}\n" http://127.0.0.1:3001/health
  curl -sS -o /dev/null -m 25 -w "  public /api/health %{http_code}\n" https://radioatlas.ru/api/health
  curl -sS -o /dev/null -m 30 -w "  catalog/summary    %{http_code} in %{time_total}s\n" http://127.0.0.1:3001/catalog/summary
  echo "=== memory kills (pm2.log only, NOT the app logs) ==="
  grep -ac "exceeds --max-memory-restart" /root/.pm2/pm2.log
  free -m | sed -n 2,3p
'
```

## Telemetry worth reading

```bash
"/c/Program Files/Git/usr/bin/ssh.exe" -o BatchMode=yes rodnya '
  TOK=$(grep -E "^INTERNAL_WEBHOOK_TOKEN=" /opt/RadioAtlas/shared/env/api.env | cut -d= -f2-)
  curl -sS -m 25 -H "X-Internal-Token: $TOK" http://127.0.0.1:3001/observability -o /tmp/o.json
  node -e "
    const o=require(\"/tmp/o.json\"); const c=o.counters;
    const pick=(p)=>JSON.stringify(Object.fromEntries(Object.entries(c).filter(([k])=>k.startsWith(p))));
    console.log(\"runtime :\", JSON.stringify(o.gauges));
    console.log(\"ai      :\", pick(\"ai_\"));
    console.log(\"client  :\", pick(\"client_event\"));
    console.log(\"store   :\", o.persistence.storePath, \"ephemeral=\"+o.persistence.ephemeral);
  "'
```

## How to read it

- `runtime:heap_limit_mb` ≈ 832 means the 640MB heap cap is in force. ~2GB means
  it is not.
- `persistence.ephemeral` must be `false`. `true` means the metrics store is
  inside a release directory again and every deploy is wiping history.
- `/catalog/summary` answering in tens of seconds is not a hang — it is the
  6-hour catalogue refresh, during which catalogue endpoints queue. Check again
  a minute later before diagnosing.
- Playback health: `play_success / (play_attempt - play_superseded)`, computed
  from `counterWindows.last1h` or `.last24h` — NOT from the top-level counters,
  which are totals since the store file was created and span every change in
  what was counted. An empty window means an idle hour, not a broken one.
- `ai_web_search_degraded` rising means Лира is answering without the sources
  she should cite — check the Tavily cap before judging answer quality.
- `presence:peak_station_listeners_1h` is the one that says whether the live
  listeners surface CAN show anything: `/listening/live` publishes a station
  only at three simultaneous listeners, so until this peak reaches 3 the empty
  block is arithmetic, not a bug. The instantaneous
  `presence:live_listeners` will read 0 almost every time it is sampled.
- A silent-stall count rising alongside visibility changes means the
  background-tab fix regressed.

`RUNBOOK.md` has the incident history and the deeper triage paths.
