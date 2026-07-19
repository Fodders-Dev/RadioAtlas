import { describe, expect, it } from 'vitest';
import { buildStationFeed } from './stationFeed';
import type { StationLite } from '../types';

const station = (id: string, extra: Partial<StationLite> = {}): StationLite =>
  ({
    stationuuid: id,
    name: `Station ${id}`,
    url_resolved: `https://stream/${id}`,
    favicon: '',
    tags: '',
    country: '',
    countrycode: '',
    state: '',
    ...extra
  }) as StationLite;

const ids = (stations: StationLite[]) => stations.map((s) => s.stationuuid);

const range = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => station(`${prefix}${i}`));

describe('buildStationFeed', () => {
  it('deduplicates a station that appears in multiple sources (taste wins)', () => {
    const shared = station('shared');
    const feed = buildStationFeed({
      tasteStations: [shared, station('t1')],
      trending: [shared, station('r1')],
      pool: [shared, station('p1')],
      seed: 7
    });
    expect(ids(feed).filter((id) => id === 'shared')).toHaveLength(1);
    // every id is unique
    expect(new Set(ids(feed)).size).toBe(feed.length);
  });

  it('drops stations without a playable url', () => {
    const feed = buildStationFeed({
      tasteStations: [station('ok'), station('dead', { url_resolved: '' })],
      trending: [],
      pool: [],
      seed: 1
    });
    expect(ids(feed)).toEqual(['ok']);
  });

  it('mixes the sources rather than concatenating them', () => {
    const feed = buildStationFeed({
      tasteStations: range('t', 6),
      trending: range('r', 6),
      pool: [],
      seed: 42
    });
    // A pure concat would be all t* then all r*. The weighted interleave must
    // thread trending into the taste-led head (both sources present up top).
    const head = ids(feed).slice(0, 6);
    expect(head.some((id) => id.startsWith('t'))).toBe(true);
    expect(head.some((id) => id.startsWith('r'))).toBe(true);
    // Taste is the highest-weight source → it dominates the overall feed.
    expect(ids(feed).filter((id) => id.startsWith('t'))).toHaveLength(6);
  });

  it('keeps random discovery rare (bounded by randomRatio)', () => {
    const feed = buildStationFeed({
      tasteStations: range('t', 30),
      trending: range('r', 30),
      pool: range('p', 200),
      seed: 5,
      limit: 40,
      randomRatio: 0.18
    });
    const randomCount = ids(feed).filter((id) => id.startsWith('p')).length;
    // ceil-ish of 40*0.18 ≈ 7; never floods the feed with random.
    expect(randomCount).toBeLessThanOrEqual(8);
    expect(feed.length).toBeLessThanOrEqual(40);
  });

  // randomRatio: 0 means EXACTLY zero — it outranks both the 2-item floor and
  // the poolIsPrimary widening. «Популярное» relies on this to guarantee that
  // every card it shows carries a real popularity signal (lib/feedFilters).
  it('randomRatio: 0 admits no random discovery at all', () => {
    const withTrending = buildStationFeed({
      tasteStations: [],
      trending: range('r', 5),
      pool: range('p', 200),
      seed: 5,
      limit: 40,
      randomRatio: 0
    });
    expect(ids(withTrending).filter((id) => id.startsWith('p'))).toHaveLength(0);
    expect(ids(withTrending).every((id) => id.startsWith('r'))).toBe(true);

    // Even with NO named source left — where the pool would normally be
    // promoted to primary and used whole — zero still means zero, so the caller
    // gets an honestly empty deck rather than a random one under its label.
    const nothingNamed = buildStationFeed({
      tasteStations: [],
      trending: [],
      pool: range('p', 200),
      seed: 5,
      limit: 40,
      randomRatio: 0
    });
    expect(nothingNamed).toEqual([]);
  });

  // The default and any positive ratio must be untouched by the above.
  it('leaves the default random tail exactly as it was', () => {
    const feed = buildStationFeed({
      tasteStations: range('t', 30),
      trending: range('r', 30),
      pool: range('p', 200),
      seed: 5,
      limit: 40
    });
    expect(ids(feed).filter((id) => id.startsWith('p')).length).toBeGreaterThan(0);
  });

  it('drops non-music/generalist stations from every feed source', () => {
    const feed = buildStationFeed({
      tasteStations: [
        station('rtl', { name: 'RTL', country: 'France', tags: 'généraliste' }),
        station('rtl2', { name: 'RTL2', country: 'France', tags: 'rock,pop' })
      ],
      trending: [station('bbc-talk', { name: 'BBC Talk', tags: 'news,talk' }), station('music')],
      pool: [station('politics', { name: 'Politics FM', tags: 'politics,news' })],
      seed: 9
    });
    expect(ids(feed)).not.toContain('rtl');
    expect(ids(feed)).not.toContain('bbc-talk');
    expect(ids(feed)).not.toContain('politics');
    expect(ids(feed)).toEqual(expect.arrayContaining(['rtl2', 'music']));
  });

  it('is deterministic for a fixed seed and reshuffles when the seed changes', () => {
    const withPool = {
      tasteStations: range('t', 8),
      trending: range('r', 8),
      pool: range('p', 30)
    };
    const a = ids(buildStationFeed({ ...withPool, seed: 100 }));
    const b = ids(buildStationFeed({ ...withPool, seed: 100 }));
    const c = ids(buildStationFeed({ ...withPool, seed: 999 }));
    expect(a).toEqual(b); // same seed → byte-identical
    expect(a).not.toEqual(c); // different seed → reshuffled (and different random picks)

    // With no random pool the membership is fixed, so a seed change permutes the
    // SAME stations rather than swapping any in.
    const noPool = { tasteStations: range('t', 8), trending: range('r', 8), pool: [] };
    const d = ids(buildStationFeed({ ...noPool, seed: 100 }));
    const e = ids(buildStationFeed({ ...noPool, seed: 999 }));
    expect(d).not.toEqual(e);
    expect([...d].sort()).toEqual([...e].sort());
  });

  it('uses the whole pool when there is no taste and no trending (fresh user)', () => {
    // A brand-new user has only a catalog pool. The random budget (~7 of 40)
    // must NOT cap the feed when it is the ONLY source — the pool IS the feed.
    const feed = buildStationFeed({
      tasteStations: [],
      trending: [],
      pool: range('p', 30),
      seed: 3,
      limit: 40
    });
    expect(feed).toHaveLength(30); // full pool, not the ~7-item random budget
    expect(ids(feed).every((id) => id.startsWith('p'))).toBe(true);
    // Still capped by `limit` when the pool is larger than the target size.
    const capped = buildStationFeed({
      tasteStations: [],
      trending: [],
      pool: range('p', 90),
      seed: 3,
      limit: 40
    });
    expect(capped).toHaveLength(40);
  });

  it('keeps the pool RARE once any taste or trending signal exists', () => {
    // With a trending signal present, the pool returns to its rare-discovery
    // budget — it must not flood the feed.
    const feed = buildStationFeed({
      tasteStations: [],
      trending: range('r', 6),
      pool: range('p', 200),
      seed: 3,
      limit: 40
    });
    const randomCount = ids(feed).filter((id) => id.startsWith('p')).length;
    expect(randomCount).toBeLessThanOrEqual(8);
  });

  it('excludes the user\'s own stations (favorites/recent/current) from every source', () => {
    // The exclude-set is applied BEFORE weighting, to ALL sources, so a station
    // the user already has never shows up — even if taste AND trending list it.
    const feed = buildStationFeed({
      tasteStations: [station('t0'), station('fav1'), station('t1')],
      trending: [station('fav1'), station('r0')],
      pool: [station('cur'), station('p0')],
      seed: 4,
      exclude: ['fav1', 'cur']
    });
    expect(ids(feed)).not.toContain('fav1');
    expect(ids(feed)).not.toContain('cur');
    expect(ids(feed)).toEqual(expect.arrayContaining(['t0', 't1', 'r0', 'p0']));
  });

  it('drops stations that fail the liveness gate from every source', () => {
    const dead = new Set(['dead1', 'dead2']);
    const feed = buildStationFeed({
      tasteStations: [station('t0'), station('dead1')],
      trending: [station('dead2'), station('r0')],
      pool: [station('p0')],
      seed: 2,
      isLive: (s) => !dead.has(s.stationuuid)
    });
    expect(ids(feed)).not.toContain('dead1');
    expect(ids(feed)).not.toContain('dead2');
    expect(ids(feed)).toEqual(expect.arrayContaining(['t0', 'r0']));
  });

  it('rotates card 0 inside the strongest personal pool', () => {
    // Opening the feed must land on «твой вайб», but not the exact same station
    // every time. The lead rotates among the strongest personal candidates.
    const taste = range('t', 5);
    const shared = { tasteStations: taste, trending: range('r', 5), pool: range('p', 20) };
    const feeds = Array.from({ length: 8 }, (_, index) =>
      buildStationFeed({ ...shared, seed: index + 11 })
    );
    const leads = new Set(feeds.map((feed) => feed[0]?.stationuuid));
    expect(leads.size).toBeGreaterThan(1);
    expect([...leads].every((id) => ['t0', 't1', 't2', 't3'].includes(id || ''))).toBe(true);
    // The lead is pinned exactly once — never duplicated back into the weighted mix.
    for (const feed of feeds) {
      expect(ids(feed).filter((id) => id === feed[0]?.stationuuid)).toHaveLength(1);
    }
    // The tail still permutes per seed (only the lead is fixed).
    expect(ids(feeds[0]!).slice(1)).not.toEqual(ids(feeds[1]!).slice(1));
  });

  it('per-open re-seed (rerollFeedSeed) yields a fresh mix each open while keeping a personal lead', () => {
    // Every «Лента» open mints a new seed (rerollFeedSeed → setFeedSeed(Date.now())),
    // so two opens of the SAME inputs reshuffle for freshness but keep card 0
    // inside the personal top pool (so "open → plays your vibe" holds each time).
    const shared = { tasteStations: range('t', 6), trending: range('r', 6), pool: range('p', 20) };
    const open1 = ids(buildStationFeed({ ...shared, seed: 1700000000001 }));
    const open2 = ids(buildStationFeed({ ...shared, seed: 1700000000002 }));
    expect(open1).not.toEqual(open2); // fresh mix per open
    expect(open1[0]).toMatch(/^t[0-3]$/);
    expect(open2[0]).toMatch(/^t[0-3]$/);
  });

  it('card 0 falls through when the top taste pick is excluded or dead', () => {
    const feed = buildStationFeed({
      tasteStations: [station('t0'), station('t1'), station('t2')],
      trending: [],
      pool: [],
      seed: 6,
      exclude: ['t0'],
      isLive: (s) => s.stationuuid !== 't1'
    });
    // t0 excluded, t1 dead → t2 is the strongest AVAILABLE personal pick.
    expect(feed[0].stationuuid).toBe('t2');
  });

  // ---------------------------------------------------------------------
  // pinFirst — the Home hero expanded into the feed. These four cases are the
  // cheapest guard against the one silent way this feature can violate #86: if
  // the pin is ever dropped, resolveFeedEntry's findIndex returns -1, seedPlayed
  // seeds the WRONG card, and the observer's first fire plays a different
  // station on a passive open.
  // ---------------------------------------------------------------------
  it('pins the entry station at index 0 even though it is in `exclude`', () => {
    // This is the normal now-playing case: StationFeed always puts the current
    // station in `exclude`, and the hero the user pulled IS the current station.
    const hero = station('hero');
    const feed = buildStationFeed({
      tasteStations: range('t', 5),
      trending: range('r', 3),
      pool: range('p', 3),
      seed: 11,
      exclude: ['hero'],
      pinFirst: hero
    });
    expect(feed[0].stationuuid).toBe('hero');
  });

  it('pins the entry station even when the liveness gate would reject it', () => {
    const hero = station('hero');
    const feed = buildStationFeed({
      tasteStations: range('t', 4),
      trending: [],
      pool: [],
      seed: 3,
      isLive: (s) => s.stationuuid !== 'hero',
      pinFirst: hero
    });
    expect(feed[0].stationuuid).toBe('hero');
  });

  it('pins the entry station even when it fails the feed eligibility filter', () => {
    // A talk/news station is normally denied a feed card; the card the gesture is
    // morphing FROM is not up for debate.
    const hero = station('hero', { name: 'City News Talk', tags: 'news,talk' });
    const feed = buildStationFeed({
      tasteStations: range('t', 4),
      trending: [],
      pool: [],
      seed: 5,
      pinFirst: hero
    });
    expect(feed[0].stationuuid).toBe('hero');
  });

  it('never lets the pinned station appear twice, whichever source also holds it', () => {
    const hero = station('hero');
    const feed = buildStationFeed({
      tasteStations: [hero, ...range('t', 4)],
      trending: [hero, ...range('r', 3)],
      pool: [hero, ...range('p', 3)],
      seed: 13,
      pinFirst: hero
    });
    expect(ids(feed).filter((id) => id === 'hero')).toHaveLength(1);
    expect(feed[0].stationuuid).toBe('hero');
  });

  it('ignores an unplayable pin rather than seating a dead card at index 0', () => {
    const feed = buildStationFeed({
      tasteStations: range('t', 4),
      trending: [],
      pool: [],
      seed: 9,
      pinFirst: station('hero', { url_resolved: '' })
    });
    expect(ids(feed)).not.toContain('hero');
    expect(feed.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------
  // `include` — the single seam the «Лента» filter chips run through
  // (lib/feedFilters.ts). It must gate DISCOVERY cards only; card 0 is the
  // station the feed was entered from and no filter may displace it.
  // ---------------------------------------------------------------------
  it('applies `include` to every source', () => {
    const feed = buildStationFeed({
      tasteStations: [station('keep-t'), station('drop-t')],
      trending: [station('keep-r'), station('drop-r')],
      pool: [station('keep-p'), station('drop-p')],
      seed: 21,
      include: (s) => s.stationuuid.startsWith('keep')
    });
    expect(ids(feed).every((id) => id.startsWith('keep'))).toBe(true);
    expect(ids(feed)).toContain('keep-t');
    expect(ids(feed)).not.toContain('drop-t');
  });

  it('composes `include` with isLive and the eligibility filter (all must pass)', () => {
    const feed = buildStationFeed({
      tasteStations: [
        station('ok'),
        station('not-included'),
        station('dead'),
        station('talky', { name: 'Morning News Talk', tags: 'news' })
      ],
      trending: [],
      pool: [],
      seed: 4,
      isLive: (s) => s.stationuuid !== 'dead',
      include: (s) => s.stationuuid !== 'not-included'
    });
    expect(ids(feed)).toEqual(['ok']);
  });

  it('does NOT let `include` veto pinFirst', () => {
    // #86 keystone: the pin is passed in every filter branch, so a chip tap can
    // never move the user off the card they entered on — even a filter whose
    // predicate rejects that very station.
    const hero = station('hero');
    const feed = buildStationFeed({
      tasteStations: range('t', 4),
      trending: [],
      pool: [],
      seed: 17,
      include: (s) => s.stationuuid !== 'hero',
      pinFirst: hero
    });
    expect(feed[0].stationuuid).toBe('hero');
    expect(ids(feed).filter((id) => id === 'hero')).toHaveLength(1);
  });

  it('defaults `include` to "everything passes"', () => {
    const withDefault = buildStationFeed({
      tasteStations: range('t', 5),
      trending: range('r', 3),
      pool: range('p', 3),
      seed: 33
    });
    const withExplicitAllow = buildStationFeed({
      tasteStations: range('t', 5),
      trending: range('r', 3),
      pool: range('p', 3),
      seed: 33,
      include: () => true
    });
    expect(ids(withDefault)).toEqual(ids(withExplicitAllow));
  });

  it('handles empty sources without throwing', () => {
    expect(buildStationFeed({ tasteStations: [], trending: [], pool: [], seed: 1 })).toEqual([]);
    const tasteOnly = buildStationFeed({
      tasteStations: range('t', 3),
      trending: [],
      pool: [],
      seed: 1
    });
    expect(ids(tasteOnly).every((id) => id.startsWith('t'))).toBe(true);
    expect(tasteOnly).toHaveLength(3);
  });
});
