# Physical playback-category trial and main-player mitigation decision

Owner reported on23October that system Play after Pause became available and
audible music resumed. Export:build04577b9,built2026-10-20T21:40:50.938Z,
standalonetrue,iOS26.6.1 confirmed previously.60entries, one lab visit.
Original export preserved locally in output/iphone-trial-20261023/owner-trace.json.

AudioSession originalTypeauto; selectedplayback; statusapplied and readback
playback before initial UIPlay. All relevant action registration calls reported
success (no exception, not proof of native routing by themselves).

| Hidden system Pause to Play | Play promise resolved | Position at resume |
| --- | --- | --- |
| 5.068s | 20ms | 13.7s |
| 3.559s | 16ms | 22.4s (pause snapshot22.3s) |
| 2.200s | 21ms | 31.4s |
| 1.301s | 20ms | 39.5s |

All four Play commands have commandSourcemedia-session and visibilityhidden.
The clock subsequently advances without resetting; readyState4 is retained.
There is a brief foreground visit after the second resume; do not call the
entire second segment continuously backgrounded. These are four cycles in one
document, not four independent launches. None includes the full planned20s of
uninterrupted background listening after Play.
No error/play_rejected/audio_emptied/pagehide events. No source-replacement
evidence. The final fifth Pause at43s has no subsequent Play in this export;
do not count it as a fifth successful resume or a failure.

Owner's heard-sound confirmation establishes audible output independently of
media clocks. manual_heard was pressed AFTER returning while pausedtrue, so
interpret it as a retrospective observation, not sound playing during Pause.
sessionStatenull remains unknown, not inactive. Foreign-PWA artwork activation,
Next/Previous, calls and long pauses are not accepted by this trace.

## Interpretation and next control

This is a positive physical acceptance of short Pause/Play in the opt-in lab
mode, not a proven category root cause or acceptance of the main player. Unlike
the prior f70 trace, hidden Play now reaches the page and resumes audio. A
three-day interval, document navigation and possible native-state changes are
confounders; there is no same-build automatic-mode control in this export.

Keep04577b9 and the installed-app environment unchanged. Return to RadioAtlas,
open the lab as a fresh document, leave the checkbox OFF, explicitly start a
fresh journal if needed, verify automatic/typeauto, hear NoLife, then repeat
hidden Pause5s->Play on the named card, listen20s in background and export the
result. Do not press the
empty NotPlaying widget. If automatic fails and playback succeeds again in a
fresh same-build document, the category hypothesis gains a stronger reversible
comparison. Do not deploy a main-player override on this one positive report.
Astra independently read all60entries and accepted the short-cycle physical
result with these limits. If automatic fails, repeat playback in another fresh
document to form playback->automatic->playback before claiming category causality.

Main-runtime integration requires a separate bounded contract, Luna
implementation, Astra review and existing release gates. Longer pause/call and
station-switching acceptance and wrong-PWA activation remain OPEN.

## Follow-up on23October

Owner supplied export472237c3-51e3-42ed-acd5-37acf3a065c8, preserved locally as
output/main-pwa-category/owner-followup-trace.json.42entries include three more
hidden media-session resumes: pauses1.420/1.560/0.820s, play resolved16/14/20ms,
positions7.8/16.4/19.5 retained at readyState4, playback/applied. Return at26.717s
is followed5ms later by audio_session_trial_release with auto/restored; pagehide
then has zero position/readyState0 as expected for release. A fresh lab visit
34.496s after Return reads automatic/auto but contains NO Play. Top-level mode
automatic describes that final document, not the earlier successful events.

Owner separately reports the MAIN player also works after the selected trial,
but refreshing/reopening RadioAtlas loses resume. They explicitly clarified
this is app refresh/reopen, NOT a phone reboot. No failed automatic/main playback
is recorded in this lab export. These are separate observed and recorded facts.
Since Return restores JS typeauto, carryover cannot be attributed simply to an
unreleased JS override; native session carryover/navigation remains possible.

Repeated positive trials and the owner's repeatable fresh-launch contrast now
support a narrow main installed-Apple-PWA mitigation, with physical acceptance
OPEN. Sol and Astra approved the separate
[implementation contract](CONTRACT-main-pwa-playback-category-2026-10-23.md).
The earlier instruction to wait for a control is superseded by this bounded
decision, not by a claim that the category cause is proven. Luna implements;
Sol reviews/tests/releases. Owner also reports PWA seek +/-10 instead of queue
Next/Previous while browser tabs have correct controls. Preserve that as a
separate physical criterion; no speculative handler changes enter this release.
