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

Next: monitor the shipped mobile-safe streaming/fullscreen hardening in prod, then continue the remaining roadmap items: deeper bundle cuts for `webamp-core-vendor` / `styles.css`, onboarding, stronger Search and Library UX (filters, recents, collections polish), and the unfinished account layer (shared collections, cross-device history continuity, alerts/follows analytics) before any monetization work.
