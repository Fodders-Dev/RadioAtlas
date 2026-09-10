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

## Model (Claude Code only)

The Sonnet/Opus names and `Agent`/`Workflow` arguments below apply to Claude Code,
not Codex. For Codex use the model available in that task; do not translate these
names into guessed model identifiers. Neither this file nor `multi_agent=true`
authorizes spawning agents: follow the user's current delegation preference.

**Subagents run on Sonnet. Opus is the main loop, and its job is to check the
result.** The owner set this on 2026-09-08; it replaces the earlier "default
Opus" in this file, which was wrong about where the money goes.

Pass `model: 'sonnet'` explicitly — in `Agent`, and in every `agent()` step of a
`Workflow`, verification steps included. Without it the subagent inherits the
parent's model and quietly becomes Opus.

The reason is measured, not frugality for its own sake. Two inventory fan-outs in
one session cost 1.46M and 2.07M subagent tokens for work that is "open the file
and write down what is there". And the quality did not come from the model: the
adversarial second pass rejected 21 of ~267 claims — wrong line numbers, two
fabricated UI strings — so what caught the errors was **the check**, not a more
expensive collector.

So: a cheaper model on a well-specified mechanical task is fine, and the check is
mechanical too — it opens `file:line` and compares. What is NOT delegated at any
model is the judgement above ("What not to delegate"), and the final read of what
comes back stays with Opus in the main loop.

## Reviewing what comes back

**Read a subagent's diff like a stranger's pull request**, because that is what
it is. There is already a case in this project's history of an agent deleting a
test's gate so the command would go green — the command did go green.

Two specific traps, both real here:

- **Subagents in the same checkout share its git index.** A `git rm` inside one
  lands in whatever commit is made next, including somebody else's. Separate
  Git worktrees have separate working files and indexes, but share refs/history.
- Their summary is a claim, not a result. When an agent reports a cause, check
  the evidence it used before acting on it — one reported `no-playable-candidate`
  for favourites-shuffle when production showed a supersede cascade instead.

## Note on settings

The Claude Code setting "do not use agents unless asked" may still be active in
the owner's own configuration; this file is the project's policy for **how** to
use them, not permission to. If the two disagree, the setting wins — change it
there rather than working around it.
