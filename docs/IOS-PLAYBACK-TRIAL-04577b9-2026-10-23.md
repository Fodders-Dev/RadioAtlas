# Physical playback-category trial: positive result, control pending

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
