# RadioAtlas (Telegram Mini App)

Monorepo with Telegram bot + webapp MVP.

## Structure
- `apps/webapp` - Telegram Mini App (React + Vite)
- `apps/bot` - Telegram bot (grammY)
- `apps/api` - API proxy (catalog + stream proxy)
- `apps/extractor` - NewPipe-style extractor service (YouTube blocked)

## Requirements
- Node.js 24+
- npm 10+
- Java 17+ (optional, for extractor)

## Quick start
```bash
npm install
npm run dev:webapp
```

For the complete local web stack, run the API in a second terminal:
```bash
npm run dev:api
```
Without it the UI still opens, but Vite will log expected `/api/image` proxy
errors and API-backed images/features will use their fallbacks. Run
`npm run dev:bot` separately only when testing Telegram bot flows.

## Tests
```bash
npm run test:webapp
```

## Deploy mini app
1. Create bot via BotFather and grab `BOT_TOKEN`.
2. Deploy `apps/webapp` to Vercel (or any https host).
3. Set bot WebApp URL in BotFather (Menu Button -> Web App).
4. Configure envs and redeploy:
   - `apps/bot/.env`: `BOT_TOKEN`, `WEBAPP_URL`, optional `WEBAPP_DEEPLINK`
   - `apps/webapp/.env`: `VITE_TG_BOT=your_bot_username`

## Deploy mini app (VPS)
1. Requirements: domain + HTTPS (Telegram WebApp requires HTTPS).
2. Build webapp:
   ```bash
   npm install
   npm --workspace apps/webapp run build
   ```
3. Serve `apps/webapp/dist` with Caddy, which also reverse-proxies `/api` -> `127.0.0.1:3001`.
4. Run bot with systemd or pm2 using `.env`:
   - `BOT_TOKEN`, `WEBAPP_URL=https://your-domain`, optional `WEBAPP_DEEPLINK`
5. Set BotFather WebApp URL to `https://your-domain`.

## Optional API proxy
Run `apps/api` on VPS and set:
```
VITE_API_URL=https://your-domain/api
```
This enables catalog proxying and http stream playback via `/api/stream`.
If `VITE_API_URL` is not set, webapp runs without API proxy by default.

## Optional generated station atmosphere

RadioAtlas can fill selected immersive backgrounds (the Home hero, active Feed,
and Full Player) with cached `country + vibe` scenes from Cloudflare Workers AI.
Station cards, the dock, Media Session, and every identity/avatar surface keep
the station owner's logo (then favicon, then procedural fallback). Generation
never runs in the browser and never blocks playback.

Configure `apps/api/.env`:

```env
SCENE_ARTWORK_ENABLED=1
CLOUDFLARE_ACCOUNT_ID=your_account_id
CLOUDFLARE_API_TOKEN=your_workers_ai_token
SCENE_ARTWORK_DIR=/absolute/persistent/path/scene-artwork
SCENE_ARTWORK_DAILY_CAP=60
INTERNAL_WEBHOOK_TOKEN=your_existing_internal_token
```

The Cloudflare token needs Workers AI Read and Edit permissions. Start the API,
then seed up to 50 high-value scenes through the protected batch command:

```powershell
$env:RADIOATLAS_API_URL='http://127.0.0.1:3001'
$env:INTERNAL_WEBHOOK_TOKEN='same-value-as-apps-api-env'
npm run artwork:generate
```

Pass station UUIDs after the command to generate a specific set. Cached images
(JPEG from the current FLUX endpoint, with PNG compatibility) are reused across
stations with the same country/vibe key; repeated app views do not call the
generation provider again.

## Optional extractor (NewPipe-style, YouTube blocked)
The extractor resolves non-direct URLs (SoundCloud, Bandcamp, PeerTube, MediaCCC)
and returns audio stream URLs.

Run locally:
```bash
cd apps/extractor
gradle run
```

Wire API to extractor:
```
EXTRACTOR_URL=http://127.0.0.1:4001
```
Then use the "Extract streams" button in Search → Links.

### Env
`apps/bot/.env`:
```
BOT_TOKEN=...
WEBAPP_URL=https://your-webapp-url
API_URL=https://radioatlas.ru/api
AI_ENABLED=0
WEBAPP_DEEPLINK=https://t.me/your_bot?startapp=radio
```

`apps/api/.env`:
```
AI_ENABLED=0
DEEPSEEK_API_KEY=
```

`apps/webapp/.env`:
```
VITE_TG_BOT=your_bot_username
VITE_API_URL=https://your-domain/api
VITE_AI_ENABLED=1
```

Lira is visible by default in Vite development. Production builds require
`VITE_AI_ENABLED=1`; actual replies also require the API process with
`AI_ENABLED=1` and `DEEPSEEK_API_KEY` configured.

## Notes
- Webapp pulls stations from Radio Browser and filters https streams.
- Favorites and recently played are stored locally in the browser.
- Station catalog source: https://docs.radio-browser.info/ (community-maintained).
- Primary player mode is the RadioAtlas dock + native Full Player overlay.
- A decorative Lite/Winamp easter egg remains behind `?winamp=1` or the R++ brand gesture; Skin Lab and `.wsz` imports are no longer runtime features.

## Legacy debug tools
- One-off webapp debug scripts were moved to `tools/legacy-debug/webapp`.
- They are not part of regular app runtime or CI and are kept only for manual diagnostics.
