# Explicit playback category in the isolated PWA lab

## Evidence and scope

The owner tested standalone f70f66e on iOS 26.6.1. The 23:57 export contains
42 entries across two visits. Both hidden Pause callbacks arrive; neither
subsequent physical system Play is reflected in play_requested before returning
foreground. The owner pressed Play while the Minimal PWA player card still
existed, then saw Not Playing; they deliberately did NOT press the empty widget's
Play (which can launch Apple Music). Do not ask them to do that.

Pause retained readyState4 and currentTime9.6/10.8. No source reload on those
pauses. The second silence mark is paused, not a growing-clock silent resume.
The first visible resume resolves in50ms; its clock advances9.6->15.7. The
visible stop97ms before pagehide is compatible with Return, not evidence of an
unsolicited OS Stop. The supplied screenshots' Lira cover is exactly our app
icon192 used by the lab. State:null is unknown, not inactive.

This reproduces failure without the app recovery runtime. It does not distinguish
handler registration failure, native command routing or process wake eligibility.
It does not prove that automatic category selection is incorrect.

Astra recommends a one-variable opt-in trial: explicit AudioSession playback
before initial native Play, retained across Pause. The owner has authorized
continuing investigation, Luna implementation, Astra review and publication.
Main app playback, manifest identity, installations and foreign PWAs stay intact.

## Luna implementation contract

1. Only change audio-lab.html, src/audioLab.ts, lib/audioLabJournal.ts and their
   tests. Keep all old isolation/source/timer/expiry/Stop ownership contracts.
   No rebind-on-playing, recovery, extra source, silent keepalive or automatic
   playback. Existing lab default remains automatic and writes NO type override.
2. Add a labelled opt-in checkbox before controls: "AudioSession playback
   (эксперимент)" with a brief explanation: enable before Play, category retained
   through Pause; not a proven fix. English equivalent. Default unchecked,
   nonpersistent. Lock choice on first Play attempt (including pending/rejected)
   until a fresh document. Checkbox label/target >=44px; fit320/390/1440.
3. On first explicit Play, synchronously before audio.play(), if selected and
   session.type has a recognized readable original value, attempt type='playback'
   once, catch partial/throwing API, read back and report applied ONLY when readback
   is playback. No microphone request. Absent/unreadable/throwing/ignored category
   is reported as unavailable/failed/unknown, never fake success. Native Play may
   still run normally. No writes on subsequent Play, Pause or visibility events.
4. Release (terminal Stop, Return, pagehide) restores recognized prior value only
   if this document successfully owned an override and current type is STILL
   playback; do not overwrite another owner's later type. Exception containment,
   no autoplay. Restore even if late native play promise settles. Expiry of the
   recorder never changes audio/session policy. Initial value already playback
   must not produce unnecessary mutation/restoration or claim a changed category.
5. Extend bounded allowlisted journal with optional category-trial mode and
   controlled status per snapshot, preserving old v1 entries (missing new fields
   are valid); report attempted/actual mode honestly. Add fixed type trial events
   and source markers for UI/media Play/Pause and Return/system Stop so the next
   export distinguishes commands. No URLs, arbitrary messages or raw exceptions.
   Expose per-action registration success/failure/unavailable in report as fixed
   enum status, without changing registration timing or swallowing all results
   behind an unqualified attached flag. Do not re-register to "fix" registration.
6. Meaningful tests: unchecked path has0type writes; selected first Play writes
   before nativeplay; Pause and resume/visibility keep samecategory/source with
   no extra writes; release restores original without clobbering later changed
   value; unsupported/throwing/ignored API honest and audio remains usable;
   late promise cannot regain playing/released state; checkbox locks; journal
   preserves legacy and rejects unknown enum/extra arbitrary data. Verify event
   source identifies real invoked callback, not test-owned narration.

## Root verification and acceptance

Root owns docs, review, visual inspection, source/test typechecks, full web units,
serial functional suite, build, same-SHA CI/deploy and public smoke. Astra reviews
source and actual rendered320/390/desktop. Desktop mocks prove contracts only.

Owner: enter same installed PWA via its icon, lab, confirm build and standalone,
enable playback experiment BEFORE Play, hear NoLife, Home/lock, Pause3s, Play
ON THE NAMED CARD once, wait20s, return and mark heard/silent, copy report.
If card disappears, do NOT press the empty Not Playing widget. Preserve journal.
Compare hidden command execution and heard output separately. If wrong-PWA
foreground matters, compare Rodnya/Home/Rodnya without extra media commands.

Astra review: readback playback establishes the JS value, not the effective
native category, process assertion or heard output. Registration success means
the call did not throw, not that OS routing is retained. Override ownership is
local best effort; comparing a value cannot detect another writer's intervening
playback->other->playback cycle. A positive result requires later same-build auto
comparison because navigation itself may reset native state. Do not call the
category causal from a single successful test.

Memory-pressure question: no new lab_opened or reset-to-zero source after these
pauses argues against whole-document termination; it does not exclude process
suspension or an independent media/GPU process restart. WebKit323104 describes
a separate silent-rendering report and proposes stale category cache after GPU
relaunch; its author has no matching crash/Jetsam records. Do not assert this
mechanism on26.6.1. It is a reason why JS playback readback is not native proof,
not a reason to add category cycling/retry or change the main runtime.

## Primary references (not exact shipped-device diagnosis)

- https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/audiosession/DOMAudioSession.cpp
  setType maps playback to MediaPlayback and auto to no category override;
  readback matters because a policy check may return without applying.
- https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/audiosession/DOMAudioSession.idl
  state is separately gated; null does not demonstrate inactivity.
- https://bugs.webkit.org/show_bug.cgi?id=243258
  historical standalone pause/resume report with multiple-PWA affiliation
  suspicion. Similar symptoms, not a confirmed cause or requested removal.
- https://bugs.webkit.org/show_bug.cgi?id=323104#c5
  separate reporter's GPU-relaunch/category-cache hypothesis, not confirmed
  Apple diagnosis; relevant to old silent-clock symptom, not proof of why the
  current hidden Play callback is absent.
