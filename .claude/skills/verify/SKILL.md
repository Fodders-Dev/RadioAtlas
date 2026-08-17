---
name: verify
description: Run this project's real verification sequence and report the result by exit code. Use before committing, before pushing (push = production deploy), or whenever asked whether a change is safe to ship.
argument-hint: "[api|webapp|bot|all]"
---

# Verify a change in RadioAtlas

Run the suites that cover what changed, and judge by **exit code**. Every command
below runs per workspace, so piping to `tail` shows the last workspace's banner
and hides an earlier failure — that has already reached CI once.

## Always

```bash
npm run typecheck > /tmp/v-tc.log 2>&1;      echo "typecheck=$?"
npm run typecheck:test > /tmp/v-tct.log 2>&1; echo "typecheck:test=$?"
```

On a non-zero exit: `grep "error TS" /tmp/v-tc.log | head`.

## By area

| Changed | Run |
| --- | --- |
| `apps/api/**` | `npm run test:api` |
| `apps/bot/**` | `npm run test:bot` |
| `apps/webapp/src/**` | `npm --workspace apps/webapp run test:unit` **and** `npm run test:webapp` |
| `apps/webapp/tests/**` | `npm run test:webapp` |
| `scripts/**`, `deploy/**` | `npm run test:scripts` |
| anything wide | `npm test` |

Playwright (`test:webapp`) takes ~3 minutes. CI runs it in a job that reports
without gating, so a green CI tick still does not mean the webapp is verified —
either open that job or run the suite yourself. Run it in the background and read
its exit code rather than watching it.

## Reading a Playwright result

240 specs. A run of 238–240 is not automatically fine and not automatically
noise:

- The same spec failing on the same line twice → a real defect. Investigate.
- Different specs each run, all passing in isolation → reproduce first with
  `npx playwright test <spec> --repeat-each=12 --workers=6` before changing
  anything. Do not fix by relaxing an assertion; see
  `.claude/rules/e2e-tests.md`.
- Two known-stale visual baselines (`visual.spec.ts`, library + theme studio)
  diff 0.05–0.06 against a 0.04 tolerance and are waiting for the design pass.

## Before a push

`git push` to `master` deploys to production. Additionally:

```bash
npm --workspace apps/api run build > /tmp/v-build.log 2>&1; echo "build=$?"
```

and confirm `PLAN.md` / `RUNBOOK.md` / `SPEC.md` describe the new behaviour, and
that `CLAUDE.md` and `.claude/rules/` still tell the truth about commands and
workflow. Then report: what ran, the exit codes, and what you did not run.
