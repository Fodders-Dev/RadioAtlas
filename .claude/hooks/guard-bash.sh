#!/usr/bin/env bash
# PreToolUse guard for Bash and PowerShell.
#
# Permission globs are the wrong instrument for this. The docs say so plainly —
# a rule constraining arguments is fragile, `Bash(git reset --hard *)` does not
# match the bare `git reset --hard`, and `Bash(safe *)` matches nothing in
# `cd x && safe`. A hook sees the whole command string, including what is inside
# an `ssh rodnya '...'`, and runs before the permission layer in every mode.
#
# Everything blocked here has already cost this project something. Nothing is
# blocked because it looks scary.
#
# Exit 2 blocks the call and shows the reason to Claude.

set -uo pipefail

payload="$(cat)"

command_text="$(printf '%s' "$payload" | node -e '
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(raw);
    const input = event.tool_input || {};
    process.stdout.write(String(input.command || ""));
  } catch {
    process.stdout.write("");
  }
});
' 2>/dev/null)"

[ -z "$command_text" ] && exit 0

deny() {
  echo "guard-bash: refusing to run this — $1" >&2
  exit 2
}

# A heredoc body is usually DATA, not commands — and in this repo it is nearly
# always a commit message, which routinely quotes the very commands blocked
# below (the first version of this hook refused to commit its own description of
# itself). So the body is scanned only when whatever receives it can execute it.
scanned="$command_text"
case "$command_text" in
  *'<<'*)
    head="${command_text%%<<*}"
    # An interpreter only counts in COMMAND position — at the start of the
    # string or after a pipe, a semicolon or an `&&`. Matching the bare word
    # anywhere made `git add .claude/hooks/guard-bash.sh <<EOF` look like a
    # pipe into a shell, because the filename ends in `.sh`.
    if ! printf '%s' "$head" | grep -Eqi -- '(^|[|;&(]|&&)[[:space:]]*(sudo[[:space:]]+)?(env[[:space:]]+[A-Z_]+=[^[:space:]]*[[:space:]]+)*((ba|z|k)?sh|node|python[0-9.]*|perl|ruby|ssh|docker|pwsh|powershell|xargs|eval)([[:space:]]|$)'; then
      scanned="$head"
    fi
    ;;
esac

# grep -E over the string: a match anywhere counts, so wrapping the command in
# ssh, a subshell or a && chain does not smuggle it past.
has() {
  printf '%s' "$scanned" | grep -Eqi -- "$1"
}

# Recursive force-delete. rm takes its flags in any order and any spelling.
if has '(^|[^[:alnum:]_-])rm[[:space:]]+(-[[:alnum:]]*[rR][[:alnum:]]*[[:space:]]+-[[:alnum:]]*f|-[[:alnum:]]*f[[:alnum:]]*[[:space:]]+-[[:alnum:]]*[rR]|-[[:alnum:]]*[rR][[:alnum:]]*f|-[[:alnum:]]*f[[:alnum:]]*[rR]|--recursive|--force)'; then
  deny "a recursive force-delete. If a directory really has to go, say which one and let the developer run it"
fi

# Throwing away work that is not committed anywhere. The standing instruction
# for this repo is to preserve other people's uncommitted changes.
if has '(^|[^[:alnum:]_-])git[[:space:]]+(reset[[:space:]]+(--hard|--merge)|clean[[:space:]]+-[[:alnum:]]*f|checkout[[:space:]]+--[[:space:]]|restore[[:space:]]+.*--worktree|stash[[:space:]]+(drop|clear)|branch[[:space:]]+-D)'; then
  deny "this discards uncommitted work in the shared tree. Stash it under a name, or show the diff and ask"
fi

# A force push to master IS a production deploy that also rewrites history.
if has '(^|[^[:alnum:]_-])git[[:space:]]+push[[:space:]]+([^;&|]*[[:space:]])?(--force[[:alnum:]-]*|-f)([^[:alnum:]_-]|$)'; then
  deny "a force push. Pushing to master deploys production; rewriting it also breaks the VPS checkout. Resolve the divergence instead"
fi

# pm2 update walks every process on the box. This box is shared, and the last
# time it ran here it hung and took all applications down with it (RUNBOOK).
if has '(^|[^[:alnum:]_-])pm2[[:space:]]+(update|kill)([^[:alnum:]_-]|$)'; then
  deny "pm2 update/kill hangs on this VPS and drops every app on it, ours and the neighbours'. Restart the single process by name instead"
fi

# Secrets are read into variables, never printed. A redirect INTO an env file is
# always wrong from here: production env files are edited by the owner.
if has '>[[:space:]]*[^|;&]*\.env($|[[:space:]]|.[[:alnum:]]+)|(^|[^[:alnum:]_-])(tee|cp|mv)[[:space:]]+[^|;&]*/shared/env/'; then
  deny "writing an env file. Secrets live only in /opt/RadioAtlas/shared/env, maintained by the owner"
fi

exit 0
