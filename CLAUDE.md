# RadioAtlas

Telegram Mini App for global internet radio. npm workspaces monorepo, TypeScript
throughout. Production is live at https://radioatlas.ru and has real listeners.

## What the work is for

This is a business before it is a hobby. Every change should be able to answer
"how does this get RadioAtlas paid?" — and the honest answer is almost always
indirect, because the only thing anyone will ever pay for here is a radio that
plays instantly, remembers what they loved, and gives them a reason to open it
again tomorrow. So the two goals normally point the same way: **make it worth
paying for by making it worth using.**

When they genuinely conflict, say so out loud and let the owner choose. Do not
resolve it silently in either direction, and do not dress up a technical
preference as a business case.

Two standing limits on "earn first", both the owner's own:

- **Never put behind a payment something that already works for free.** Charging
  for what a listener already has is how you lose the listener and the payment.
- **Never fabricate.** No invented listener counts, no padded numbers, no
  station data blended out of popularity to look alive. The product's value is
  that what it says is true.

Infrastructure work — CI, tests, guards, telemetry — earns its place by making
the product shippable or by revealing what is broken for listeners. That is a
real answer to the question above, but it is not a licence to stay there: if a
week of work has produced no change a listener would notice, that is a signal,
not an achievement.

## Layout

| Workspace | What it owns | Entry |
| --- | --- | --- |
| `apps/webapp` | The Mini App: Home, Feed («Лента»), Search, Globe, Library, Лира chat, the player | `src/main.tsx` |
| `apps/api` | Catalog, media/stream proxy, Лира (AI), accounts, billing, observability, station intelligence | `src/index.ts` |
| `apps/bot` | Telegram bot: deep links, `/record`, billing webhooks | `src/index.ts` |
| `apps/extractor` | Optional Java/Gradle service for non-direct audio links. Rarely touched. | — |

`apps/extractor` has no `package.json`, so despite `workspaces: ["apps/*"]` it is
not an npm workspace — `build`/`typecheck`/`test --workspaces` never touch it.

The API is the only process that holds secrets and the only one that talks to
providers (Radio Browser, DeepSeek, Tavily, Cloudflare). The browser gets an
explicit allow-list of fields, never raw provider data.

## Commands

These exist; do not invent others. **There is no linter or formatter in this
project** — no eslint, no prettier. "Run the linter" is not a thing here.

```bash
npm run typecheck          # sources, all workspaces          ~12s
npm run typecheck:test     # test sources (separate, load-bearing) ~11s
npm run test:api           # node:test, 527 tests             ~15s
npm run test:bot           # node:test, 87 tests               ~2s
npm run test:scripts       # ops, deploy and hook guards outside the workspaces ~2s
npm --workspace apps/webapp run test:unit   # vitest, 693 tests ~34s
npm run test:webapp        # Playwright, 240 specs — CI runs it, does NOT gate ~3min
npm run dev:webapp         # + npm run dev:api in a second terminal
npm run build              # api → bot → webapp                ~10s
npm run seo:indexnow       # tell Yandex/Bing the station pages exist (manual)
```

**Neither `npm test` nor CI runs everything.** `npm test` chains typecheck →
api → bot → scripts → Playwright and skips the 693 webapp unit tests; CI runs
those and skips Playwright. Run `test:unit` yourself for any webapp change.

`seo:indexnow` is deliberately NOT part of the deploy. IndexNow is for URLs
that changed, and resubmitting all 5 000 on every push is what the protocol asks
you not to do — run it when the page set actually moves. It reaches Yandex and
Bing; **Google does not participate**, and Search Console is the owner's to do
by hand, once. The key file lives in `apps/webapp/public/` and must be deployed
before a submission can succeed.

## Verifying your own work

**Check exit codes, never the tail of the output.** These commands run per
workspace, so `npm run typecheck:test | tail -2` prints the last workspace's
banner and hides a failure in an earlier one. That has already reached CI once.

```bash
npm run typecheck > /tmp/t.log 2>&1; echo "exit=$?"
```

A task is done when:

1. `typecheck` and `typecheck:test` pass by exit code.
2. The suites covering what you touched pass by exit code. API change → `test:api`.
   Webapp change → `test:unit` and `test:webapp`.
3. Behaviour changed → `PLAN.md`, `RUNBOOK.md` or `SPEC.md` updated to match.
4. Commands, architecture or workflow changed → this file and `.claude/rules/`
   updated in the same commit. Stale instructions are worse than none.

CI runs Playwright in a separate job that **reports without gating**
(`continue-on-error`), because specs that flake under parallel load make a gate
people stop believing. So a green CI still does **not** mean the webapp is
verified — check that job, and run the suite locally for UI work.

## Things you cannot infer from the code

- **`git push` to `master` IS the production deploy.** GitHub Actions builds on
  the VPS and switches the release. There is no separate deploy command, no
  staging. Push only when the change is verified.
- **Node 24+** (`engines`, CI on 24.19.x, the VPS runs 24.19.0). `node:sqlite`
  needs it.
- **Secrets live only on the server** in `/opt/RadioAtlas/shared/env/*.env`.
  Never print a secret value, not even to check it is set — print its presence.
- **The VPS is shared** with other services and its 2GB swap is full. Memory
  work must lower our peak rather than raise a limit.
- **`PLAN.md` `## Next:`** is the source of truth for what to do next.
  `RUNBOOK.md` is commands, env vars and past incidents — read it before
  diagnosing anything on production.
- Production access: `ssh rodnya` (see `.claude/rules/windows-shell.md` first,
  the system ssh on this machine is broken).

## What refuses to run

`.claude/hooks/` blocks a few commands outright, before the permission layer and
in every mode, because each one has already cost this project something:
recursive force-deletes, anything that discards uncommitted work (`git reset
--hard`, `git clean -f`, `git checkout --`), force pushes, `pm2 update` (it
hangs on this box and takes the neighbours' apps down with it), and writes to
any `.env`. Reading a `.env`, `apps/api/data/` or a catalogue artifact is denied
too. Only two classes still ask: things that spend money (`artwork:generate`,
`eval:lira`, `npm publish`) and things that touch the neighbours' services on
the shared box (`systemctl`, `apt-get`). `git push`, `gh workflow run`, `pm2`
and `catalog:update` do NOT ask — the owner works with full access, and a
dialog on every ordinary action is noise that trains you to click through the
one that mattered. Force-pushing is refused outright, not asked about.

If one of these is genuinely the right move, say which and let the developer run
it; do not look for a way around the guard.

## How this project works

Measurement beats plausibility. Several "obvious" optimisations here were
measured and rejected, and two "fixes" made things worse. When you change
something for performance or reliability, measure before and after — and run
each variant in its own process, because GC lag makes whichever runs second look
worse.

**Two points are not a trend, and a stable number is not a growing one.** Both
mistakes were made in a single investigation on 2026-08-23/24, hours apart:

- *"RSS grows ~19 MB an hour and never plateaus"* — from samples at 2 h and 19 h
  of uptime. A 25-point series taken afterwards showed RSS **falling** 484 → 351
  MB in a comparable window, and `external` stepping up early and then flat at
  ~65 MB. The older note it "corrected" — nothing leaks, the working set
  saturates — had been right all along.
- *"196 socket descriptors leak every four hours"* — from ONE reading. The next
  one, 2.5 hours later, said 195. A stable pool, not a leak.

Both were stated confidently, both were wrong, and each sent hours after a
phantom. Before naming a cause: how many samples, over what span, and does the
number come back down by itself? A saturating ratchet and a leak are
indistinguishable until you watch one long enough to stop. If the answer is two
samples, the honest sentence is "I do not know yet".

Do not weaken a test to make it pass. Touch-target floors, overflow assertions
and visual tolerances are product contracts; a flaky measurement is the bug.
