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

## Limits

Loopback tests prove cancellation and backpressure. Production smoke and
resource samples verify the installed process; they are not a multi-day load
study. Current TCP allocation includes unrelated services and TIME_WAIT
sockets, so those counts must not be labelled a RadioAtlas leak by themselves.
