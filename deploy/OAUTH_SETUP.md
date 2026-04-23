# OAuth Setup

Canonical production domain: `https://radioatlas.duckdns.org`

Production callback values used by the app:

- Google web origin: `https://radioatlas.duckdns.org`
- VK redirect URI: `https://radioatlas.duckdns.org/api/auth/vk/callback`

## Telegram

Telegram browser login is implemented in code, but Telegram itself will reject the widget until the bot owner enables the production domain in `@BotFather`.

Required production values:

- `VITE_TG_BOT=radioatlasbot`
- `VITE_TELEGRAM_WEB_LOGIN=1` only after the bot domain is approved

Required bot-side step:

1. Open `@BotFather`
2. Run `/setdomain`
3. Select `@radioatlasbot`
4. Set the domain to `radioatlas.duckdns.org`

Until that is done, the web app intentionally falls back to the Telegram deep-link flow instead of showing a broken widget.

## Google

The current implementation uses Google Identity Services in the browser and verifies the returned credential on the API side.

Required production values:

- `VITE_GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_ID`

For this app they should be the same Google Web Client ID.

Google’s current docs say:

- Web apps must use HTTPS origins and redirect URIs.
- For browser-based GIS usage, you register authorized JavaScript origins.
- Redirect URIs are required for web-server code flow, but not for pure JavaScript GIS sign-in.

Official references:

- [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Sign-In for server-side apps](https://developers.google.com/identity/sign-in/web/server-side-flow)
- [OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies)

Recommended Google Cloud setup:

1. Open Google Cloud Console and create/select the project for RadioAtlas.
2. Configure the consent screen / branding page.
3. Create an OAuth client of type `Web application`.
4. Add `https://radioatlas.duckdns.org` to Authorized JavaScript origins.
5. If you want local browser testing, also add `http://localhost:4173`.
6. Copy the created Client ID.

Production env mapping:

- API: `GOOGLE_CLIENT_ID=<client_id>`
- Webapp: `VITE_GOOGLE_CLIENT_ID=<client_id>`

## VK

The current implementation uses a server-driven redirect flow and requires:

- `VK_CLIENT_ID`
- `VK_CLIENT_SECRET`
- `VK_REDIRECT_URI`

Production value:

- `VK_REDIRECT_URI=https://radioatlas.duckdns.org/api/auth/vk/callback`

Expected VK app settings for this integration:

- application/site type suitable for web auth
- base domain: `radioatlas.duckdns.org`
- trusted / allowed redirect URL: `https://radioatlas.duckdns.org/api/auth/vk/callback`
- credentials to copy: `App ID` / `client_id`, `Secure key` / `client_secret`

The exact field labels can vary in the VK developer portal, but the callback and credential mapping above matches the current server code in `apps/api/src/vkAuth.ts` and `apps/api/src/index.ts`.

## Apply On Server

Once you have the real credentials, run on the VPS:

```bash
cd /opt/RadioAtlas/current
GOOGLE_CLIENT_ID='your-google-client-id.apps.googleusercontent.com' \
VK_CLIENT_ID='your-vk-client-id' \
VK_CLIENT_SECRET='your-vk-client-secret' \
bash deploy/configure-prod-oauth.sh
```

After Telegram domain approval in `@BotFather`, enable the browser widget too:

```bash
cd /opt/RadioAtlas/current
WEBAPP_TELEGRAM_WEB_LOGIN='1' \
GOOGLE_CLIENT_ID='your-google-client-id.apps.googleusercontent.com' \
VK_CLIENT_ID='your-vk-client-id' \
VK_CLIENT_SECRET='your-vk-client-secret' \
bash deploy/configure-prod-oauth.sh
```

If VK needs a non-default callback:

```bash
cd /opt/RadioAtlas/current
GOOGLE_CLIENT_ID='your-google-client-id.apps.googleusercontent.com' \
VK_CLIENT_ID='your-vk-client-id' \
VK_CLIENT_SECRET='your-vk-client-secret' \
VK_REDIRECT_URI='https://radioatlas.duckdns.org/api/auth/vk/callback' \
bash deploy/configure-prod-oauth.sh
```

## Verify

After credentials are applied:

1. Open `https://radioatlas.duckdns.org/api/auth/providers`
2. Expect:
   - `telegram.configured = true`
   - `google.configured = true`
   - `vk.configured = true`
3. Open the account sheet in the web app.
4. If `VITE_TELEGRAM_WEB_LOGIN=1` is set, confirm the Telegram web widget renders without `Bot domain invalid`.
5. Confirm Google button is active.
6. Confirm VK button starts redirect flow.
7. Run `bash deploy/post-deploy-smoke.sh` on the server.
