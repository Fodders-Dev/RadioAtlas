#!/usr/bin/env bash
# PreToolUse guard for Edit/Write/NotebookEdit.
#
# Permission rules already deny READING .env files. This blocks WRITING to paths
# where a write is either a security problem or destroys something expensive to
# get back. It exists as a hook rather than a permission rule because a hook is
# evaluated before permission rules and cannot be talked out of it mid-task.
#
# Exit 2 blocks the call and shows the reason to Claude.

set -uo pipefail

payload="$(cat)"

# The file path lives at .tool_input.file_path for Edit/Write and
# .tool_input.notebook_path for NotebookEdit. No jq on this machine, so pull it
# with node, which is guaranteed present (the repo requires Node 24+).
target="$(printf '%s' "$payload" | node -e '
let raw = "";
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  try {
    const event = JSON.parse(raw);
    const input = event.tool_input || {};
    process.stdout.write(String(input.file_path || input.notebook_path || ""));
  } catch {
    process.stdout.write("");
  }
});
' 2>/dev/null)"

# Nothing to check (unknown shape) — let the normal permission layer decide.
[ -z "$target" ] && exit 0

normalized="$(printf '%s' "$target" | tr '\\' '/')"

deny() {
  echo "guard-paths: refusing to write $target — $1" >&2
  exit 2
}

case "$normalized" in
  *.env|*.env.*|*/shared/env/*)
    deny "secrets live only in the server's env files; nothing here should write one" ;;
  */apps/api/data/*)
    deny "this is the developer's local catalogue + account store. A test already destroyed a 70MB snapshot here once; production paths are pinned in ecosystem.config.cjs" ;;
  */artifacts/catalog-*.json)
    deny "catalog artifacts are generated — run 'npm run catalog:update' instead of editing them" ;;
  */node_modules/*|*/dist/*|*/playwright-report/*|*/test-results/*)
    deny "generated output; change the source instead" ;;
esac

exit 0
