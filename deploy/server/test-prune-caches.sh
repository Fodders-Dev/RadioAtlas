#!/usr/bin/env bash
# Focused test for prune_ffmpeg_download_cache and the release retention count
# in deploy-release.sh. Both exist because the box hit 96% full on 2026-08-14:
# the ffmpeg-static download cache had grown to 5.5GB (one ~9MB entry per
# deploy, never evicted) and five kept releases cost another 2.7GB.
#
# This script does NOT deploy anything. It sources the real function out of
# deploy-release.sh and runs it against throwaway directories in $TMPDIR.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# Pull just the function body out of the deploy script, so the test cannot
# drift from the code that actually runs.
FN="$(sed -n '/^prune_ffmpeg_download_cache() {$/,/^}$/p' "$SCRIPT_DIR/deploy-release.sh")"
[[ -n "$FN" ]] || fail "prune_ffmpeg_download_cache not found in deploy-release.sh"
eval "$FN"

# 1. A missing cache directory is a no-op, not an error.
FFMPEG_CACHE_DIR="$TMP/absent" FFMPEG_CACHE_MAX_MB=1 prune_ffmpeg_download_cache \
  || fail "a missing cache directory must not fail the deploy"

# 2. A cache under the cap is kept — a warm cache saves the download.
SMALL="$TMP/small"
mkdir -p "$SMALL"
head -c 100000 /dev/zero > "$SMALL/entry.body"
FFMPEG_CACHE_DIR="$SMALL" FFMPEG_CACHE_MAX_MB=64 prune_ffmpeg_download_cache
[[ -f "$SMALL/entry.body" ]] || fail "a cache under the cap must be kept"

# 3. A cache over the cap is dropped whole; the next npm ci refills it.
BIG="$TMP/big"
mkdir -p "$BIG"
head -c 3000000 /dev/zero > "$BIG/entry-1.body"
head -c 3000000 /dev/zero > "$BIG/entry-2.body"
FFMPEG_CACHE_DIR="$BIG" FFMPEG_CACHE_MAX_MB=2 prune_ffmpeg_download_cache 2>/dev/null
[[ ! -d "$BIG" ]] || fail "a cache over the cap must be cleared"

# 4. Retention keeps the current release plus a bounded number of spares, and
#    the default must stay small enough that releases cannot fill the disk.
KEEP_LINE="$(grep -n 'local keep_extra=' "$SCRIPT_DIR/deploy-release.sh" | head -1)"
[[ -n "$KEEP_LINE" ]] || fail "keep_extra not found in prune_old_releases"
KEEP_DEFAULT="$(sed 's/.*RELEASE_KEEP_EXTRA:-\([0-9]*\).*/\1/' <<<"$KEEP_LINE")"
[[ "$KEEP_DEFAULT" =~ ^[0-9]+$ ]] || fail "keep_extra default is not a plain number: $KEEP_LINE"
# One spare is the minimum preserve_previous_chunks needs; more than three
# releases of ~530MB each is how the disk filled up in the first place.
(( KEEP_DEFAULT >= 1 )) || fail "keep_extra must retain at least the previous release"
(( KEEP_DEFAULT <= 3 )) || fail "keep_extra default $KEEP_DEFAULT is too many releases to retain"

echo "OK: ffmpeg cache cap and release retention verified (keep_extra=$KEEP_DEFAULT)"
