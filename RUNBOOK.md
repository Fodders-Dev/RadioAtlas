# RUNBOOK

## Dev
```bash
npm install
npm run dev:webapp
npm run dev:bot
```

## Bot env
- `BOT_TOKEN`: Telegram bot token
- `WEBAPP_URL`: public webapp URL
- `WEBAPP_DEEPLINK`: optional deep link

## Webapp env
- `VITE_TG_BOT`: bot username used to build share deep links
- `VITE_API_URL`: optional API base for catalog/proxy (empty by default)
- `VITE_GLOBE_SATELLITE_TILE_URL`: optional satellite tile template for close Globe zoom (`{z}/{x}/{y}` placeholders). Defaults to Esri World Imagery; leave empty only if you want the bundled Blue Marble fallback at every zoom level.

## Deep link
- Share links use `startapp=station_<uuid>`; webapp auto-plays if station exists.

## Audio troubleshooting
- If stream fails, confirm `https://` and test with browser.
- For HLS streams, ensure `hls.js` loads (check console).
- Telegram WebView may block mixed content; keep https-only or add proxy.
- Track metadata is best-effort and depends on CORS/ICY support.
- Heavy metadata/fetch probing is protected server-side with rate limiting, in-flight dedupe, caching, and shared concurrency caps.
- Runtime gauges and latency percentiles are exposed at `/observability` and `/observability/prometheus`.

## User data
- Favorites + recently played are stored in browser localStorage per device.
- Copied track history is stored in localStorage per device.
- Theme Studio themes are stored locally in browser storage.
- The `?winamp=1` easter-egg/debug path is decorative Lite/Winamp only; it does not support Skin Lab or `.wsz` imports.

## Cache
- Catalog cached for 30 minutes in localStorage.
- Clear cache via Settings screen.
- Local fallback catalog lives at `apps/webapp/public/catalog-fast.json`.
- Update fallback catalog with `npm run catalog:update`.

## Legacy Lite/Winamp easter egg
- The main player uses the native RadioAtlas Full Player overlay.
- The legacy Lite/Winamp path is decorative only and can be opened with `?winamp=1` or the R++ brand gesture.
- Skin Lab and `.wsz`/`.zip` skin imports are removed from the runtime.

## Deploy (Telegram Mini App)
1. Host `apps/webapp` on HTTPS (Vercel recommended).
2. Create a bot via BotFather and set Web App URL (Menu Button).
3. Set `BOT_TOKEN` + `WEBAPP_URL` in `apps/bot/.env`.
4. Set `VITE_TG_BOT` in `apps/webapp/.env` and redeploy.

## Deploy (VPS)
1. Install Node 18+, Nginx, and Python 3.
2. Build webapp:
   ```bash
   npm install
   npm --workspace apps/webapp run build
   ```
3. Serve `apps/webapp/dist` directly from nginx.
   Use `deploy/radioatlas.nginx.conf` as the source of truth for the RadioAtlas server block.
4. If the old `radioatlas-static` service exists from a previous setup, retire it:
   ```bash
   bash /opt/RadioAtlas/current/deploy/server/install-radioatlas-static-origin.sh
   ```
5. Run bot:
   - `apps/bot/.env`: `BOT_TOKEN`, `WEBAPP_URL=https://your-domain`
   - use systemd or pm2 to keep it alive.
6. BotFather: set Web App URL to `https://your-domain`.

## Deploy (GitHub Actions -> VPS)
1. Add GitHub Actions secrets:
   - `SERVER_HOST`
   - `SERVER_USER`
   - `SERVER_SSH_KEY`
2. On the server, run `deploy/bootstrap-server.sh` once.
3. Fill or verify:
   - `/opt/RadioAtlas/shared/env/bot.env`
   - `/opt/RadioAtlas/shared/env/api.env`
   - `/opt/RadioAtlas/shared/env/webapp.env`
4. Push to the default branch (`master` right now; `main` is also supported by the workflow).

Deploy flow:
- Canonical workflow: `.github/workflows/deploy-server.yml`.
- GitHub Actions uploads the repository over SSH directly into `/opt/RadioAtlas/releases/<git_sha>`.
- The server runs `deploy/server/deploy-release.sh <git_sha>`.
- Shared env files from `/opt/RadioAtlas/shared/env` are copied into the release before build.
- `npm ci`, `npm --workspace apps/webapp run build`, `npm --workspace apps/api run build`, and `npm --workspace apps/bot run build` run on the server.
- PM2 launches `apps/api/dist/index.js` and `apps/bot/dist/index.js` directly from the release workspace instead of routing through `npm --workspace`.
- `/opt/RadioAtlas/current` is switched to the new release after a successful build, then PM2 reloads from `ecosystem.config.cjs`.
- Deploy now waits for `http://127.0.0.1:3001/health` before reporting success, and dumps `pm2` status/logs if the API fails to come back.
- After the release switch, reload nginx so it serves the new `current/apps/webapp/dist`:
  - `bash /opt/RadioAtlas/current/deploy/server/install-radioatlas-static-origin.sh`
  - `nginx -t && systemctl reload nginx`

## Incident capture
- Save current production logs and process state:
  - `bash /opt/RadioAtlas/current/deploy/server/capture-incident-artifacts.sh`
- Artifacts are stored under `/opt/RadioAtlas/shared/incidents/<timestamp>-radioatlas-incident`
- Saved data includes:
  - `journalctl -u caddy`
  - `pm2` logs and process list
  - `ss`, `ps`, `uptime`, `df`, `free`
  - parsed `remote_ip` / `user-agent` / `uri` summary for `radioatlas.duckdns.org`

## Health guard
- Install or refresh the automatic API health guard:
  - `bash /opt/RadioAtlas/current/deploy/server/install-health-guard.sh`
- This installs a `systemd` timer that checks `http://127.0.0.1:3001/health` every 2 minutes and restarts `radioatlas-api` through `pm2` if the API stops responding.

## Observability alerts
- Prometheus scrape target: `/observability/prometheus`
- Important gauges:
  - `runtime_process_cpu_percent`
  - `media_inflight_shared`
  - `media_inflight_metadata`
  - `media_inflight_fetch`
- Important counters:
  - `media_overload:*`
  - `media_rate_limit:*`
  - `error:GET:/metadata`
  - `error:GET:/fetch`

## API proxy (http streams + catalog)
1. Build and run:
   ```bash
   npm --workspace apps/api run build
   pm2 start /opt/RadioAtlas/apps/api/dist/index.js --name radioatlas-api --cwd /opt/RadioAtlas/apps/api
   ```
2. Nginx: proxy `/api` to `http://127.0.0.1:3001`.
3. Webapp env:
   - `VITE_API_URL=https://your-domain/api`
4. Runtime override:
   - Settings screen can override API base (saved to localStorage).

## Extractor service (NewPipe-style, YouTube blocked)
1. Install Java 17 + Gradle.
2. Run:
   ```bash
   cd apps/extractor
   gradle run
   ```
3. API env:
   - `EXTRACTOR_URL=http://127.0.0.1:4001`
4. Webapp:
   - Search -> Links -> "Extract streams".

## Legacy debug tools
- Legacy webapp diagnostics scripts are stored in `tools/legacy-debug/webapp`.
- Run them from repo root, for example:
  - `node tools/legacy-debug/webapp/debug-icy.js`
  - `node tools/legacy-debug/webapp/check-top-radio.js`

## Auto-deploy to VPS (GitHub Actions)

This repo uses `.github/workflows/deploy-server.yml` as the single production deploy workflow for pushes to `master` or `main`.

### 1) Prepare server once
On VPS:
```bash
sudo bash /opt/RadioAtlas/current/deploy/server/bootstrap-server.sh
```

Create env files:
- `/opt/RadioAtlas/shared/env/api.env`
- `/opt/RadioAtlas/shared/env/bot.env`
- `/opt/RadioAtlas/shared/env/webapp.env`

Deploy script reads those files and injects them into each release before build.

### 2) Add GitHub secrets
In repo settings -> Secrets and variables -> Actions:
- `SERVER_HOST` (example: `212.69.84.167`)
- `SERVER_USER` (example: `root`)
- `SERVER_SSH_KEY` (private key matching a public key in `~/.ssh/authorized_keys` on server)

### 3) How release works
- Workflow uploads code to `/opt/RadioAtlas/releases/<git_sha>`
- Runs `deploy/server/deploy-release.sh <git_sha>` remotely
- Script runs `npm ci`, builds webapp/api/bot, switches `/opt/RadioAtlas/current` symlink, and verifies the local API health endpoint
- PM2 reloads services with the new release
- Keeps only last 5 releases
