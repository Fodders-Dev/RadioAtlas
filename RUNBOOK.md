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

## Deep link
- Share links use `startapp=station_<uuid>`; webapp auto-plays if station exists.

## Audio troubleshooting
- If stream fails, confirm `https://` and test with browser.
- For HLS streams, ensure `hls.js` loads (check console).
- Telegram WebView may block mixed content; keep https-only or add proxy.
- Track metadata is best-effort and depends on CORS/ICY support.

## User data
- Favorites + recently played are stored in browser localStorage per device.
- Copied track history is stored in localStorage per device.
- Winamp skin selection is stored in localStorage:
  - preset skin persists across reloads
  - uploaded `.wsz` is session-only and falls back to preset after reload

## Cache
- Catalog cached for 30 minutes in localStorage.
- Clear cache via Settings screen.
- Local fallback catalog lives at `apps/webapp/public/catalog-fast.json`.
- Update fallback catalog with `npm run catalog:update`.

## Winamp skins
- Preset files are served from `apps/webapp/public/winamp-skins`.
- To add presets: copy `.wsz` to that folder and register it in `src/lib/winampSkins.ts`.
- Uploaded skin import supports `.wsz` and `.zip` with Winamp skin assets.

## Deploy (Telegram Mini App)
1. Host `apps/webapp` on HTTPS (Vercel recommended).
2. Create a bot via BotFather and set Web App URL (Menu Button).
3. Set `BOT_TOKEN` + `WEBAPP_URL` in `apps/bot/.env`.
4. Set `VITE_TG_BOT` in `apps/webapp/.env` and redeploy.

## Deploy (VPS)
1. Install Node 18+, Nginx, and certbot.
2. Build webapp:
   ```bash
   npm install
   npm --workspace apps/webapp run build
   ```
3. Serve `apps/webapp/dist` via Nginx (HTTPS required).
4. Run bot:
   - `apps/bot/.env`: `BOT_TOKEN`, `WEBAPP_URL=https://your-domain`
   - use systemd or pm2 to keep it alive.
5. BotFather: set Web App URL to `https://your-domain`.

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

This repo now includes `.github/workflows/deploy-server.yml` for push-to-`main` deploys.

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
- Script runs `npm ci`, builds webapp/api/bot, switches `/opt/RadioAtlas/current` symlink
- PM2 reloads services with the new release
- Keeps only last 5 releases
