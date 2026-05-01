# RadioAtlas Test Plan

## Scope

Primary target: Telegram Mini App WebView at 360-395px width. Desktop is a secondary control surface.

The current QA goal is to prove the core listening loop:

`open app -> start personal radio -> switch station -> search/globe/library still work -> player remains usable`.

## Preflight

- `npm run build`
- `npm test`
- Local smoke:
  - `npm run dev:api`
  - `npm run dev:webapp`
  - open `http://localhost:5173/?api=/api`

## Mobile Browser Smoke

Viewport: `390x844`, then repeat overflow checks at `360x780` and `412x844`.

1. Home first paint
   - Home opens without a blank state.
   - "Играть радио" CTA is visible.
   - At least one compact station rail is visible.
   - No visible recommendation reason copy like "по твоим лайкам" / "похоже на".
   - No horizontal page overflow.

2. Personal Radio
   - Tap "Играть радио".
   - Player dock shows the active station.
   - Next button switches station from the queue.
   - Like toggles without layout shift.
   - Mute toggles from the dock.

3. Search
   - Open bottom nav "Поиск".
   - Type a real query, e.g. `jazz japan`.
   - Results stay compact and playable.
   - Play from Search starts a queue, not a dead-end single station.

4. Globe
   - Open bottom nav "Глобус".
   - Canvas and bottom sheet are visible.
   - "Tune here" / regional play action works.
   - No mobile hint mentions desktop scroll wheel.

5. Library
   - Open bottom nav "Медиатека".
   - Tabs do not wrap on mobile.
   - Collections/Recent/Queue areas scroll.
   - Queue reflects the current player queue.

6. Station details / expanded player
   - Open station details from the player.
   - Trust, stream/site actions, report broken, hide/show recommendation controls are visible.
   - Expanded player opens and closes without breaking the dock.

7. API fallback
   - Simulate `/catalog/summary` failure.
   - Home still shows playable station choices via fallback, or shows the one-shot status banner only when both API and fallback fail.

## Desktop Smoke

Viewport: `1280x900`.

1. Home rails expose left/right arrow controls.
2. Mouse wheel or trackpad scrolls station rails horizontally.
3. Search filter drawer and results remain usable.
4. Expanded player opens from the dock.

## Regression Gate

- `npm --workspace apps/webapp run test:e2e -- mobile.spec.ts`
- `npm --workspace apps/webapp run test:e2e -- visual.spec.ts`
- `npm --workspace apps/api run test`
- `npm --workspace apps/bot run test`
- Full gate: `npm test`

## Release Blockers

- Blank or single-card Home on 360-395px.
- Any horizontal overflow on Home/Search/Globe/Library mobile.
- Personal Radio cannot start in one tap.
- Broken station remains primary after failure.
- Search exact playable match ranks below weak/promoted matches.
- Public collections, marketplace, paid packs, Stars billing, editorial portal, owner dashboard, or station claims become visible before a separate product decision.
