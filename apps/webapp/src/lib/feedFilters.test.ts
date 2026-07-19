import { describe, expect, it } from 'vitest';
import { isFeedFilterAvailable, resolveFeedFilterSources } from './feedFilters';
import { buildStationFeed } from './stationFeed';
import type { StationExposureLedger } from './stationExposure';
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

const shown = (...stationIds: string[]): StationExposureLedger =>
  Object.fromEntries(
    stationIds.map((id) => [id, { lastShownAt: Date.now(), shownCount: 1 }])
  );

const taste = [station('t0'), station('t1'), station('t2')];
const trending = [station('r0'), station('r1')];
const popular = [station('pop0'), station('pop1'), station('pop2')];

describe('resolveFeedFilterSources', () => {
  it('«Подборка» is the identity case — today\'s exact taste-led call', () => {
    const sources = resolveFeedFilterSources({
      filter: 'picks',
      taste,
      trending,
      popular,
      exposure: shown('t0')
    });
    expect(sources.tasteStations).toBe(taste);
    expect(sources.trending).toBe(trending);
    // No predicate at all: «Подборка» must not quietly filter anything.
    expect(sources.include).toBeUndefined();
  });

  it('«Популярное» leads with the server-ranked popular set and drops the taste deck', () => {
    const sources = resolveFeedFilterSources({
      filter: 'popular',
      taste,
      trending,
      popular,
      exposure: null
    });
    // Emptying tasteStations is what flips buildStationFeed's weights to
    // 0 / 0.64 / 0.36 — the popular set leads without touching the core.
    expect(sources.tasteStations).toEqual([]);
    expect(sources.trending).toBe(popular);
  });

  it('«Новое для тебя» excludes stations the exposure ledger has recently shown', () => {
    const sources = resolveFeedFilterSources({
      filter: 'fresh',
      taste,
      trending,
      popular,
      exposure: shown('t0', 'r1')
    });
    expect(sources.include).toBeDefined();
    expect(sources.include?.(station('t0'))).toBe(false);
    expect(sources.include?.(station('r1'))).toBe(false);
    expect(sources.include?.(station('t2'))).toBe(true);
  });

  it('«Новое для тебя» keeps everything when the ledger is empty or missing', () => {
    const empty = resolveFeedFilterSources({
      filter: 'fresh',
      taste,
      trending,
      popular,
      exposure: {}
    });
    expect(empty.include?.(station('t0'))).toBe(true);
    const missing = resolveFeedFilterSources({
      filter: 'fresh',
      taste,
      trending,
      popular,
      exposure: null
    });
    expect(missing.include?.(station('t0'))).toBe(true);
  });
});

describe('isFeedFilterAvailable', () => {
  const seen = (id: string): StationExposureLedger => ({
    [id]: { lastShownAt: Date.now(), shownCount: 1 }
  });

  it('hides «Популярное» when the server sent no popular set', () => {
    // Not "degrade to the default mix" — that would be a lie under the label —
    // and not a disabled chip, which reads as broken. The control is absent.
    expect(isFeedFilterAvailable('popular', { popular: [] })).toBe(false);
    expect(isFeedFilterAvailable('popular', { popular })).toBe(true);
  });

  // «Новое для тебя» excludes stations the ledger has already shown you. With an
  // EMPTY ledger it excludes nothing, so it rebuilds a byte-identical deck and
  // the chip visibly does nothing when tapped — the same "dead control" failure
  // «LIVE» was dropped for. Absent, not disabled.
  it('hides «Новое для тебя» until the exposure ledger has something to exclude', () => {
    expect(isFeedFilterAvailable('fresh', { popular: [] })).toBe(false);
    expect(isFeedFilterAvailable('fresh', { popular: [], exposure: null })).toBe(false);
    expect(isFeedFilterAvailable('fresh', { popular: [], exposure: {} })).toBe(false);
    expect(isFeedFilterAvailable('fresh', { popular: [], exposure: seen('t1') })).toBe(true);
  });

  it('always offers «Подборка»', () => {
    expect(isFeedFilterAvailable('picks', { popular: [] })).toBe(true);
    expect(isFeedFilterAvailable('picks', { popular: [], exposure: {} })).toBe(true);
  });
});

describe('feed filters through buildStationFeed', () => {
  const build = (filter: 'picks' | 'fresh' | 'popular', exposure: StationExposureLedger | null) =>
    buildStationFeed({
      ...resolveFeedFilterSources({ filter, taste, trending, popular, exposure }),
      pool: [station('p0'), station('p1')],
      seed: 42,
      limit: 40
    });

  it('«Подборка» surfaces the taste deck', () => {
    expect(ids(build('picks', null))).toContain('t0');
  });

  it('«Новое для тебя» really removes seen stations from the built deck', () => {
    const feed = build('fresh', shown('t0', 't1'));
    expect(ids(feed)).not.toContain('t0');
    expect(ids(feed)).not.toContain('t1');
    expect(ids(feed)).toContain('t2');
  });

  it('«Популярное» really surfaces the popular set over the taste deck', () => {
    const feed = build('popular', null);
    expect(feed[0].stationuuid.startsWith('pop')).toBe(true);
    expect(ids(feed)).not.toContain('t0');
  });

  // A station with NO popularity signal must never appear under a popularity
  // label. Emptying tasteStations alone does not achieve that: it flips the
  // weights to trending 0.64 / random 0.36, and the interleave key
  // (indexInSource + jitter)/weight lets random[0] (min key 0/0.36) sort AHEAD
  // of popular[1] (min key 1/0.64 = 1.56) — so the random pool leaks into the
  // TOP of the deck, not into a tail. Measured against the real app before
  // randomRatio: 0, card 4 of 6 carried no popularity signal at all.
  it('«Популярное» contains ONLY the server-ranked popular set — no random padding', () => {
    const feed = build('popular', null);
    const popularIds = popular.map((s) => s.stationuuid);
    expect(feed.length).toBeGreaterThan(0);
    ids(feed).forEach((id) => expect(popularIds).toContain(id));
    // …and specifically not the random pool the other filters draw a tail from.
    expect(ids(feed)).not.toContain('p0');
    expect(ids(feed)).not.toContain('p1');
  });

  // The pin is the ONE exception, and it is the #86 keystone: card 0 is the
  // station the feed was entered from under every filter.
  it('«Популярное» still pins the entry station even though it is not popular', () => {
    const hero = station('hero');
    const feed = buildStationFeed({
      ...resolveFeedFilterSources({ filter: 'popular', taste, trending, popular, exposure: null }),
      pool: [station('p0')],
      seed: 42,
      exclude: ['hero'],
      pinFirst: hero
    });
    expect(feed[0].stationuuid).toBe('hero');
    expect(ids(feed).slice(1).every((id) => id.startsWith('pop'))).toBe(true);
  });

  it('every filter keeps the entry station pinned at card 0 (#86)', () => {
    const hero = station('hero');
    (['picks', 'fresh', 'popular'] as const).forEach((filter) => {
      const feed = buildStationFeed({
        ...resolveFeedFilterSources({
          filter,
          taste,
          trending,
          popular,
          // The hero is deliberately in the ledger AND in `exclude`: neither the
          // filter predicate nor the exclude set may displace card 0.
          exposure: shown('hero')
        }),
        pool: [station('p0')],
        seed: 42,
        exclude: ['hero'],
        pinFirst: hero
      });
      expect(feed[0].stationuuid).toBe('hero');
    });
  });
});
