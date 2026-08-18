# RadioAtlas

Telegram Mini App for global internet radio. npm workspaces monorepo, TypeScript
throughout. Production is live at https://radioatlas.ru and has real listeners.

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
npm --workspace apps/webapp run test:unit   # vitest, 604 tests ~34s
npm run test:webapp        # Playwright, 240 specs — CI runs it, does NOT gate ~3min
npm run dev:webapp         # + npm run dev:api in a second terminal
npm run build              # api → bot → webapp                ~10s
```

**Neither `npm test` nor CI runs everything.** `npm test` chains typecheck →
api → bot → scripts → Playwright and skips the 604 webapp unit tests; CI runs
those and skips Playwright. Run `test:unit` yourself for any webapp change.

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

Do not weaken a test to make it pass. Touch-target floors, overflow assertions
and visual tolerances are product contracts; a flaky measurement is the bug.
