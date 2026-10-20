# Field-report draft: Now Playing opens another installed Home Screen app

Draft only; not submitted to Apple/WebKit. This is not a minimal reproducer.
Do not publish owner exports, screenshots, account information or names of
unrelated private applications automatically.

## Environment

- iPhone, iOS 26.6.1 confirmed by owner in Settings; model/native WebKit build
  not recorded. Browser UA reports an older compatibility OS value.
- RadioAtlas Home Screen web app, originally added from Chrome, standalone.
  Build 7da63c4, https://radioatlas.ru/. Native HTMLAudioElement path, no WebAudio
  graph in this trial. Live station source via same-origin stream proxy.
- Multiple unrelated Home Screen web apps installed on distinct sites.
- Ordinary Safari and Chrome tabs play and handle media controls correctly.

## Observed activation failure

1. Launch RadioAtlas from Home Screen and audibly start live radio.
2. Background it and open iOS system media controls.
3. The system card displays RadioAtlas's station metadata and artwork.
4. Tap that artwork. An unrelated installed Home Screen web app (B) opens.
5. Reinstalling RadioAtlas did not change this wrong target.
6. Owner independently removed B. The same artwork subsequently opens another
   unrelated installed Home Screen web app (C), rather than RadioAtlas.
7. Owner clarifies that radio sound works while C is foreground, but fails
   again when returning to Home or locking the screen. Removing B did not
   establish working background audio.

Expected: activation returns to the web app that supplied the media session.
Actual: another installed web app is activated. Application-switcher screenshots
show distinct applications. Exact native bundle identifiers, continuous gesture
video and a minimal HTML reproducer have not been captured. No claim is made
about which installed-app ordering rule chooses B or C.

## Related audible failure, kept separate

Before B was removed, hidden Pause/Play could deliver the JS Play action, resolve
audio.play(), and eventually advance media time for forty seconds without
audible output. Reinstalling RadioAtlas changed seek controls to Next/Previous
but did not repair sound. After removing B, the owner initially reports audible
operation restored, then qualifies it: sound works only while C is foreground;
Home/screen lock reproduce failure. The initial recovery interpretation is
withdrawn. This supports investigating a link between presenting/host-process
attribution and background audio eligibility, but does not prove that native
mechanism or that B implemented any problematic audio behavior. No native
process/audit-token capture or controlled rechallenge has been performed.

## Web-app and native boundaries

The page publishes standard MediaMetadata title/artist/album/artwork and
play/pause/stop/nexttrack/previoustrack actions. It does not set a native parent
application identifier or an artwork-activation URL. Metadata persists during
Pause. Local opt-in diagnostics distinguish media commands, source attachment,
native play settlement, progress and existing watchdog execution; they do not
measure physical output, effective native route or the activated application.

## Native mechanism worth inspecting, not a diagnosed device fault

Current public WebKit has three related but distinct native paths:

- MediaElementSession.computeNowPlayingInfo uses the page's presenting bundle
  identifier on Cocoa; MediaSessionManagerCocoa passes the source identifier to
  MRMediaRemoteSetParentApplication for Now Playing attribution.
- RemoteAudioSessionProxyManager.updatePresentingProcesses collects active
  presenters' native audit tokens plus the GPU process parent token.
  AudioSessionIOS.setPresentingProcesses passes them to AVAudioSession's
  setAuditTokensForProcessAssertion. This keeps the required presenting
  applications from being suspended during playback.
- Before activation, providePresentingApplicationPID obtains the presenting
  PID from per-page native attribution. MediaSessionHelperIOS passes that PID
  to AVSystemController_PIDToInheritApplicationStateFrom. This is a concrete
  application-state inheritance mechanism, separate from the other two paths.

The Now Playing parent string is NOT the process-assertion token. A bad artwork
activation target does not, by itself, establish that the assertion token is
wrong. The owner's stronger observation is audible output while foreign app C
is foreground, followed by failure on Home/lock. It makes native attribution/
background eligibility a concrete common hypothesis, not a proved causal chain.
These sources are current public main, not the exact installed engine build.

Relevant primary source:

- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/html/MediaElementSession.cpp
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebKit/GPUProcess/media/RemoteAudioSessionProxyManager.cpp
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/audio/ios/AudioSessionIOS.mm
- https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WebCore/platform/audio/ios/MediaSessionHelperIOS.mm

For native investigation, correlate the actual Home Screen host with the
presenting-process attribution and audio interruption/assertion outcome around
the transition from C to Home/lock. The page cannot read these private audit
tokens or assertion results. Do not export raw audit tokens. A minimal same-
origin audio/MediaSession page can isolate the full application, but cannot
identify a wrong native token on its own.

Sol and Astra prefer the minimal native-audio page as the next isolation before
an AudioSession override. It must be reached inside the existing Home Screen
app, confirm standalone, and terminate the main player before loading. One
native element and the same live source, ordinary metadata/Play/Pause only; no
recovery engine, graph, category override, keepalive or new periodic timers.
Compare foreign app C foreground → Home → C foreground on one already-started
stream, without intervening media commands. A repeated failure would establish
that the full recovery engine is unnecessary for the defect; a passing result
would not exonerate it because navigation may reset native state. This isolated
page is not implemented or deployed by this documentation-only investigation.

Potentially related primary records, not asserted duplicates:

- https://bugs.webkit.org/show_bug.cgi?id=243258#c2 — older reporter observation
  about multiple installed PWAs, resume reliability and suspected wrong app.
- https://github.com/WebKit/WebKit/commit/931c18ff23e25e263edcd26c0fd9b7e2ca063526
  — native stale Now Playing parent cleanup after SafariViewService closes;
  applicability/shipping status for this standalone container unknown.
- https://bugs.webkit.org/show_bug.cgi?id=295518 — iOS 26 standalone silent
  audio.play() with working Safari playback, differing reproduction lifecycle.

Next engineering isolation if needed: same-origin minimal native audio plus
MediaSession page accessible from inside the existing installation, preserving
the set of other installed PWAs. No further app removal is needed merely to
obtain a passing result. Filing this draft requires explicit authorization to
communicate externally and evidence redaction/review.
