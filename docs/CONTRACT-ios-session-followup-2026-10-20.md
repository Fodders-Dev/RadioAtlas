# iPhone standalone: failed acceptance and bounded follow-up

**Post-release acceptance:** published `7da63c4` failed the owner's physical
retest. The seek layout also remains wrong. See the
[new trace analysis and correction of the retailer-PWA explanation](IOS-ACCEPTANCE-7da63c4-2026-10-20.md).

The owner authorized repair and production publication. Production build
`ce12fc04a24adba44947a43b15ab17e51bb59d04` failed physical acceptance on
2026-10-20. The native-first repair remains useful but does not close the
background-resume incident. This slice serves reliable return to listening.
A03 and the broader UX map remain separate work.

## Evidence and limits

The owner reported a disappearing system card on one trial, an inert Play on
another, and ten-second seek controls instead of station skipping. Launching
«Лента» appeared **without an address bar**. Later screenshots and the owner's
clarification identify a separate retailer PWA activated from system-player
artwork, not our Feed; the earlier interpretation as internal navigation was
incorrect. This does not establish a Home Screen launcher-icon failure.
The stations were probably NamKoCom Radio and NoLife-Radio;
the trace does not associate each event with a station, so do not assign cycles
to one of them as fact.

The new export identifies the deployed `ce12fc0` build and standalone mode.
Relative to recording start:

| Seconds | Event | Native time | Detail |
| --- | --- | --- | --- |
| 39.167 | hidden system Play | 7.9 | paused, readyState 4 |
| 39.209 | play/playing | 7.9 | no immediate source reset |
| 91.958 | next hidden Pause | 7.9 | unchanged after 52.791 seconds |
| 147.087 | foreground play/playing | 7.9 | still unchanged |
| 160.080 | emptied | 0 | 12.993 seconds later |
| 161.502 | audio_error | 0 | native code 3, decode error |
| 177.262 | another hidden system Play | 3.8 | paused, readyState 4 |
| 177.284 | play/playing | 3.8 | unchanged |
| 192.984 | emptied while hidden | 0 | 15.722 seconds after Play |

Both system Play commands reached our code. A native playing event is not
proof of audible playback. The first long gap does not establish suspended
JavaScript; the second cycle does not establish that all background recovery
timers work. This recorder lacks candidate/decision/watchdog evidence. An
emptied event alone does not identify the caller of load(), and hasMetadata
does not observe the actual system card. AudioSession auto is not itself proof
of a faulty audio-session configuration. Do not attribute the decode error to
a particular source without additional evidence.

## Implementation boundaries

1. Clear any previously published position using
   `mediaSession.setPositionState()` without arguments, including when the
   browser reports a finite duration. This player accepts stations only: its
   sole production consumer is `PlaybackRuntime`, its input is `StationLite`,
   and a find starts its source station rather than a recording. Finite native
   duration does not establish on-demand content or permit seeking. This
   explicitly supersedes the old finite-position publication test/expectation;
   it is a product correction, not test cleanup. Preserve exception containment
   and prove that previously stored finite OS position is removed.
2. Explicitly disable seekbackward, seekforward and seekto independently; an
   unsupported action must not prevent the other Media Session registrations.
   Preserve separate Play/Pause/Stop and queue-only Next/Previous. A singleton
   queue must not gain random-station skipping. Do not map seek to Next.
3. Extend the existing opt-in local recorder to observe recovery ownership and
   decisions, using bounded categorical/numeric data. Disabled recording must
   not read extra media getters. Preserve old v1 reports, expiry, entry/byte
   limits, storage fallback and strict validation. No URLs, station identities,
   track names, telemetry, extra timers or per-watchdog-tick persisted events.
4. No speculative AudioSession override, new recovery timer, metadata rebinding,
   keepalive or navigation rewrite. Source probes must match the lean iPhone
   media-element settings; a CORS-mode mismatch invalidates a comparison.
5. A separately measured startup-route repair is allowed for the exact
   `spritelayerradio.com` pathname `/listen/namkocom_radio/namkocom.mp3`. Use the
   existing measured proxy-first mechanism, retaining direct fallback and API
   availability checks. Do not proxy the whole host, other paths or similar
   domain names. Query/hash do not broaden the pathname match. NoLife routing
   and the existing forced-proxy policy remain unchanged.

## Acceptance

- A regression fails on the base for stale position and passes after clearing;
  a station with finite native duration must also clear, rather than publish,
  OS position state.
- Seek suppression survives unsupported-action exceptions; multi-item queue
  Next/Previous and singleton boundaries retain their current behavior.
- The exact NamKoCom source prefers proxy then direct with API available;
  unrelated paths, similar domains and unavailable API retain their prior
  routes. Existing Gamesboro and forced-proxy tests remain valid.
- Local diagnostics distinguish native Play from source attachment and the
  existing watchdog's observed execution/decision, without asserting sound.
- Recorder tests cover disabled overhead, malformed new fields, old v1 data,
  bounded history and failure containment. Existing resume ownership tests stay
  unchanged and green.
- Source and test typechecks, webapp units and the serial full functional gate
  pass by exit code. The exact release SHA passes required CI and publication;
  verify public assets and health against that SHA.
- Physical acceptance remains **open** until the owner hears locked-screen
  resume and checks the actual system card/controls on the released build.
  This slice must be reported as control-state repair, measured NamKoCom
  startup-route repair and diagnostic coverage, not as a proven repair of the
  silent iPhone resume.

## Source-probe basis for the bounded route exception

Corrected headed Chromium probes on the owner's Windows machine used native
HTMLAudioElement without crossOrigin (matching the lean Apple path), no media
mocks and separate direct/proxy URLs. NamKoCom and NoLife direct remained at
time 0 / readyState 0 during a 12-second observation; their proxied sources
advanced for approximately 9 and 11 seconds respectively, held position during
a three-second pause and advanced about six seconds after native resume.
The proxied durations were Infinity. A finite 1 GiB Content-Range appeared only
in a separate explicit bounded-Range HTTP probe; the actual browser open-ended
request received HTTP 200 without finite length headers. Do not use that
bounded-Range response as an explanation of the owner's seek buttons.

The actual public app, reached through Search in a fresh headed Chromium
context with Apple UA/touch emulation and force-proxy false, selected NamKoCom's
direct URL and stayed at time 0; it selected NoLife's proxy URL and progressed.
This is foreground Chromium evidence for a particular source route, not a
Safari/iPhone background pass. The first CORS-mode comparison was invalid and
withdrawn; it is not the basis of this exception. Probe files live in ignored
`output/ios-acceptance-20261020-2104/source-probes/`.

## Recorder data contract

`entry.control` is optional for compatibility with existing v1 recordings. Its
strict allowlist contains only optional scalar values: anonymous existing
`sessionSeq`, `candidateMode`, `playPending`, `permission`, `watchdogTicks`,
`watchdogAgeMs`, `watchdogDecision`, `bufferAheadSeconds`, `durationKind`,
`queueSkippable` and `actionReason`. The session counter is an anonymous player
lifecycle epoch, not a station identifier or a native attempt identifier.
`durationKind: live` describes native Infinity only, not a verified server type.

Record the actual last watchdog pass and age, including early returns. Do not
recompute a hypothetical decision in the snapshot provider. Count passes in
memory only while recording, without per-tick persistence or new scheduling.
Sparse resume/attach/play-settlement events must describe actual operations;
attach is recorded immediately before mutation, not when it is merely planned.
Async outcomes retain origin context; a superseded operation must not acquire
the new station's live snapshot. Registration of an audio-bound provider is
removed on cleanup; disabled recording never invokes it.

These measurements distinguish missing execution from a blocked branch and
an actual source attachment. They cannot establish audible output, why iOS
withheld execution, or the root of a network/decoder failure.

## Local verification before publication

Sol reviewed the implementation and evidence; Astra independently approved
the code after correcting false pause/debt attribution and stale async outcome
attribution. Luna implemented the bounded source/test changes.

Completed with actual exit code 0: both workspace-wide typechecks, final webapp
units **971 passed / 116 files**, and the serial functional browser suite
**456 passed / 7 existing diagnostic skips / 12.8 minutes**. The new live-seek
and NamKoCom route cases passed in that complete run. Afterward only unit-test
assertions were added for resolved settlement ordering and a late cancelled
candidate; resume wiring passed **51/51**, then full units and test-source
typechecking were repeated. The four production source blobs stayed unchanged
through the browser run and final unit checks.

The earlier finite-to-live regression failed with the clear branch temporarily
removed (exit 1, expected two position calls and received one), then source was
restored. The final station-only contract also explicitly replaces the prior
finite-duration publication expectation. Public-asset/server verification and
required same-SHA CI/deployment remain separate publication receipts. Local
checks do not accept the physical iPhone incident.
