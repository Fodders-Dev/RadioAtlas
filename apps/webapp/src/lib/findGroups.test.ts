import { describe, expect, it } from 'vitest';

import { filterFinds, groupFinds, monthGroupLabel, normalizeFindQuery } from './findGroups';
import type { TrackHistoryItem } from '../state/radio/types';

/**
 * Grouping and search for «Находки».
 *
 * The clock is an argument rather than a call to `Date.now()` inside, which is
 * the only reason the midnight boundary below can be tested at all.
 */

const AT = new Date(2026, 8, 4, 15, 0, 0).getTime(); // 4 Sep 2026, 15:00 local
const DAY = 86_400_000;

const find = (id: string, timestamp: number, over: Partial<TrackHistoryItem> = {}): TrackHistoryItem => ({
  id,
  stationId: `station-${id}`,
  stationName: 'Radio Paradise',
  track: 'Gnarls Barkley - Accept It',
  timestamp,
  ...over
});

describe('grouping coarsens as finds age', () => {
  it('puts anything from today under one heading', () => {
    const groups = groupFinds([find('a', AT - 3600_000), find('b', AT - 7200_000)], AT);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('today');
    expect(groups[0].items).toHaveLength(2);
  });

  it('separates yesterday from today across midnight, not across 24 hours', () => {
    // 00:30 today and 23:30 yesterday are ONE hour apart and belong to
    // different days. A naive `now - 24h` test would call both "today".
    const justAfterMidnight = new Date(2026, 8, 4, 0, 30).getTime();
    const justBefore = new Date(2026, 8, 3, 23, 30).getTime();
    const groups = groupFinds([find('a', justAfterMidnight), find('b', justBefore)], AT);
    expect(groups.map((g) => g.key)).toEqual(['today', 'yesterday']);
  });

  it('collapses the rest of the week into one bucket', () => {
    const groups = groupFinds(
      [find('a', AT - 3 * DAY), find('b', AT - 4 * DAY), find('c', AT - 5 * DAY)],
      AT
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('week');
    expect(groups[0].items).toHaveLength(3);
  });

  it('buckets older finds by calendar month', () => {
    const groups = groupFinds(
      [
        find('a', new Date(2026, 7, 20, 12).getTime()),
        find('b', new Date(2026, 7, 2, 12).getTime()),
        find('c', new Date(2026, 6, 15, 12).getTime())
      ],
      AT
    );
    expect(groups.map((g) => g.key)).toEqual(['month', 'month']);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
  });

  it('does NOT merge the same month from different years', () => {
    // ⚠ Keyed on the month alone, «Август» 2026 and «Август» 2025 become one
    // heading with a wrong count and finds a year apart sitting together.
    const groups = groupFinds(
      [find('a', new Date(2026, 7, 10, 12).getTime()), find('b', new Date(2025, 7, 10, 12).getTime())],
      AT
    );
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.id)).size).toBe(2);
  });

  it('orders groups and rows newest-first regardless of input order', () => {
    const groups = groupFinds(
      [
        find('old', new Date(2026, 6, 1, 12).getTime()),
        find('now', AT - 60_000),
        find('mid', AT - 2 * DAY)
      ],
      AT
    );
    expect(groups.map((g) => g.key)).toEqual(['today', 'week', 'month']);
    expect(groups[0].items[0].id).toBe('now');
  });

  it('keeps every find — grouping must never drop one', () => {
    const items = Array.from({ length: 60 }, (_, i) => find(`f${i}`, AT - i * 6 * 3600_000));
    const total = groupFinds(items, AT).reduce((sum, g) => sum + g.items.length, 0);
    expect(total).toBe(60);
  });
});

describe('search is over what a person remembers', () => {
  const items = [
    find('a', AT, { track: 'Gnarls Barkley - Accept It', stationName: 'Radio Paradise' }),
    find('b', AT, { track: 'Boards of Canada - Roygbiv', stationName: 'SomaFM Groove Salad' }),
    find('c', AT, { track: 'Гражданская оборона - Всё идёт по плану', stationName: 'Наше Радио' })
  ];

  it('matches on the track', () => {
    expect(filterFinds(items, 'roygbiv').map((i) => i.id)).toEqual(['b']);
  });

  it('matches on the station', () => {
    expect(filterFinds(items, 'somafm').map((i) => i.id)).toEqual(['b']);
  });

  it('is case-insensitive', () => {
    expect(filterFinds(items, 'GNARLS').map((i) => i.id)).toEqual(['a']);
  });

  it('folds ё and е, because nobody types the spelling the station used', () => {
    expect(filterFinds(items, 'все идет').map((i) => i.id)).toEqual(['c']);
    expect(filterFinds(items, 'всё идёт').map((i) => i.id)).toEqual(['c']);
  });

  it('matches words in any order', () => {
    expect(filterFinds(items, 'accept barkley').map((i) => i.id)).toEqual(['a']);
    expect(filterFinds(items, 'barkley accept').map((i) => i.id)).toEqual(['a']);
  });

  it('returns everything for an empty or whitespace query', () => {
    expect(filterFinds(items, '')).toHaveLength(3);
    expect(filterFinds(items, '   ')).toHaveLength(3);
  });

  it('returns nothing rather than everything when there is no match', () => {
    expect(filterFinds(items, 'zzzz')).toHaveLength(0);
  });

  it('normalizes whitespace so a stray double space still finds the track', () => {
    expect(normalizeFindQuery('  Gnarls   Barkley ')).toBe('gnarls barkley');
    expect(filterFinds(items, '  Gnarls   Barkley ').map((i) => i.id)).toEqual(['a']);
  });
});

describe('a month heading shows the year only when it carries information', () => {
  const NOW_2026 = new Date(2026, 8, 4, 15).getTime();

  it('omits the year for a month in the current year', () => {
    const label = monthGroupLabel(new Date(2026, 7, 1).getTime(), NOW_2026, 'ru');
    // «АВГУСТ 2026 Г.» for the month you are living in reads like a filing
    // cabinet, and Intl appends «г.» in Russian on top of the number.
    expect(label).not.toMatch(/2026/);
    expect(label.toLowerCase()).toContain('август');
  });

  it('shows the year for a month in a previous year', () => {
    const label = monthGroupLabel(new Date(2025, 7, 1).getTime(), NOW_2026, 'ru');
    expect(label).toContain('2025');
    expect(label.toLowerCase()).toContain('август');
  });

  it('gives two Augusts a year apart DIFFERENT headings', () => {
    // ⚠ The reason the year cannot simply be dropped: finds are long-lived, and
    // one heading covering two years would be a lie with a wrong count.
    const thisYear = monthGroupLabel(new Date(2026, 7, 1).getTime(), NOW_2026, 'ru');
    const lastYear = monthGroupLabel(new Date(2025, 7, 1).getTime(), NOW_2026, 'ru');
    expect(thisYear).not.toBe(lastYear);
  });

  it('keeps them separate groups regardless of what is printed', () => {
    const groups = groupFinds(
      [find('a', new Date(2026, 7, 10, 12).getTime()), find('b', new Date(2025, 7, 10, 12).getTime())],
      NOW_2026
    );
    expect(groups).toHaveLength(2);
    const labels = groups.map((g) => monthGroupLabel(g.monthStart || 0, NOW_2026, 'ru'));
    expect(new Set(labels).size).toBe(2);
  });
});
