# Installed Apple PWA: explicit playback category

The main player acquires a playback category at an explicit station start or
Resume, so the owner no longer needs to visit the diagnostic lab first. This
is a bounded mitigation supported by repeated audible physical lab trials,
not a claim that the underlying WebKit/native ownership defect is identified.
The owner's refresh/reopen contrast is an observation, not a failed automatic
Play captured by the most recent lab export.

Only installed Apple WebKit PWA and readable original auto are eligible.
Ordinary browser tabs and Android perform no category writes. Existing playback
and other categories are not taken over. Constructor/mount/persisted restoration
do not apply the policy. Assignment/readback failures never block native Play.
One attempt belongs to the listening interval: Pause, station switching,
errors/retries and visibility retain it. Terminal Stop/unmount invalidate the
pending attempt and pause first, then conditionally restore an owned override
only while its current type is still playback. The next explicit Play can
acquire again. No new pagehide/BFCache policy, recovery, timers, source selection,
handler registration, UI or lab changes are part of this release.

Optional local diagnostics include bounded category outcomes, distinguish
assignment failure from ignored/unknown readback, and independently guard
session/type/state getters. Readback remains a JS observation, not effective
native category or audible output. No network telemetry was added.

Luna implemented, Sol reviewed/integrated/verified, Astra independently reviewed
the final source and lifecycle without a blocking defect. Both typechecks pass,
994webunits/119files pass, full serial functional463passed/7skips(13.1min) passes,
build passes. Four review-only mutations trigger the
same assertions: release-on-Pause, missing Stop release, missing unmount release,
and overwriting another writer's changed category. Baseline passes; each mutant
fails with AssertionError. No tracked source was mutated. The new hook fixture
tests a pending/retry path rather than an established buffered-current stream;
existing complete resume suites check that transport behavior.

Full functional, exact-SHA CI/deploy and public smoke receipts live locally in
output/main-pwa-category; a commit alone is not a publication receipt. No gate
may be bypassed. Frozen web sources must remain unchanged during the full run.

## Physical acceptance after publication

1. Refresh/reopen the existing RadioAtlas installation, verify the published
   build and start the normal player WITHOUT entering the lab or setting a box.
2. Hear initial sound, Home/lock, Pause5s and Play on the named station card,
   listen20s in background, repeat after another fresh app launch.
3. With a known multi-station queue, test Next/Previous and Pause/Play again.
   Owner confirms +/-10 currently appears in normal RadioAtlas, not just the
   one-station lab. Existing JS disables live seeks and exposes queue handlers
   only for queue>=2; actual iOS symbols and delivery are still to be observed.
4. Longer pause, call interruption and system artwork opening another PWA stay
   OPEN. If the card disappears, do not press empty NotPlaying Play; it may start
   Apple Music according to the owner. No more PWA deletion/reinstallation.

Only physical audible results can close these checks. See
[implementation contract](CONTRACT-main-pwa-playback-category-2026-10-23.md) and
[physical evidence chronology](IOS-PLAYBACK-TRIAL-04577b9-2026-10-23.md).
