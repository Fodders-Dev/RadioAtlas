# Brokenbeats: successful headers followed by a stalled body

## Measured incident

The owner reports radio stuck at connecting/buffering and suggests replacing the
Netherlands route with Finland193.8.114.209. The screenshot selects Brokenbeats.
Strict-key desktop SSH to NL82.25.60.19 times out, but the RU server's existing
tunnel answers on relay8399 and foreign API3399. A failed desktop SSH probe does
not prove that the application's established tunnel or media path is down.

Public catalog search returns two Brokenbeats mounts:
`https://stream.brokenbeats.net/tune` and
`https://brokenbeats.net/stream/aac`.

| Route | Result before repair |
| --- | --- |
| RU direct, first mount | 200 audio/aac; exactly24007bytes then no progress through8s |
| RU main proxy, either mount | 200 audio/aac; exactly24007bytes then no progress through12s |
| Public main proxy, either mount | Exactly24007bytes then timeout at18s |
| Existing foreign API, both mounts | 200 audio/aac; >32KB in1.3–1.7s |
| Existing foreign API, first mount extended | 101565bytes in2.77s,26chunks |
| FI direct, both mounts | 200; ~390KB over10s, curl28 because the live stream is endless |
| NoLife main/public/foreign control | 200 audio/mpeg; >32KB in0.7–1.0s |

The first AAC bytes have a frame-sync prefix; this is not an HTML page
mistaken for audio. No raw audio was retained. No model generation or paid
provider search was used. The numerical byte observations are transport
evidence, not a physical audible-output measurement.

An actual app Retry was observed through cursor-bounded browser CDP events.
Its first media request is the same-origin `/api/stream?url=.../tune` proxy.
The later DOM currentSrc being direct was the failed last candidate, not proof
that direct came first. The proxy then accepts the RU200 header and never
reaches the foreign fallback. The same unmodified browser eventually displays
failure with time0/readyState0. There is no basis for changing frontend order.

## Bounded repair

Sol and Astra selected an egress-first exception for exactly those two
normalized HTTPS URLs. After current validation/rate limiting, a configured
foreign route is preferred on an unmarked request; an already-relayed request
stays direct. A preferred-relay failure may try direct but cannot relay twice.
Other stations retain direct-first/fallback behavior. The selected response
uses the existing body/manifest pipeline and ownership cleanup.

Do not splice fresh AAC into an already committed body or add a generic timer
to detect this prefix. Preserve SSRF/DNS pinning, hop guard, backpressure,
disconnect cleanup, Range/User-Agent propagation and provider budget boundaries.
[Implementation and acceptance contract](CONTRACT-brokenbeats-egress-2026-11-01.md).

## Finland and release boundaries

FI strict SSH succeeds using its own previously trusted identity
HostKeyAlias46.38.156.229. It has no Node/RadioAtlas runtime or service on the
required ports, around529MB available memory and1.2GB root disk free. Starting
the full API would also warm a catalog and initialize unrelated persistent
stores. No package, service, port, credential or configuration was changed on
FI; no tunnel was redirected. Moving only the foreign address cannot fix a RU
direct success that suppresses fallback.

The repair branch starts at origin/master db1e85e; the deployed application was
1fea91b when checked. Between those bases only the automatic catalog artifacts
differ; they were not manually read or changed. The unrelated local player
repair d69d691 and ops-record commit8865790 remain on codex/ios-session-followup
and are excluded from this release.

Luna owns API code/tests; Sol owns integration/checks/release; Astra independently
reviews. Both typechecks, API tests, build, required same-SHA CI/deploy and public
audio/browser acceptance must be recorded before claiming restoration. Public
checks must observe both mounts beyond the previous18s failure window and
verify switching away/back plus the NoLife control. Local/public receipts live
under `output/brokenbeats-egress`. No iPhone background or Lira-quality acceptance
is implied by this desktop transport repair.

## Local verification before publication

Luna captured the initial route regression failing because direct fetch ran
before relay. The final tests use the real handler/body pipeline with an internal
direct-transport seam: a modeled200 response stalls after24007bytes, while the
selected relay supplies49152bytes and direct is never opened. Relay503 followed
by direct503 terminates502 after exactly one of each; no duplicate relay.
Separate real-loopback relay sockets close both before headers and after the
client has received more than24007bytes. Exact-match/near-match, hop, missing
configuration, ordinary direct success/fallback and private-target checks remain.

Sol independently read the diff and verified both all-workspace typechecks,
all937API tests and build by exit0. Initial test-typecheck exit2 exposed two
Node-only RequestInfo type errors; they were corrected, then the complete test
typecheck/API suite passed again. No original assertions/retries were weakened.
Astra independently accepted final source/tests without blockers. The API and
web source/test freeze covers706files, unchanged after verification.

No frontend source was changed. Required CI still exercises full web units and
serial functional browser coverage for the exact release SHA. Publication,
public sustained bytes and native browser progress are separate gates; local
fixture bytes do not establish audible output from the actual station.
