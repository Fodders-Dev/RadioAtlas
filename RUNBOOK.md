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
- GitHub Actions uploads a source archive over SSH.
- The server creates a new release in `/opt/RadioAtlas/releases/<timestamp>-<sha>`.
- Shared env files from `/opt/RadioAtlas/shared/env` are linked into the release.
- `npm ci`, `npm run build`, and `pm2 startOrGracefulReload` run on the server.
- `/opt/RadioAtlas/current` is switched to the new release after a successful build.

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
