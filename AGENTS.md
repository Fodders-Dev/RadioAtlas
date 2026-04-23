# AGENTS.md

## Project Snapshot
- This repository is `RadioAtlas`, a Telegram Mini App for global internet radio.
- It is an npm workspaces monorepo:
  - `apps/webapp` - React/Vite Telegram Mini App
  - `apps/bot` - Telegram bot
  - `apps/api` - optional API proxy for catalog and stream proxying
  - `apps/extractor` - optional extractor service for non-direct audio links
- UX target is a mix of Radio Garden navigation and a Winamp-style player shell.
- Main data source is Radio Browser. Prefer `https` streams; `http` streams usually need external open or the optional API proxy.

## Read These First
1. `CODEX_RULES.md` - repo-specific working style; follow it unless direct user instructions override it.
2. `README.md` - repo structure, env, and deployment overview.
3. `PLAN.md` - current project status and the next priority. Keep `Next:` up to date when the task meaningfully changes direction.
4. `RUNBOOK.md` - commands, env vars, audio/debug/deploy notes.
5. `SPEC.md` - product and UX expectations.

## Current State
- Core MVP is already built: bot, webapp, globe/search/browse/favorites flow, mini player, local persistence, and Winamp skin support.
- `PLAN.md` is the source of truth for what is still open.
- Current next item at the time this file was added: harden Winamp bridge transport sync edge cases and add visual regression snapshots.

## Working Agreements
- Default to autonomous execution. If the user asks for something underspecified, choose the next logical step and do it.
- Keep the repo in a runnable state after each meaningful change.
- Avoid unnecessary questions. Ask only when blocked by missing credentials, deployment targets, or an irreversible decision.
- Do not revert unrelated user changes in the worktree.
- When behavior changes, update docs if the change affects setup, workflow, UX, or operations.

## Commands
- Install deps: `npm install`
- Run webapp: `npm run dev:webapp`
- Run bot: `npm run dev:bot`
- Run API proxy: `npm run dev:api`
- Full build: `npm run build`
- Full test suite: `npm test`
- Focused tests:
  - `npm run test:webapp`
  - `npm run test:api`
  - `npm run test:bot`
- Data helpers:
  - `npm run catalog:update`
  - `npm run geo:check`

## Change Checklist
- Run the smallest relevant test set for the files you changed.
- If you touch multiple apps or shared behavior, prefer `npm test`.
- If you change audio, proxying, deep links, or deploy behavior, verify the relevant notes in `RUNBOOK.md`.
- If you complete or supersede a project milestone, update `PLAN.md`.
