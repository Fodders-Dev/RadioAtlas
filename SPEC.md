# SPEC

## Product
Telegram Mini App for global internet radio. UX blends Radio++ (search/table/My Stations) and Radio Garden (globe + bottom navigation + mini player). Product name: RadioAtlas.

## UX patterns (from references)
- Radio++: tabs for Find Station / My Stations / Preferences; search field; table with Name/URL.
- Radio Garden: globe with station dots; bottom nav Explore / Favorites / Browse / Search / Settings; persistent mini-player.

## Screens
- Explore
  - Orthographic globe with animated spin + station dots.
  - Timezone meridians, zoom controls, pause rotation.
  - Tap a dot to start playing.
  - Trending list underneath.
- Favorites
  - My Stations (favorites) list.
  - Recently played list.
- Browse
  - Continent → country → stations list.
- Search
  - Debounced search by name/tags/country/language.
  - Filters for country, genre tags, language.
  - Table-style list (Name + Stream URL).
- Settings
  - Clear cache/favorites/recent.

## Mini player
- Always visible at bottom.
- Prev/Next, Play/Pause, station title, location, favorite toggle, share, open external, volume.
- Status: buffering/playing/error.
- Track info can be copied and saved locally.
- Share uses bot deep link when configured.

## Streaming
- HTML5 audio with auto-reconnect on error/stall.
- HLS via lazy `hls.js` only when needed.
- Media Session API best-effort.
- Now playing metadata via ICY headers is best-effort (depends on CORS/stream).
- External open fallback for blocked streams.

## Data
- Radio Browser API (https).
- Catalog includes http/https; http streams open externally in production.
- Cache catalog in memory + localStorage (TTL 30 min).
- Favorites, recently played, and copied tracks live in localStorage on device (no server sync yet).

## Telegram constraints
- WebApp runs inside Telegram WebView; keep bandwidth low.
- Use `Telegram.WebApp` to `ready()`/`expand()` and `openLink()`.
- Deep link for startapp and `/start` CTA button.
- Start parameter `station_<uuid>` can auto-play shared stations.
