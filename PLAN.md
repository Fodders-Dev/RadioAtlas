# RadioAtlas Active Roadmap: Spotify для радио

## Product Loop

Главный цикл продукта: открыл -> одним тапом запустил подходящее радио -> легко переключил -> приложение запомнило вкус -> завтра стало лучше.

RadioAtlas не должен выглядеть как каталог станций или админка. Пользователь не видит объяснения рекомендаций вроде "по твоим лайкам"; он видит понятные станции, быстрый play и надежное продолжение эфира.

API proxy уже реализован и используется через `VITE_API_URL`. Дальше работаем не над созданием proxy, а над тем, чтобы Home, Search и Personal Radio аккуратно учитывали playability/health сигналы.

## Stages

- [x] Stage 1: "Моя волна" MVP
  - One-tap CTA на Home.
  - Локальный `buildPersonalRadioQueue(...)` на 10-20 станций по taste/playability.
  - Запуск очереди через `playStationQueue(...)` с fallback на следующую станцию, если кандидат не стартует.
  - Базовые public types: `RadioSessionMode`, `RadioSessionEvent`, `RecommendationContext`, `PersonalRadioQueue`.
- [x] Stage 2: Home как музыкальная лента
  - Mobile dense: compact topbar -> "Моя волна" -> недавнее -> 3-5 горизонтальных station rails.
  - Без giant hero на весь экран.
  - Без reason-copy.
  - Desktop: стрелки и wheel/trackpad scroll для station rails.
- [x] Stage 3: Taste Profile V2
  - Сигналы: play started, listened 30s+, early skip, like/unlike, saved, replayed, fail, country/tag/language, time of day, session mode.
  - Decay: свежие действия важнее старых, failures забываются, случайная сессия не ломает профиль.
  - `rankStationsForUser(...)`.
- [x] Stage 4: Station Health V1
  - Локальный + API-assisted health index: reachable, startup time, proxy/direct/HLS success, repeated failures, duplicates.
  - Metadata absence не считается плохим качеством.
  - `resolveBestPlayableCandidate(...)`.
- [x] Stage 5: Now Playing / Track Trust
  - Явно разделить: играет с metadata, играет без metadata, поток сомнительный.
  - Не засорять track history пустыми/повторяющимися строками.
  - Убрать конфликтующие loading/status сообщения.
- [x] Stage 6: Search как быстрый путь к прослушиванию
  - Compact result cards с play overlay.
  - Exact/prefix выше weak/promoted.
  - Recent searches/plays.
  - "Play all results" / "Start radio from this search".
- [x] Stage 7: Library как личная музыкальная память
  - Favorites, Recent, Collections, Queue.
  - Коллекции как плейлисты радиостанций: play, shuffle, reorder, remove, rename.
  - Followed regions/stations запускают playable очереди.
- [x] Stage 8: Cloud sync без трения
  - Telegram auth как основной путь.
  - Sync favorites, recent, collections, followed, taste profile.
  - Combine-first conflict strategy.
- [ ] Stage 9: Globe как discovery mode
  - Tune here, playable bottom sheet, follow region, play region radio.
  - Nearby/current region seed.
- [ ] Stage 10: Retention
  - Continue yesterday, station back online, favorite-station track, new playable region stations, morning/evening mix.
  - Telegram bot notifications only opt-in.
- [ ] Stage 11: Visual identity and artwork
  - Stable generated station covers.
  - Collection mosaic covers.
  - Region mini-art.
- [ ] Stage 12: Player as core product object
  - Compact dock: station, track, play/pause, next, like, mute.
  - Expanded player: artwork, queue, recent tracks, station details.
  - Hide station from recommendations.
- [ ] Stage 13: Station details and trust
  - Country/city/tags, stream health, recent tracks, website, favorite/follow, report broken, open externally.
- [ ] Stage 14: Observability and product analytics
  - Local/API events for open, impression, play attempt/success, startup time, skip, like, search, failure, queue source, session duration.
  - No personal data by default.
- [ ] Stage 15: Telegram mobile hardening
  - 360-395px first.
  - Fast first useful paint.
  - No horizontal overflow on 360/390/412.
  - Lazy heavy surfaces and robust API fallback.
- [ ] Stage 16: Public/shared features later
  - No public collections, marketplace, paid packs, Stars, editorial portal, owner dashboard until core loop is stable.

## Current Acceptance

- Home 390px shows "Моя волна" CTA plus at least six station choices without a giant hero card.
- Home has no visible recommendation reason-copy.
- Personal Radio starts from one tap and builds a queue from playable/taste-ranked stations.
- Failed primary candidates are skipped instead of creating a dead end.
- Desktop station rails have explicit arrows and wheel/trackpad horizontal scroll.
- Taste Profile V2 records play, 30s listen, early skip, like/unlike, collection/save and failure signals locally with decay.
- Station Health V1 records direct/proxy/HLS/extracted success, startup time, repeated failures and metadata misses without treating missing metadata as bad quality.
- Home, Personal Radio and Search ranking use taste/playability/health without showing recommendation reasons.
- Now Playing trust separates real track metadata, passive missing metadata, and questionable stream states.
- Track history auto-saves trusted metadata, rejects technical/filler payloads, and dedupes repeats.
- Player dock and station rows do not show conflicting loading text as the track title.
- Search 390px renders compact station cards with direct play overlay and can start a queue from current results.
- Library collections can play, shuffle, rename, reorder rows, and remove stations from the focused detail view.
- Cloud library sync preserves `tasteProfile` through webapp and API sanitize/merge with combine-first behavior.

## Test Plan

- `npm --workspace apps/webapp run build`
- `npm --workspace apps/webapp run test:e2e -- mobile.spec.ts`
- `npm --workspace apps/webapp run test:e2e -- visual.spec.ts`
- `npm --workspace apps/api run test`
- Full gate before release: `npm test`

## Next:

Stage 9: Globe as discovery mode. Keep it secondary to Home, but make every focused region quickly playable and feed followed regions back into Home/Personal Radio.
