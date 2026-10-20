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

Expected: activation returns to the web app that supplied the media session.
Actual: another installed web app is activated. Application-switcher screenshots
show distinct applications. Exact native bundle identifiers, continuous gesture
video and a minimal HTML reproducer have not been captured. No claim is made
about which installed-app ordering rule chooses B or C.

## Related audible failure, kept separate

Before B was removed, hidden Pause/Play could deliver the JS Play action, resolve
audio.play(), and eventually advance media time for forty seconds without
audible output. Reinstalling RadioAtlas changed seek controls to Next/Previous
but did not repair sound. After removing B, the owner reports audible player
operation restored, although artwork still opens C. This suggests environment
state matters, but does not prove that incorrect activation causes silence or
that B implemented any problematic audio behavior. No controlled rechallenge
or long-term verification has been performed.

## Web-app and native boundaries

The page publishes standard MediaMetadata title/artist/album/artwork and
play/pause/stop/nexttrack/previoustrack actions. It does not set a native parent
application identifier or an artwork-activation URL. Metadata persists during
Pause. Local opt-in diagnostics distinguish media commands, source attachment,
native play settlement, progress and existing watchdog execution; they do not
measure physical output, effective native route or the activated application.

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
