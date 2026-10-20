# Explicit Play: healthy buffer and frozen live stream

Owner authorized implementation and immediate production publication on
2026-10-20. A03 is a separate, accepted search change and is excluded here.
Implementation base: `335fd26`; production before this repair: `f4ef231`.
The two base-to-production differences are catalog artifacts, not player code.

This repair supports the product's return loop: a listener can pause a station
and explicitly continue listening without opening the application first.

## Physical-device evidence before the repair

Owner export: iPhone Home Screen standalone app, reported UA iOS 18.7,
production build `f4ef231`. Times below are relative to `recording_started`.

| Seconds | Event | Visibility | Paused | Native time | Ready state |
| --- | --- | --- | --- | --- | --- |
| 10.259 | audio_progress | — | false | 17.7 | 4 |
| 15.109 | visibilitychange | hidden | — | — | — |
| 18.405 | media_pause_command | hidden | false | 25.9 | 4 |
| 18.429 | audio_pause | — | true | 25.9 | 4 |
| 20.724 | media_play_command | hidden | true | 25.9 | 4 |
| 20.758 | audio_emptied | — | false | 0 | 0 |
| 24.621 | audio_stalled | — | false | 0 | 1 |
| 25.973 | visibilitychange | visible | — | — | — |
| 26.779 | audio_playing | — | false | 0 | 4 |

Both system commands reached our handlers. The pause-to-Play command interval
was 2.319 seconds. The source reset occurred 34 milliseconds after Play;
`audio_playing` arrived 6.055 seconds after Play and 0.806 seconds after return
to the foreground. The elapsed interval between the two sampled advancing
positions includes visible time; it is not 8.1 seconds entirely in background.

Code inspection identifies unconditional recovery-debt spending through
`playCandidateAtIndex`/`attachSource` as the destructive reload path. Hidden
pause and background-outcome bookkeeping can grant debt without proving that
the source is dead. The previous `resume()` treated that debt as grounds to
reload even a healthy paused source.

The owner's disappearing system card is an observed symptom. This export keeps
`hasMetadata: true`; it does not directly record the OS Now Playing UI. A causal
claim that `emptied` alone removes that card still requires the device retest.

## Contract and acceptance

See [the owner-supplied contract](CONTRACT-explicit-play-2026-10-20.md).
Its behavioral requirements are unchanged; the trace narrative is corrected to
distinguish sampled time from hidden time and OS-card hypotheses from evidence.
Keep interruption/suppression debt distinct from evidence to destroy a source:
an attached healthy buffer gets a direct Play and a fresh progress window;
observed failure permits recovery within the same station. Time spent on an
intentional pause is not evidence of a stalled playback attempt. Repeated Play,
an unsettled native play promise, a new Pause and a station change must retain
their ownership and cancellation rules. No keepalive, MediaSession handler or
metadata changes are part of this repair.

The frozen unpaused scenario addressed by `01a233a` belongs to this same
contract. That earlier commit is inspected as a source of behavior and tests;
it is not published as a separate repair and its unrelated artifacts are not
included.

## Verification and release receipts

Implementation is complete and independently reviewed by Astra. New regression
first failed on the base with one extra `load()` for a healthy hidden pause;
all 40 existing resume-wiring tests passed in that control. The focused suite
passed 46/46 before three additional ownership cases were integrated, bringing
its final total to 49. Existing assertions are retained; the browser case that
expects reconnection now explicitly supplies an absent-media fixture, alongside
a separate healthy-buffer case that requires the source to stay attached.

Completed checks, each by actual exit code 0:

- `npm.cmd run typecheck`.
- `npm.cmd run typecheck:test`.
- `npm.cmd --workspace apps/webapp run test:unit`: final 958 tests, 116 files
  (the initial frozen implementation passed 955 before the additional cases).
- Three additional isolated Vitest probes: 25-second pending/no-progress
  deadline pauses before reattachment; Pause during fallback cancels the old
  result; a station switch during fallback cancels the old result. Reproducible
  standalone harness and `run-probes.ps1` are in the ignored evidence folder.
  The same three cases are now permanent tests in `resumeWiring`; final units
  and test typechecks were rerun successfully after their integration.

The full serial functional browser gate completed with exit 0:
`PLAYWRIGHT_SKIP_PIXELS=1 npm.cmd --workspace apps/webapp run test:e2e:functional`
reported **454 passed, 7 existing skipped, 12.9 minutes**. All 13 headphone
transport cases passed, including healthy-buffer preservation and explicit
missing-media reconnection. Only unit coverage and documentation changed after
that run; the player and browser spec hashes stayed unchanged. The seven skips
are the preexisting opt-in diagnostic cases, not newly suppressed failures.
Pixel baselines were not run for this transport repair. Local logs and probes
belong in `output/explicit-play-repair/`.

The extra headed-Chrome/native-key probe is **invalid**, not a background pass:
the real Radio Paradise FLAC played (`currentTime` advanced, `readyState` 3),
but the target page stayed visible after another tab was activated. The probe
stopped before either system key was sent. Its report records that precondition
failure. Source hash stayed `157558c41899925080c602d5faad6c53f1ab6f34` throughout.

Remaining physical acceptance: audible iPhone continuation while locked,
retention of its actual Now Playing card, a long pause, and call/headphone/car
interruptions. The automated MediaSession callbacks prove application wiring,
not iOS command delivery after suspension. No release or physical-device
success is claimed by this pre-publication record; deployment receipts will be
checked against the exact released SHA and public assets.

## Owner production retest

Release note: `5c2f9f8` was pushed but not deployed. CI39454890161 failed
before browser tests because the GitHub runner used unsupported Ubuntu 26.04;
deploy39454890152 refused publication as intended. A follow-up operations
commit pins the browser jobs to supported Ubuntu 24.04 and repeats the same
gates. The player implementation hash is unchanged. Do not use the first push
as evidence of publication.

After the new build is verified on production, reopen the Home Screen app and
check the commit in Diagnostics. Start a 20-minute recording, play a station,
lock the screen, use the system Pause, wait 2–3 seconds, and press system Play.
Confirm audible sound returns while still locked and the system card remains.
Repeat with a pause exceeding one minute. Then return to the application, stop
and export the recording without starting a new one. Include whether sound was
audible and whether the card stayed visible; native timestamps alone cannot
establish those two observations. Call/headphone/car interruption is a separate
physical-device scenario; test car controls while parked.
