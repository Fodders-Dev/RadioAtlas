// GENERATED — stations we PROMOTE that do not play.
//
// WHY THIS EXISTS. Radio Browser's own health flag is not evidence. Probed from
// the production VPS on 2026-08-02, every station below answered
// `lastcheckok = 1` ("healthy") while being stone dead, and its last upstream
// check was dated **2026-01-15** — more than six months stale. Two of them are
// the same abandoned RadioKing account (radio id 39218) and two are dead
// zeno.fm mounts; all four return HTTP 401.
//
// It matters more than the raw count suggests. Our per-station health signal is
// learned CLIENT-SIDE, per user, so a dead station on a shelf is rediscovered
// personally by every single newcomer — and a first impression only has to fail
// a couple of times.
//
// SCOPE, deliberately narrow: these ids are dropped from the RANKED DISCOVERY
// SURFACES only (trending, top-voted, mood rails, the spotlights). They remain
// in the catalogue, remain searchable, and remain playable if someone goes
// looking. We are declining to RECOMMEND them, not deleting them — and if a
// station comes back, the next probe simply stops listing it.
//
// ⚠ NOT expressed as `lastcheckok: 0` + a timestamp, which was the first design:
// the client treats upstream health as fresh for only 24h
// (UPSTREAM_HEALTH_FRESH_MS), so a generated file would quietly stop having any
// effect a day after it was written, and back-dating it to "now" on every read
// would be a lie about when we checked.
//
// A station is listed only after failing BOTH a direct connection AND our own
// media proxy, twice each. Regenerate with scripts/probeRankedHealth.mjs.
export const DEAD_STREAMS_VERIFIED_ON = '2026-08-02';

/** [stationuuid, name — observed failure] */
export const DEAD_STREAMS: ReadonlyArray<readonly [string, string]> = [
  ['332f6491-d62d-48a4-b44a-fa8020896949', 'Equinoxe Radio — http 401 (radioking 39218)'],
  ['7567b9e4-6e63-4708-8df5-92be2f5ce47c', 'Radio Djerdan (MP3) — http 401 (zeno.fm)'],
  ['9619271d-0601-11e8-ae97-52543be04c81', 'Kane FM — timeout'],
  ['964b07c5-d89d-4b37-b5f1-dfddbac876c5', 'CRTV Radio — http 401 (radioking 39218)'],
  ['c0c4b436-3c7a-432e-98b5-9c768264dce5', 'Radio Blues Djerdan — http 401 (zeno.fm)']
];

export const DEAD_STREAM_IDS: ReadonlySet<string> = new Set(DEAD_STREAMS.map(([id]) => id));
