# Restore Brokenbeats through the measured foreign route

## Evidence and scope

Owner reports radio stuck connecting and suggests temporary FI193.8.114.209
because NL appears down. Desktop SSH to NL82.25.60.19 times out, but RU's
existing8399 relay and3399 foreign API answer. Actual foreign audio is healthy:
Brokenbeats101565bytes/2.77s via3399, both mounts continuously stream from FI
(~390KB/10s). RU direct and main/public proxy instead return200 audio/aac,
then stop at exactly24007bytes through8/12/18s. NoLife works through main/public
and foreign routes. A first-byte/health check misses this body stall.

The proxy accepts a successful direct header and never reaches foreign fallback.
Moving the foreign endpoint alone does not fix that choice. Astra recommends
an exact two-mount preference, not a generic mid-body splice or global reroute.
FI has no Node/RadioAtlas service and limited resources; provisioning is held
while the measured existing foreign route works. Root owns ops/docs/release.

## Luna ownership and implementation

Own only apps/api/src/media/foreignEgress.ts, streamProxy.ts and targeted API
tests (existing foreignEgress/body-lifecycle tests or a new focused test file).
Work in the existing explicit-play-repair checkout, branch
codex/brokenbeats-foreign-route from origin/master db1e85e. Unpublished player
changes d69d691 are deliberately excluded. No frontend or environment changes.

1. Match only normalized exact HTTPS URLs:
   - https://stream.brokenbeats.net/tune
   - https://brokenbeats.net/stream/aac
   Do not include other mounts/subdomains, query variants, credentials, protocol
   changes or caller-selected egress flags. Ordinary normalized host/default-port
   spelling remains the same URL; escaped/different paths must not widen scope.
2. After current URL validation/rate limiting, those targets prefer configured
   foreign egress only when the incoming request is not already an egress hop.
   Reuse fetchViaForeignEgress and current deadline/client-abort wrapper; do not
   weaken SSRF/DNS pinning on the public target or far-end hop validation.
3. A successful preferred relay skips all direct fetches. Failed preferred relay
   may try original direct candidates but must not retry relay in this request.
   Cancellation after preferred attempt must throw/stop before any direct retry.
4. Missing egress and hop-marked requests remain direct. Every other URL retains
   direct-first then one foreign fallback after failure. Preserve Range,
   User-Agent, encoded target, hop header and original failure semantics.
5. Selected response enters unchanged manifest/body pipeline. No AAC splicing,
   new timer, early buffering heuristic, stream MIME rewrite, metadata change,
   category/player/recovery change, arbitrary relay endpoint or extra dependency.
   Preserve backpressure, client disconnect cleanup and body stall teardown.

## Tests and acceptance

Add regressions before production changes; capture red exit/assertion first.
Prove native HTTP/fetch call ordering and received bytes, not source strings:
preferred mount delivers continuing relay bytes and never touches direct200+
prefix/stall fixture; ordinary success never relays; ordinary failure still
relays; preferred relay failure uses direct once/no second relay; missing config
and hop-marked requests stay direct. Reject near matches/private targets. Cover
client cancellation before relay headers and after body starts, including upstream
socket release, and retain existing lifecycle regressions unchanged.

Luna runs focused tests and hands off frozen source/tests, without commit/push.
Root and Astra independently review. Root runs both typechecks, full API suite,
build and required same-SHA CI/deploy before publication. No assertions/retries
weakened. Browser currentSrc alone is not first-candidate history; extensionless
mounts already prefer proxy when API is available, so no speculative client fix.

Public acceptance: both /api/stream mounts continue delivering audio beyond the
previous18s failure window; actual app playback advances beyond it and switches
away/back successfully; NoLife remains healthy. Record bytes/MIME/durations and
browser observations separately from audible physical output. No model/Tavily
paid calls, no keys/env reads, no neighbor services, no claim that NL was globally
dead or that FI migration restored playback.
