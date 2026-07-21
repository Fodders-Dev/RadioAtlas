# SPEC

## Product
Telegram Mini App for global internet radio. UX blends Radio++ (search/table/My Stations) and Radio Garden (globe + bottom navigation + mini player). Product name: RadioAtlas.

## UX patterns (from references)
- Radio++: tabs for Find Station / My Stations / Preferences; search field; table with Name/URL.
- Radio Garden: globe with station dots; bottom nav Explore / Favorites / Browse / Search / Settings; persistent player.

## Screens
- Home
  - Primary top surface is one `Лента` / Feed hero card with separate Feed and refresh actions; neither action may overlap or clip the complete subtitle at 360px.
  - The old `Моя волна` Home CTA is retired; its taste signals remain internal ranking input.
  - Home always shows explicit genre shortcuts, personalized discovery rails, resume context, search entry, and the persistent player.
  - Compact discovery rails use one horizontal peek row; they must not expand into half-viewport 2-column cards at 431–600px.
  - Sparse/offline catalog summaries still produce useful fallback rails on both compact and wide layouts.
  - Each station card exposes one primary Play action plus independent secondary actions; duplicate or nested Play controls are not allowed.
- Feed
  - Fullscreen swipe feed of playable stations.
  - Mix is personal-fresh: taste-led recommendations, trends, and a small random slice.
  - Favorites, recent stations, and the currently playing station are excluded before ranking.
  - Card 0 is the strongest available personal pick; each Feed open gets a fresh seed.
  - The active card exposes play/pause; closing Feed restores keyboard focus to Home/navigation.
- Explore
  - Orthographic globe with animated spin + station dots.
  - Timezone meridians, zoom controls, pause rotation.
  - Tap a dot to start playing.
  - Drag/reticle settle only selects a preview. Audio starts from a direct dot tap or the preview Play action, never from camera motion alone.
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
- Lira
  - Opens as an immersive full-screen conversation surface from the central
    navigation action. The visual language is layered Apple-inspired Liquid
    Glass with readable opaque fallbacks for unsupported/contrast modes.
  - The empty state offers one-tap mood/place/genre prompts; the current thread
    persists locally on the device and can be reset from the header.
  - Her voice is a lively, self-possessed music friend with light friendly
    flirting: warm and teasing, never clingy and never romantically reciprocal.
  - Resolves an explicitly named song or the trusted current now-playing track for lyrics and meaning questions.
  - Before explaining a song, the lyrics-analysis lane requests cleaned page
    content from the external search provider when available, reads it as
    untrusted source data, and bases the literal-story analysis on that text.
  - Meaning/context answers separate sourced facts and documented author intent from Lira's interpretation.
  - Copyrighted lyrics are never reproduced in full: Lira returns a clearly
    attributed external source link and, at most, one excerpt up to 10 words.
    User-provided lyrics may be analyzed without being repeated at length. Full
    in-app lyrics require a provider licence that explicitly covers display.
- Settings
  - Clear cache/favorites/recent in one grouped data section with inline confirmation.
  - API status and diagnostics stay collapsed under a developer disclosure.

## Player mode
- Always visible RadioAtlas dock at bottom.
- Live dock can collapse to a single-row controller and keeps that presentation after Full Player closes.
- Tapping dock artwork opens the native Full Player overlay.
- Prev/Next, Play/Pause, station title, location, favorite toggle, share, info, open external, volume.
- Status: buffering/playing/error.
- Track info can be copied and saved locally.
- Share uses bot deep link when configured.
- Theme Studio controls the native shell appearance locally.
- A decorative Lite/Winamp easter egg is hidden behind `?winamp=1` and the R++ brand gesture; Skin Lab and `.wsz` compatibility are not runtime features.

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
- Generated station atmosphere is a separate visual layer, never a replacement
  for owner-provided station logos or Media Session artwork.
- Scene identity is deterministic from country, controlled vibe, and style
  version. Home discovery cards, Feed, and Full Player may prefer a ready cached
  scene; every surface must retain the existing artwork/gradient fallback.
- Browsers have read-only scene access. Only an internal authenticated server
  command may call the image provider, and repeated station views must never
  trigger generation or consume provider quota.
- The generated cache lives outside deploy releases and scene assets are served
  with immutable caching once ready.

## Telegram constraints
- WebApp runs inside Telegram WebView; keep bandwidth low.
- Use `Telegram.WebApp` to `ready()`/`expand()` and `openLink()`.
- Deep link for startapp and `/start` CTA button.
- Start parameter `station_<uuid>` can auto-play shared stations.
