---
paths:
  - "apps/webapp/tests/**"
  - "apps/webapp/playwright.config.ts"
---

# Working on the Playwright suite

240 specs, ~3 minutes, deliberately **outside CI** because flakes in a blocking
gate get the gate switched off. That makes it your job to run it locally for UI
work, and to keep it trustworthy.

## Measuring geometry

`boundingBox()` returns the **transformed** box. Anything measured while a mount
animation is in flight measures the animation. The Feed is the sharp case:
`.station-feed-overlay` animates from `scale(0.965)` over 240ms, so a 44px
control reads 42.46px and misses a 43.5px floor — intermittently, because
parallel load decides whether the round-trip lands inside the window.

```ts
await waitForAnimationsToSettle(page, '.station-feed-overlay');
```

The helper waits only for **finite** animations; the Feed's live dot pulses
forever and waiting on it hangs the test instead of fixing it.

`toBeVisible()` is not a settle gate: Playwright counts an `opacity: 0` element
as visible, so waiting for a fading-in element resolves at t=0 of its animation.

Read several elements' geometry in ONE `page.evaluate` — two `boundingBox()`
calls are two round-trips at different moments, and the test then measures the
difference between its own reads.

## Four things not to do when the suite is red

1. **Do not disable motion** (`emulateMedia({ reducedMotion })`,
   `animations: 'disabled'`) to settle geometry. It quietly changes the subject
   from what a default-settings user gets to what a reduced-motion user gets.
2. **Do not raise a tolerance.** 43.5px, `maxDiffPixelRatio: 0.04`, the overflow
   zero — all product contracts.
3. **Do not add `retries`.** It erases the only signal that separates a defect
   from noise.
4. **Do not conclude from one run.** A control run that passes proves nothing:
   a second control run on the same code failed on the same spec. If a spec
   fails twice on the same line, it is a defect; otherwise reproduce it first
   with `--repeat-each=12 --workers=6`.

## Isolation

A spawned API must get its own `ACCOUNT_STORE_PATH`, `CATALOG_DATA_DIR` and
`OBSERVABILITY_STORE_PATH` in a temp directory. Without them a test wrote its
two fixture stations over the developer's real 70MB catalogue snapshot on every
`npm test`.

The suite starts the API through `apps/api`'s `serve:e2e`, never `dev` —
`dev` is `tsx watch`, and editing an API source mid-run restarts the shared
server and fails whichever specs are mid-request.

Ports: each spawning suite owns a range (34100–37699 are taken). Pick a free one;
an overlap takes down a neighbouring suite, not yours.
