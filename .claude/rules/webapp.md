---
paths:
  - "apps/webapp/src/**"
---

# Working in apps/webapp

## The cold start is a contract

This runs inside a Telegram WebView on a phone, often on mobile data. Home's
first paint must not pull the Globe, HLS, the fallback catalogue, the playback
runtime, Theme Studio, Lite or the Full Player overlay — those are lazy on
purpose and there are tests asserting it. React is bundled from our own origin;
no CDN import may come back.

## Playback is the product

- **The station never switches by itself.** Camera motion on the Globe, opening
  the Feed, a chip tap, a stream error — none of them may change what is
  playing. Only a direct user action does. This is the repo's oldest hard rule.
- Recovery paths (reconnect, candidate failover, silent-stall watchdog) run
  inside `useAudioPlayer`. When touching them, remember the listener's phone is
  usually in a pocket: a backgrounded tab throttles timers and withholds
  `timeupdate` while audio keeps playing, so anything judged from wall-clock
  time will misfire. Judge from `audio.currentTime` movement instead.

## Analytics

`reportProductEvent` names are typed in `lib/productAnalytics.ts` and must also
be added to the API's allow-list, or the event is rejected with 400 and silently
lost. `play_attempt` counts every play the UI starts, including the ones the
Feed supersedes on the next swipe — the honest success rate is
`play_success / (play_attempt - play_superseded)`.

## Persistence

`usePersistentState` deliberately does not write on mount. Storage writes are
dirty-only, and there is a test asserting that mounting the app rewrites
nothing. Do not "fix" that by writing eagerly.

## Glass: `-webkit-backdrop-filter` comes FIRST

The bundler keeps the last of the pair, and Chrome does not parse the `-webkit-`
spelling, so writing the standard property first deletes it from the production
bundle and the surface ships with no blur. No test can see it — Playwright runs
the unminified dev server — which is how the whole Лира chat shipped flat for
months. `npm --workspace apps/webapp run test:unit` runs the guard;
`scripts/assertBackdropFilterOrder.mjs` is the guard itself.

## Layout rules that are contracts, not preferences

Touch targets ≥ 44px, no document horizontal overflow at 360/390/412, and the
navigation/dock sizes in `PLAN.md`'s UI sections. If an assertion about one of
these fails intermittently, the measurement is racing an animation — see
`.claude/rules/e2e-tests.md`. Never relax the number.
