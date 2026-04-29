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
- [x] Mobile UX Stage 1-6 cleanup regressions covered (Home, Globe, Dock, Library, Skin Lab)
- [ ] Optional API proxy for http streams (if needed)

Next: monitor the shipped mobile-safe streaming/fullscreen hardening in prod, then continue deeper bundle cuts for `webamp-core-vendor` and the remaining global `styles.css` selectors, onboarding, stronger Search UX, and the unfinished account layer (shared collections, cross-device history continuity, alerts/follows analytics) before any monetization work.
