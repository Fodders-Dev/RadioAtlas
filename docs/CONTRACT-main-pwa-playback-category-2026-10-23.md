# Main installed-PWA playback category mitigation

## Evidence and decision

Owner authorizes ongoing repair and immediate verified production publication,
with Luna implementing and Sol/Astra specifying and reviewing. Runtime04577b9
has two positive physical lab exports: four then three hidden system resumes
with playback/applied and owner-confirmed audible output. Latest export is
472237c3-51e3-42ed-acd5-37acf3a065c8; its final automatic visit contains no Play.
Return explicitly restores JS type auto. Owner separately reports main-player
Pause/Play works after visiting the selected lab, but refreshing/reopening the
app loses this improvement. This was NOT a phone reboot. Native carryover and
navigation effects remain alternatives; this is evidence for a bounded mitigation,
not proof of category causality or acceptance of the main player.

Owner additionally reports installed PWA shows -10/+10 while ordinary browser
tabs show Next/Previous. Keep this in physical acceptance; do not claim category
selection fixes OS buttons or foreign-PWA artwork activation.

## Implementation owner and scope

Luna owns new lib/pwaPlaybackSession.ts and focused tests, lib/useAudioPlayer.ts,
hook wiring tests, lib/playbackDiagnostics.ts and its tests, and optionally a
focused browser contract spec. Sol owns docs, review, integration and release.
Keep audioLab.ts/HTML/journal, RadioContext handlers, manifest, source selection,
recovery, queue semantics and timers unchanged. No UI changes, dependencies,
microphone requests, category cycling, silent keepalive or reload workaround.

1. A small controller is owned by the lazy player hook. Construction/mount and
   persisted station restoration make ZERO category writes. Eligibility is the
   existing constrained Apple WebKit check AND installed standalone detection
   (legacy navigator.standalone or display-mode). Capability reads are guarded.
   Ordinary tabs, Android and unsupported/partial APIs keep working unchanged.
2. Acquire synchronously in public playStation after confirming audio exists,
   before startStation/any await. Acquire in resume after audio/target checks
   and duplicate pending-command guards, before any path can play. Do not add
   setters to candidate recovery, playing handlers, visibility or timers.
3. Only readable original auto may be changed to playback. Already playback
   means no write and no ownership. Other/unknown categories stay untouched.
   Attempt once per listening interval, including a failed/ignored attempt.
   Own only if assignment succeeds and recognized readback is playback. All
   failures are contained; native audio commands must still proceed normally.
4. Retain across Pause/toggle/sleep/headphones, station changes/Next/Previous,
   errors/retries, visibility and diagnostic expiry. Do not reset on
   beginPlaybackSession: it also runs on station changes and cancelled startup.
5. Terminal Stop and hook cleanup release AFTER invalidating pending commands
   and pausing. Restore auto only for an owned override whose current value is
   still playback; verify readback, report failure/unknown honestly, relinquish
   ownership regardless. Do not overwrite another writer's changed category.
   A subsequent explicit Play can acquire a fresh interval. Late promises cannot
   reacquire. Add no pagehide/pageshow policy: BFCache/continuing-media ambiguity
   remains under existing browser lifecycle. Settings Stop isolates lab entry.
6. Add bounded optional status to existing diagnostic control snapshots and
   fixed acquire/release events. Keep legacy entries valid; report actual
   assignment/readback/release outcomes, never effective native category or
   heard output. No URLs, raw exceptions or new telemetry. Harden optional
   audioSession/type/state getters in snapshot construction so throwing partial
   APIs cannot erase diagnostics or block media commands.

## Required evidence

- Hook/native-call observations: no writes before explicit Play; one synchronous
  write before first native play in eligible PWA; no writes through Pause,
  Resume, visibility, station switching/retry; fresh acquisition after Stop.
- Conditional restore on Stop/unmount; external category preserved; already
  playback untouched; partial/throwing/ignored APIs retain usable audio commands.
- Stop/unmount during pending play cannot resurrect policy or audio ownership.
- Diagnostic backward compatibility, allowlist and throwing-getter snapshots.
- Tab/non-Apple zero-write negative controls; lab default/isolation unchanged.
- Meaningful mutation check for retention/release guards using the same
  assertions, without committing production mutations.
- Source/test typechecks, all web units, serial full functional browser lane,
  build, independent Astra review, same-SHA CI/deploy and public release markers.

## Physical acceptance remains open after release

Fresh installed-main-app launch WITHOUT opening the lab: initial sound, Home/lock,
Pause5s->Play on named card, hear20s; repeat after refresh and after a longer
pause. Test Next/Previous with a known queue of at least2stations, then Pause
again. Observe actual OS button symbols and whether artwork still opens another
PWA. Call interruption needs its own check. Do not press empty Not Playing Play
(owner reports Apple Music starts). Do not remove more installed PWAs. Native
clock, JS category readback, mocks and desktop gates do not certify iPhone sound.

Astra independently recommends this scope. Wrong-PWA activation, seek symbols
and native cause remain OPEN until measured on-device; no speculative handler
re-registration is included in this one-variable release.
