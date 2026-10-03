# Shared workflow — Codex and Claude

## Owner's Codex workflow (updated 2026-09-30)

The owner adopted GPT-6.1 Sol as the main developer and coordinator, replacing
the mandatory Astra-to-Luna split. Sol handles a bounded task end to end:
inspect, plan, implement, test, review the diff and rendered result, document.
This authorizes purposeful delegation; it does not authorize uncontrolled
fan-out or deployment.

- Use `gpt-6.1-sol` at High for ordinary multi-step development. Adjust effort
  to the task rather than automatically using Extra High.
- Use `gpt-6-luna` at Medium/High for small, clear tasks when delegation saves
  work. Give file ownership, expected behavior, preserved contracts and checks;
  send relevant context rather than the whole conversation.
- Use `gpt-6-astra` for important product/architecture decisions, difficult
  playback diagnosis or independent review of substantial changes. Do not
  require a separate Astra turn for every small fix.
- The main developer independently checks agent changes and rendered UI.
  An agent report or green tests do not constitute design approval.
- Keep one implementation owner per file and serialize shared browser suites.
  Report model unavailability; do not silently substitute or expand scope.
- Keep the standing review-before-publication rule for design work. Track state,
  acceptance criteria and verification in the repository, not only chat history.

Read this when starting or handing off project work. Tool/model names specific to
one client do not become instructions to invent equivalent tools in another.

- One implementation owner per checkout and per user-visible slice. Use separate
  branches/worktrees for simultaneous Codex/Claude work. Confirm cwd, branch,
  HEAD and status before edits. Never move or clean somebody else's worktree.
- The saved WIP checkpoint is not an accepted design or a release candidate.
  `git push` to master deploys; local checkpoint/feature commits do not.
- Common product decisions belong in PRODUCT/PLAN/SPEC, operational facts in
  RUNBOOK, active handoff in docs/WORKING-SETUP.md. Update the relevant record;
  do not copy whole chat transcripts into instructions or repeat old inventories.
- Codex project default: High reasoning. Medium is suitable for a small known
  edit; Extra High for a hard diagnosis/review. Respect an explicit task choice.
  Keep the user's selected model. No automatic agent fan-out without permission.
- Read/search the relevant implementation first. After a bounded change, run its
  targeted checks; before treating it as a ready implementation, run the required
  source/test typechecks and affected suites in CLAUDE.md. No duplicate full
  runs without a new change/failure. Report untested layers explicitly.
- Capture and inspect real browser screens for UI changes. State-driven mock
  tests do not prove audio; physical iPhone background playback needs a device
  check. Pixel metrics do not establish artistic quality.
- Use `npm run dev:local` for an isolated API/Vite pair. Its stores are under this
  checkout's `.tmp/dev-local`, not apps/api/data or another agent's data. Never
  copy production .env files into a worktree. Do not share mutable node_modules
  via junctions; `npm ci` uses the machine's package cache with independent files.
- Run full functional browser suites serially across worktrees on this machine:
  the current Playwright config fixes the API port at 4311. Different Vite ports
  alone do not isolate that suite. Dev ports (5184/4341) do not collide with it.
- Run the actual serial functional lane directly from the webapp workspace in
  PowerShell:
  ```powershell
  $env:PLAYWRIGHT_SKIP_PIXELS='1'; npm --workspace apps/webapp run test:e2e:ci
  ```
  That script supplies `--workers=1`; do not append the worker flag to the root
  `npm run test:webapp` wrapper, which drops it before Playwright.
- Handoff states: commit/branch, user-visible result, checks actually performed,
  known limitations and the single next action. A clean commit beats a long
  narrative; an incomplete slice must be labelled incomplete.
