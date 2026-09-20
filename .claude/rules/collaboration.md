# Shared workflow — Codex and Claude

## Owner's Codex model split (2026-09-20)

The owner explicitly requests GPT-6 Astra to plan, inspect and review, with
GPT-5.6 Luna implementing code through subagents. Keep this workflow across
sessions unless the owner changes it. This authorizes bounded Luna delegation;
it does not authorize uncontrolled fan-out or deployment.

- Astra reads current state, chooses scope and gives Luna precise file ownership,
  expected behavior, preserved contracts and verification commands. Send only
  relevant context rather than the full conversation to limit token cost.
- Delegate implementation to `gpt-5.6-luna`. Astra may maintain plans/handoff
  documents directly, but should not silently take over routine coding.
- Astra independently reviews diffs, test evidence and rendered UI. Luna's
  completion report is not verification or design approval. Return concrete
  defects to Luna for correction.
- One implementation owner per file; serialize shared browser-suite resources.
  If Luna is unavailable, report that rather than silently changing this split.
- Continue the standing review-before-publication rule for design work.

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
- Handoff states: commit/branch, user-visible result, checks actually performed,
  known limitations and the single next action. A clean commit beats a long
  narrative; an incomplete slice must be labelled incomplete.
