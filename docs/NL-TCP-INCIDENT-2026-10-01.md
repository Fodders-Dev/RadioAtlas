# NL TCP memory incident — 2026-10-01

## Evidence and immediate mitigation

Only `radioatlas-api` was restarted on the shared NL host. Before: API PID
282253, 959 descriptors (938 sockets), RSS 388344 KiB, swap 183596 KiB;
TCP memory 177104 pages, upper threshold 177012 pages; available RAM 189 MiB.
After 3 seconds: TCP memory 30 pages, available RAM 2374 MiB, API health 200.
At 20:37:53 UTC: API PID 1397261, 26 descriptors, RSS 336920 KiB, swap zero;
TCP memory 3 pages, available RAM 2272920 KiB. This isolates the major resource
retention to RadioAtlas; it does not claim every socket on the host was ours.

## Fix and regression proof

- Pull upstream chunks only when the downstream reader requests them.
- Cancel the owning reader and destroy its pinned transport on early exit;
  graceful close remains for completed bodies.
- Keep caller cancellation linked past response headers and install client
  disconnect handling before fetching headers.
- Abort incomplete metadata probes before detaching their deadline.
- Keep completed manifest cache; do not deduplicate tasks sharing one caller's
  abort lifetime.

`media.body-lifecycle.test.ts` uses real loopback HTTP servers and observes peer
socket close events, rather than counting mocked cleanup calls. Five cases:
silent live stream cancellation, repeated cancellation, an unread high-volume
stream bounded below a 32 MiB safety cap, disconnect before headers, and two
manifest callers where only the first disconnects. All five fail on original
NL release `2096836` and pass on the fix. Source and test typechecks, full API
suite and API build are release gates. Independent review found and corrected
the unsafe `req.destroyed` check and shared manifest cancellation.

## Deployment boundary

RU uses the regular master CI/deploy gate. NL serves a frozen older API as the
foreign stream egress, so it receives a minimal backport based on `2096836`,
not the newer UI or Lira Studio. Its existing cwd, dependencies, environment,
assets and stopped bot/harvester must be preserved. Deployment SHAs, bundle
checksums, rollback location and smoke results are appended after rollout.

### Installed on NL at 20:41:48 UTC

Minimal backport commit `4362b026a8de61da5f69073c909cfb24a387d4a7`
is published on `codex/nl-media-lifecycle`. API typechecks, build and 555 API
tests passed on that old branch. All three original media source files on NL
matched their `2096836` git-blob SHA256 before deployment. Only the bundled
`apps/api/dist/index.js` was replaced atomically and only `radioatlas-api`
restarted; original cwd, env, dependencies, assets and other services stayed
in place. This emergency deployment deliberately leaves `current` pointing
at the **base** release `2096836`; that symlink alone is no longer evidence of
the running API bundle. No newer product composition was deployed on NL.

Installed bundle SHA256:
`49e72f9541100ac4cac3e110acc4b521d962c8a5ebde60747f5b6ae075fdf817`.
Original SHA256:
`8ea3cec4faa0443c803d0088d43b9afbf81a883ed96996e204d396fefbf3bd8c`.
Backup, source archive and `install.json` are under
`/opt/RadioAtlas/hotfixes/4362b026a8de61da5f69073c909cfb24a387d4a7/`.
The installer would restore the original bundle on a failed healthcheck;
health passed, so rollback was not needed.

Twelve real `SomaFM Groove Salad` requests each returned HTTP 200 and 4096
audio bytes before client close (0.51–0.88 seconds). API PID stayed 1412585;
descriptors were 26 before and 26 after. At 20:44:35 UTC, still 26 descriptors,
TCP memory 3 pages (12 KiB), API swap zero, available host RAM 2259920 KiB.
Bot and harvester remained stopped. Numeric evidence is saved in
`proof/nl-tcp-incident-2026-10-01.json`.

Four more requests through RU loopback port 3399 (the deployed SSH tunnel to
NL port 3001) also returned HTTP 200 and audio before cancellation. NL stayed
at 26 descriptors, PID 1412585, with zero process swap afterwards. These
exercise the deployed relay transport, rather than only same-host loopback.

If rollback is required, atomically restore `original-index.js` to
`/opt/RadioAtlas/releases/2096836cc394d0e8f3263637554c17655972b069/apps/api/dist/index.js`,
restart only `radioatlas-api`, and check `http://127.0.0.1:3001/health`.
A later normal NL release containing the source fix supersedes this emergency
bundle; do not reapply the backport to a newer base blindly.

### RU production release completed

`13b171563202747ee5d655a2193060db64b70a70` passed both required gates in CI
`36923238515`: 707 API tests, 900 webapp units, 432 functional browser cases /
7 skipped, both typechecks. Deploy `36923238582` succeeded. RU `current`
resolves to that exact SHA; API PID 1938948 and public `/api/health` are healthy.
Pixel reporting is 14 passed / 4 mismatches (search, full player, mobile player
queue, mobile library). These same four mismatches existed in previous CI
`36917316017`. No client source or pixel baselines changed in this fix.

Six public HTTPS audio responses passed (200, 4096 bytes, 0.75–0.99 seconds).
The coarse aggregate-FD assertion after two seconds failed, 33 → 39. Subsequent
inventory returned to 31 FDs and had no station sockets; this was not erased
or treated as proof of closure. A targeted follow-up explicitly observed the
SomaFM TCP peer: 0 established before playback, 1 while receiving audio, and
0 after cancellation (5 ms). FDs went 32 → 30, PID stayed unchanged. This
distinguishes station transport from unrelated/transient process descriptors.

Final NL sample at 20:58:21 UTC: PID 1412585, 26 FDs, zero process swap,
TCP memory 1 page (4 KiB), available RAM 2224548 KiB. NL installed bundle
SHA256 was reverified after the RU deploy. These are short-term functional
and resource observations, not a multi-day load claim.

## Limits

Loopback tests prove cancellation and backpressure. Production smoke and
resource samples verify the installed process; they are not a multi-day load
study. Current TCP allocation includes unrelated services and TIME_WAIT
sockets, so those counts must not be labelled a RadioAtlas leak by themselves.
