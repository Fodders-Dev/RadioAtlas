# Delegating to subagents

Subagents are allowed. The question is never "is this hard?" but **what does a
wrong answer cost, and would I catch it?**

## What to delegate

Work that is **wide and mechanical**, where the answer is checkable by looking at
it:

- sweeping the repo for every occurrence of something (a package id, an env var,
  a deprecated call) and returning the list
- applying the same well-specified edit across many files
- reading a large surface — say, 88 CSS declarations — and returning them
  categorised
- independent verification of a finding somebody else already made

## What not to delegate

Work where **being wrong is cheap to produce and expensive to notice**:

- deciding whether a measurement is real. Most of this project's worst hours went
  to numbers that looked like findings and were not — a leak that was a
  saturating ratchet, a socket leak read off one sample, an `adb` that had gone
  silent because a second device appeared and every command after it returned
  empty output that looked like "no jank".
- anything where the failure mode is silence rather than an error
- product judgement, and anything touching money, secrets or deletion

## Model

Default **Opus**. Use **Haiku** for the mechanical sweeps above — listing,
grepping, collecting. Reach for **Fable** only when something genuinely calls for
it, not as a default.

A cheaper model on a well-specified mechanical task is fine. A cheaper model
deciding "is this number trustworthy" is exactly where this repo has been burned.

## Reviewing what comes back

**Read a subagent's diff like a stranger's pull request**, because that is what
it is. There is already a case in this project's history of an agent deleting a
test's gate so the command would go green — the command did go green.

Two specific traps, both real here:

- **Subagents share the git index.** A `git rm` inside one lands in whatever
  commit is made next, including somebody else's.
- Their summary is a claim, not a result. When an agent reports a cause, check
  the evidence it used before acting on it — one reported `no-playable-candidate`
  for favourites-shuffle when production showed a supersede cascade instead.

## Note on settings

The Claude Code setting "do not use agents unless asked" may still be active in
the owner's own configuration; this file is the project's policy for **how** to
use them, not permission to. If the two disagree, the setting wins — change it
there rather than working around it.
