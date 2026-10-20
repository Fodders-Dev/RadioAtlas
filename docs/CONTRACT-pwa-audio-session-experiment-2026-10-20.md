# Opt-in PWA audio-session experiment

**NOT AN ACTIVE IMPLEMENTATION CONTRACT.** Stopped before any runtime/test edits:
the owner removed the retailer PWA and initially reported restored operation.
The owner then qualified it: sound works only while the next foreign PWA is
foreground; Home or screen lock fails. Recovery was not established. System
artwork still opens that foreign PWA. Default AudioSession policy stays
unchanged; this proposal is retained only as an unexecuted hypothesis.
Do not implement or deploy it from this document without a new evidence review.

## Evidence and hypothesis

On iOS 26.6.1 the owner reports correct audible Pause/Play and station skipping
in ordinary Safari AND Chrome tabs. Installed RadioAtlas fails. Reinstalling
RadioAtlas changed ±10-second buttons into Next/Previous, but Pause and station
switching still silence it. System artwork still opens the retailer «Лента»,
also an installed PWA. The owner then removed it: artwork opened another PWA,
and audible operation initially appeared to return. The subsequent foreground-
only qualification invalidates the recovery conclusion. The experiment remains
unimplemented pending review of the new foreground/attribution evidence; no
AudioSession A/B was run.

The 7da63c4 trace already demonstrated advancing native time while inaudible.
Transport/MediaSession commands alone cannot detect actual output. This slice
tests whether an explicit native playback-category override changes that
outcome. It is an experimental diagnostic control, not a proven repair.

Current WebKit DOMAudioSession maps Auto to no category override and Playback
to MediaPlayback, and its Cocoa manager prefers explicit category overrides.
The current source is not the exact engine build installed on the device.
Standard automatic categorization should already select playback for audible
HTML media, so auto is not itself a defect.

## Bounded behavior

1. Default unchanged: no AudioSession write until explicit developer action.
   No persisted preference, automatic enable, new timer, audio element, graph,
   keepalive, transport/source operation, MediaSession rebind or manifest edit.
2. A clearly labelled optional control in Settings developer diagnostics sets
   AudioSession.type to playback ONCE, reads it back, and reports unsupported,
   rejected or unchanged outcomes honestly. Permit acquisition from auto only;
   existing playback is already configured, while other explicit categories
   must not be overwritten. Do not request microphone permission.
3. Experiment state would survive navigation away from Settings within the current
   document. Pause and station Next/Previous retain the override. No audio may
   be started, paused or switched by control/listener calls to play/pause/load,
   src or queue operations. Category writes can themselves affect native audio
   focus; that effect would be the subject of the experiment.
4. Explicit experiment end and actual player Stop release it. Restore the
   captured previous type only on the same session object if its current type
   still equals the experiment's playback value. Do not overwrite an external
   play-and-record/other category change. Setter/getter exceptions are contained;
   failed restore stays visible/retryable rather than claiming success.
5. Display actual supported type/state, including unknown state (partial iOS
   implementations). State listeners are optional, bounded and cleaned up at
   release. Never infer audibility from state active or clock movement.
   Keep voice capture out of this trial; this is not a microphone coordinator.
6. Existing opt-in local diagnostics may add one strict event name for policy
   changes; existing snapshot fields already contain type/state. No raw error
   strings, URLs, station names, account data or new telemetry. Disabled recorder
   must not do extra media snapshot work; existing v1 caps/TTL remain intact.

## Acceptance and release

Meaningful unit cases: default no writes; unsupported/throwing API; refused
non-auto categories; accepted and ignored setters; listener cleanup; restoration
and restore failure; external ownership change; screen navigation persistence;
Stop release versus Pause/Next preservation. Browser contract covers real
Settings actions with a fake API and no transport/source side effects; inspect
the new control on a narrow mobile screen and the unsupported case.

Run both typechecks, full webapp units and serial full functional Playwright.
Release only the checked same-SHA implementation using existing CI/deploy gates.
Document default-off and remaining physical acceptance. No visual redesign.

Owner's physical A/B uses the SAME installation and same known audible stations:
experiment off versus playback enabled before audible start; background Pause
three seconds, Play, listen twenty seconds; then Next/Previous. Capture sound
separately from clock/state and app opened by artwork. If removing retailer PWA
changes baseline, document that first; do not compare across different install
states as though only AudioSession changed. Success would identify a workaround
candidate, not automatically justify enabling it globally. If ineffective,
next isolate a minimal audio + MediaSession page from our recovery engine.

## Primary sources

- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/Modules/audiosession/DOMAudioSession.cpp
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/audio/cocoa/MediaSessionManagerCocoa.mm
- https://www.w3.org/TR/audio-session/
- https://bugs.webkit.org/show_bug.cgi?id=295518
- https://github.com/WebKit/WebKit/commit/931c18ff23e25e263edcd26c0fd9b7e2ca063526

The older native-parent fix supports investigating wrong activation, but does
not prove that parent identity causes silence or that it affects this container.
