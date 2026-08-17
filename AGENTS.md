# AGENTS.md

Instructions for AI coding agents working on RadioAtlas.

**The current, maintained instructions live in [`CLAUDE.md`](./CLAUDE.md).**
Read that file first — it holds the layout, the real commands, the definition of
done, and the facts that are not inferable from the code (push to `master` is
the production deploy; CI runs Playwright without gating on it; there is no linter
in this project).

Deeper, situational guidance lives in `.claude/rules/`, loaded by Claude Code
when the matching files are touched, and useful to any agent that reads them
directly:

| File | Covers |
| --- | --- |
| `.claude/rules/windows-shell.md` | This machine: the broken system ssh, backslash mangling |
| `.claude/rules/api.md` | `apps/api`: what may reach the browser, persistent files, telemetry |
| `.claude/rules/webapp.md` | `apps/webapp`: cold-start budget, playback rules, analytics |
| `.claude/rules/e2e-tests.md` | The Playwright suite and how not to "fix" a flake |

And the long-form project documents:

- `PLAN.md` — project state; `## Next:` is what to do next
- `RUNBOOK.md` — commands, env, deploy, incident history
- `SPEC.md` — product and UX expectations
- `README.md` — setup and deployment overview

<!--
History: until 2026-08-16 this file described a Winamp-style player shell, a
"Winamp bridge" to harden, and `.wsz` skin support. All of that was removed from
the runtime months earlier (see PLAN.md 17.0 and 17.9) — the file had simply not
been touched since April. A companion CODEX_RULES.md from January prescribed a
DONE/FILES/RUN/NEED response format and a from-scratch MVP definition of done,
both long obsolete; it was removed rather than rewritten. Keep this file thin
and pointing at CLAUDE.md so it cannot drift like that again.
-->
