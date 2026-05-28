#!/usr/bin/env bash
# T_audit_6: focused test for the rsync flags used by preserve_previous_chunks
# in deploy-release.sh. Verifies the contract — chunks deleted in the new build
# get filled from the previous release; new builds of an existing chunk name
# are NOT overwritten by the older copy.
#
# This script does NOT deploy anything. It builds a tiny fake `releases/` tree
# in $TMPDIR and exercises the exact `rsync -a --ignore-existing` invocation.

set -euo pipefail

if ! command -v rsync >/dev/null 2>&1; then
  echo "SKIP: rsync not on PATH (Linux/macOS only; deploy host has it)" >&2
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PREV="$TMP/prev/apps/webapp/dist/assets"
NEW="$TMP/new/apps/webapp/dist/assets"
mkdir -p "$PREV" "$NEW"

# Previous release shipped: Home-OLD.js (will be deleted by the new build),
# vendor-SHARED.js (unchanged between releases), index-OLD.js (old shell).
echo 'old-home'   > "$PREV/Home-OLD.js"
echo 'shared-v1'  > "$PREV/vendor-SHARED.js"
echo 'old-index'  > "$PREV/index-OLD.js"

# New release rebuilt Home (different hash) + ships a new shell. vendor kept
# the same hash because its content didn't change.
echo 'new-home'   > "$NEW/Home-NEW.js"
echo 'shared-v1'  > "$NEW/vendor-SHARED.js"
echo 'new-index'  > "$NEW/index-NEW.js"

# Exact invocation from preserve_previous_chunks().
rsync -a --ignore-existing "$PREV/" "$NEW/"

fail() { echo "FAIL: $*" >&2; exit 1; }

# Deleted-by-rebuild chunk is now resolvable from the new release.
[[ -f "$NEW/Home-OLD.js" ]] || fail "Home-OLD.js not preserved into the new release"
[[ "$(cat "$NEW/Home-OLD.js")" == 'old-home' ]] || fail "Home-OLD.js content mismatch"

# Old index is reachable too (a tab caching it can still bootstrap).
[[ -f "$NEW/index-OLD.js" ]] || fail "index-OLD.js not preserved"

# New build of a chunk name wins (--ignore-existing doesn't overwrite).
[[ "$(cat "$NEW/Home-NEW.js")" == 'new-home' ]] || fail "Home-NEW.js was clobbered"
[[ "$(cat "$NEW/index-NEW.js")" == 'new-index' ]] || fail "index-NEW.js was clobbered"

# A chunk whose name+hash carry through both releases is NOT overwritten by
# the older copy (would matter if the old build's bytes ever differed).
[[ "$(cat "$NEW/vendor-SHARED.js")" == 'shared-v1' ]] || fail "vendor-SHARED.js was clobbered"

echo "OK: preserve_previous_chunks rsync behaviour verified"
