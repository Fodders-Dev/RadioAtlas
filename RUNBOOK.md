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

## Cache
- Catalog cached for 30 minutes in localStorage.
- Clear cache via Settings screen.

## Deploy (Telegram Mini App)
1. Host `apps/webapp` on HTTPS (Vercel recommended).
2. Create a bot via BotFather and set Web App URL (Menu Button).
3. Set `BOT_TOKEN` + `WEBAPP_URL` in `apps/bot/.env`.
4. Set `VITE_TG_BOT` in `apps/webapp/.env` and redeploy.
