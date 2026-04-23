# PLAN

- [x] Monorepo scaffolding (webapp + bot)
- [x] Bot /start with WebApp button + deep link
- [x] WebApp: stations fetch, list, playback, mini-player
- [x] Favorites + Recently (local)
- [x] Explore globe with station dots
- [x] Bottom navigation + screens
- [x] Media Session actions + richer share payloads
- [x] Winamp-only player shell (compact + full overlay)
- [x] Webamp skin presets + `.wsz` upload flow
- [x] Global theme tokens derived from active Winamp skin
- [ ] Optional API proxy for http streams (if needed)

Next: deploy the mobile playback/runtime + authenticated cloud-library sync hardening to live Telegram traffic, verify that logged-in sessions no longer burst `/me/library` during rapid library/search playback, confirm that proxied artwork no longer throws `ERR_CONTENT_LENGTH_MISMATCH` on deploy and that the catalog summary no longer falls back to HTML, then continue trimming the remaining `webamp-core-vendor` / `styles.css` weight for budget-phone responsiveness.
