# iPhone: 7da63c4 physical acceptance failed

Owner's NoLife-Radio trial, 20 October 2026, export at 22:31 Moscow.
Production: `7da63c4d7a416e6c715d92d1b8b22ff67eb7d3e7`.
Sol independently read the trace and transport/MediaSession code; Astra reviewed
the trace and all three screenshots; Luna reconstructed transport ownership
and separately inspected application navigation and PWA metadata. No runtime
change is proposed as a proven repair by this report.

## Result and correction

**Physical acceptance failed.** The owner confirms that after Pause the music
never returned, including the later interval with advancing native media time.
That interval is NOT successful audible playback. The retailer «Лента» is also
an installed Home Screen web app, according to the owner.

The earlier explanation that «Лента» meant RadioAtlas's internal Feed was
incorrect. The screenshots show the grocery retailer and RadioAtlas as separate
app-switcher cards. A window without a browser address bar does not identify
which installed web app owns it. The owner reports that tapping the Lyra
artwork in the system player opens that retailer web app. The screenshots
establish the displayed applications and controls, but do not timestamp the
tap or associate it with a particular JSON entry.

The incident remains open despite the release's successful automated gates.
The seek-control change also failed physical acceptance: the system screenshot
still has ±10-second controls.

## Trace reconstruction

Relative seconds are measured from recording start. The 67-entry export
identifies this build and standalone mode. Station identity is intentionally
absent from the recorder; NoLife is the owner's identification, also visible
in the system-player screenshot. Source mode is proxy throughout.

| Time | Evidence | Interpretation |
| --- | --- | --- |
| 18.953–18.981 | Hidden system Pause, native time 6.9, readyState 4 | Command reached our handler; explicit Pause retained metadata |
| 26.667 | Visible again, still paused | No hidden system Play is recorded between this Pause and foreground |
| 30.854–31.902 | Buffered native resume; playing/resolved; time 6.9 → 7.0 | Native progress only; owner did not hear resumed sound |
| 35.202–35.238 | Second hidden Pause at time 10.2 | Explicit pause owns cancellation |
| 36.174–36.429 | Hidden Play; native resume chooses buffered; playing/resolved; time remains 10.2 | Native promise and event accepted the request without measured progress |
| 39.941 | Time still 10.2; buffer ahead 4.9 → 0; watchdog observation-grace | Watchdog executes, but its existing nine-second observation has not expired |
| 42.515 | Another hidden Pause | Ends post-Play observation after 6.340 seconds; no automatic recovery had run |
| 43.222–43.224 | Play; attach with reason resume-unbuffered | Explicit same-station reconnection after buffer became empty |
| 43.706–43.708 | Pause; pending play superseded; sessionSeq 1 → 2 | Cancellation of a pending attempt, not evidence of station change |
| 44.027–47.313 | Play; fresh attach; playing/resolved | Reconnection completes while hidden |
| 57.496–87.605 | Native time 9.9 → 40; watchdog ticks advance | Native playback clock runs in background, but owner reports silence |
| 90.018 | Visible again, time 42.5 | Earlier progress did not require foreground |

There is no audio_error, automatic transport_recovery_decision, or Next/Previous
command. The report is an export while recording remained enabled, not a
recording_stopped export. queueSkippable is true wherever supplied; native
duration is live/unknown, never finite. hasMetadata stays true. These fields
describe application state, not actual OS-card ownership or audible output.

## Failing boundaries

1. **Accepted Play without native progress:** observed at 36.175. The existing
   grace window explains why our code did not reconnect before the subsequent
   Pause. This does not make six seconds of silence acceptable and does not
   prove that shortening the window repairs sound.
2. **Advancing media clock without audible output:** confirmed by combining
   the later trace with the owner's answer. A no-progress watchdog cannot
   detect this state. Reloading when time is frozen alone cannot close this
   incident. The lean Apple path has no AudioContext graph; this trace reports
   AudioSession type auto and no readable state. It does not record effective
   system output route, output samples, element volume/mute, or upstream audio
   content. The exact silent-output cause is therefore still unproven.
3. **Wrong installed app activated from Now Playing:** separate observed
   ownership/activation failure. RadioAtlas supplies title/artist/album/artwork
   and transport actions; there is no artwork-click handler or launch URL in
   MediaMetadata. Source search found no retailer URL or Apple association.
   The manifest's missing explicit id is not proof of cross-origin collision.
4. **Wrong OS control layout:** our queue supports skipping but the screenshot
   exposes seek buttons. queueSkippable is policy, not confirmation that native
   action registration was retained. Clearing position/seek state did not
   establish actual iPhone control layout.

General background-JavaScript suspension and a universal inability to reconnect
while hidden are contradicted by the latter part of this recording. The exact
first card-disappearance time and reason are not measured by this recorder.

## Primary-source basis and limits

[Media Session §3.1](https://www.w3.org/TR/mediasession/#user-interface-guidelines)
places return-to-site behavior in the user agent; it supplies no page API to set
the OS parent application's identity.

[WebKit 243258 comment 2](https://bugs.webkit.org/show_bug.cgi?id=243258#c2)
describes a reporter's older hypothesis about multiple installed PWAs, wrong
session association and disappearing controls. It is not confirmation of the
cause on this phone.

[WebKit commit 931c18f / 309886@main](https://github.com/WebKit/WebKit/commit/931c18ff23e25e263edcd26c0fd9b7e2ca063526)
fixes stale Now Playing parent-application state after SafariViewService closes
by clearing MRMediaRemoteSetParentApplication. This demonstrates a native
ownership mechanism and a real related engine defect. Applicability to this
standalone container and presence in the owner's shipped WebKit are unknown.
The private native API is not callable by our web app.

The wrong-parent hypothesis is stronger after the owner identified both apps
as PWAs, but shared causation of wrong activation and silent output remains a
hypothesis. AudioSession auto is not itself an error; the standard computes a
playback type for active HTML media. An explicit playback override would be a
separate experiment, not an established fix.

## Next discriminating check

Keep the existing installations and data. Compare the same NoLife source in
the installed RadioAtlas and an ordinary Safari tab, stopping the prior player
before each trial. Start audibly, background, Pause for three seconds, then
one Play and observe for twenty seconds without additional commands. Record
heard sound separately from clock progress. Separately record which app opens
from the system artwork and whether Next/Previous or ±10 are displayed.

A Safari-only success isolates a standalone/container difference but does not
alone exonerate all application code. If necessary, next isolate a minimal
HTMLAudioElement + MediaSession reproduction from the recovery engine. Do not
combine a handler-rebind, AudioSession override, manifest identity change and
timer change in one experiment. Do not ask the owner to delete another PWA or
clear storage to make a test pass.

This investigation changed documentation only. Existing 7da63c4 automated
results were not rerun and do not override physical failure. No new production
release was made. Raw owner exports remain ignored under
`output/ios-acceptance-20261020-2231/`; they are not added to Git.
