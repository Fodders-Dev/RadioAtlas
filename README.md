# RadioAtlas (Telegram Mini App)

Monorepo with Telegram bot + webapp MVP.

## Structure
- `apps/webapp` - Telegram Mini App (React + Vite)
- `apps/bot` - Telegram bot (grammY)

## Requirements
- Node.js 18+
- npm 9+

## Quick start
```bash
npm install
npm run dev:webapp
npm run dev:bot
```

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
3. Serve `apps/webapp/dist` with Nginx or Caddy.
4. Run bot with systemd or pm2 using `.env`:
   - `BOT_TOKEN`, `WEBAPP_URL=https://your-domain`, optional `WEBAPP_DEEPLINK`
5. Set BotFather WebApp URL to `https://your-domain`.

## Optional API proxy
Run `apps/api` on VPS and set:
```
VITE_API_URL=https://your-domain/api
```
This enables catalog proxying and http stream playback via `/api/stream`.

### Env
`apps/bot/.env`:
```
BOT_TOKEN=...
WEBAPP_URL=https://your-webapp-url
WEBAPP_DEEPLINK=https://t.me/your_bot?startapp=radio
```

`apps/webapp/.env`:
```
VITE_TG_BOT=your_bot_username
VITE_API_URL=https://your-domain/api
```

## Notes
- Webapp pulls stations from Radio Browser and filters https streams.
- Favorites and recently played are stored locally in the browser.
- Station catalog source: https://docs.radio-browser.info/ (community-maintained).
