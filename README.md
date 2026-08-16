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
npx playwright install chromium   # once per Playwright version, see below
npm run test:webapp
```

`npm run test:webapp` is the Playwright end-to-end suite, and it is the only
suite here that needs a real browser binary. Nothing in this repository ever
downloads one: Playwright ships no install hook, so `npm install` does not fetch
a browser, no npm script calls the installer, and the CI workflow deliberately
stops before the end-to-end step. On a fresh clone the suite therefore dies at
launch with `browserType.launch: Executable doesn't exist at ...`, and the only
reason it ever seems to work without the extra command is that some other
project on the same machine already populated Playwright's shared browser cache.
Chromium alone is enough because `apps/webapp/playwright.config.ts` declares no
`projects`, so the suite runs on the default browser and never touches Firefox
or WebKit.

The download is pinned to a browser revision, not to your machine: Playwright
1.57 wants `chromium-1200`, and `@playwright/test` is declared as `^1.47.2`, so
an `npm ci` that lands on a newer minor walks into the same "Executable doesn't
exist" wall with a full cache. Run the install again after a Playwright bump.

The suite also starts its own API and Vite servers on fixed ports. If it aborts
before the first spec with `is already used`, read "Running the E2E suite
locally" in `RUNBOOK.md` — that is a leftover server from an earlier session, not
a broken checkout.

## Deploy mini app
1. Create bot via BotFather and grab `BOT_TOKEN`.
2. Serve `apps/webapp` over HTTPS. For this repository that is the VPS below —
   a push to `master` builds and switches the release, and there is deliberately
   no second deploy target.
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
and Full Player) with station-specific music scenes from Cloudflare Workers AI.
The prompt leads with the station name and curated genres, enriches it with a
bounded snapshot of harvested tracks/artists when available, and treats country
as secondary atmosphere rather than the subject.
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
(JPEG from the current FLUX endpoint, with PNG compatibility) are stable per
station/music identity and style version. Track changes enrich a generation
snapshot but do not mint a new paid image; repeated app views never call the
generation provider.

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
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=
# Alternative provider; switch only after the Lira eval pass:
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-luna
AI_WEB_SEARCH_ENABLED=0
TAVILY_API_KEY=
```

`apps/webapp/.env`:
```
VITE_TG_BOT=your_bot_username
VITE_API_URL=https://your-domain/api
VITE_AI_ENABLED=1
```

Lira is visible by default in Vite development. Production builds require
`VITE_AI_ENABLED=1`; actual replies also require the API process with
`AI_ENABLED=1` and the API key selected by `AI_PROVIDER`. DeepSeek remains the
default; `AI_PROVIDER=openai` uses the OpenAI Responses API and
`OPENAI_MODEL` (default `gpt-5.6-luna`).
Grounded song history, documented author intent, and direct lyrics-page
resolution additionally require `AI_WEB_SEARCH_ENABLED=1` plus
`TAVILY_API_KEY`; without it Lira still provides a safe external lyrics search.
For meaning questions Lira first requests cleaned lyrics-page content as private
analysis context, then returns her explanation, at most one excerpt up to 10
words, and the attributed source link. Lira does not copy full copyrighted
lyrics; user-supplied text can still be analyzed. Full in-app lyrics require an
explicit display licence from a lyrics provider.

Lira keeps one persistent conversation on the current device; reopen it with
the central Lira navigation action. Every message carries the bounded active
station/current-track context when available, so «что сейчас играет?» works as
a normal chat question. Named-artist requests prefer exact dedicated stations
from the RadioAtlas catalog before broader genre matches.

Lira is also a bounded player agent. In the Mini App she can play or pause,
enqueue a verified station, and set its favorite state. A server-side
Supervisor limits runtime/tool calls, policy code validates every proposed
write, the browser resolves stations through the trusted catalog before
execution, and action receipts are fed into the next turn. Agent run traces
and token counts are retained in the existing observability store.

Run the fixed provider comparison after both server-side keys are configured:

```bash
npm run eval:lira -- --provider=both --repeat=3 --out=artifacts/lira-provider-eval.json
```

`npm run eval:lira -- --dry-run` validates the suite without spending tokens or
requiring keys. The report includes replies for manual quality review plus
contract pass rate, median latency, tokens, and an uncached cost estimate.

## Notes
- Webapp pulls stations from Radio Browser and filters https streams.
- Favorites and recently played are stored locally in the browser.
- Station catalog source: https://docs.radio-browser.info/ (community-maintained).
- Primary player mode is the RadioAtlas dock + native Full Player overlay.
- A decorative Lite/Winamp easter egg remains behind `?winamp=1` or the R++ brand gesture; Skin Lab and `.wsz` imports are no longer runtime features.

## Legacy debug tools
- One-off webapp debug scripts were moved to `tools/legacy-debug/webapp`.
- They are not part of regular app runtime or CI and are kept only for manual diagnostics.
