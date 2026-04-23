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

Next: burn in the compact Home and new low-power shell mode on real Telegram traffic, verify that metadata polling and glass/animation degradations actually reduce budget-phone lag, then continue trimming the remaining `webamp-core-vendor` / `styles.css` weight for post-boot responsiveness.
