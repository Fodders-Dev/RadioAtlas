import type { TrackHistoryItem } from '../state/radio/types';

/**
 * How a shelf of finds is ordered on screen, and what search means over it.
 *
 * Kept out of the component on purpose: the interesting decisions here are
 * about time and text, both of which are cheap to get subtly wrong and
 * expensive to notice through a browser.
 */

export type FindGroupKey = 'today' | 'yesterday' | 'week' | 'month' | 'older';

export type FindGroup = {
  /** Stable id — `month:2026-08` for months, the bucket name otherwise. */
  id: string;
  key: FindGroupKey;
  /** For `month`, the first day of that month; lets the view name it in any locale. */
  monthStart?: number;
  items: TrackHistoryItem[];
};

const startOfDay = (at: number) => {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const DAY = 86_400_000;

/**
 * Group finds newest-first, coarsening as they age.
 *
 * `Сегодня` and `Вчера` are exact days; then one `Эта неделя` bucket; then one
 * bucket per calendar month. Deliberately NOT a heading per day for the whole
 * history — at two hundred finds that produces a second wall, this one made of
 * dates, and the row already carries its own timestamp.
 *
 * ⚠ Time is taken as an argument rather than read from the clock. A function
 * that calls `Date.now()` internally cannot be tested for the boundary that
 * matters — the one at midnight — and this repo has already been bitten by a
 * clock inside a component (#234, where freezing it stalled the queue).
 */
export const groupFinds = (items: readonly TrackHistoryItem[], now: number): FindGroup[] => {
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - DAY;
  // "This week" is the six days before yesterday, not an ISO week: a listener
  // asking «на этой неделе» means recent, not "since Monday", and an ISO week
  // makes Monday morning erase the whole bucket.
  const weekStart = todayStart - 6 * DAY;

  const ordered = [...items].sort((left, right) => right.timestamp - left.timestamp);
  const groups: FindGroup[] = [];
  const byId = new Map<string, FindGroup>();

  const push = (id: string, key: FindGroupKey, item: TrackHistoryItem, monthStart?: number) => {
    let group = byId.get(id);
    if (!group) {
      group = { id, key, items: [], ...(monthStart === undefined ? {} : { monthStart }) };
      byId.set(id, group);
      groups.push(group);
    }
    group.items.push(item);
  };

  for (const item of ordered) {
    const at = item.timestamp;
    if (at >= todayStart) push('today', 'today', item);
    else if (at >= yesterdayStart) push('yesterday', 'yesterday', item);
    else if (at >= weekStart) push('week', 'week', item);
    else {
      const d = new Date(at);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      // A month id must carry the YEAR. Keyed on the month alone, «Август» of
      // two different years merges into one heading with a wrong count.
      const id = `month:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      push(id, 'month', item, monthStart);
    }
  }

  return groups;
};

/**
 * Search over what a person can actually remember about a find.
 *
 * Artist, title and station — the three things they saw when they caught it.
 * Case-insensitive, and `ё`/`е` folded because a Russian catalogue is full of
 * both spellings of the same name and nobody types the one the station used.
 */
export const normalizeFindQuery = (raw: string) =>
  String(raw || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();

export const findMatchesQuery = (item: TrackHistoryItem, normalizedQuery: string) => {
  if (!normalizedQuery) return true;
  const haystack = normalizeFindQuery(`${item.track} ${item.stationName}`);
  // Every word must appear somewhere, in any order: «barkley accept» and
  // «accept barkley» are the same intent, and a single substring test fails the
  // second one.
  return normalizedQuery.split(' ').every((word) => haystack.includes(word));
};

export const filterFinds = (items: readonly TrackHistoryItem[], query: string) => {
  const normalized = normalizeFindQuery(query);
  if (!normalized) return [...items];
  return items.filter((item) => findMatchesQuery(item, normalized));
};

/**
 * The heading for a month bucket.
 *
 * ⚠ The year is shown ONLY when it is not the current one. «АВГУСТ 2026 Г.» for
 * the month you are living in reads like a filing cabinet, and `Intl`'s own
 * `year: 'numeric'` in Russian appends «г.» on top of that.
 *
 * But it cannot simply be dropped: finds are long-lived, and two Augusts a year
 * apart must never share a heading. So the year appears exactly when it carries
 * information — which is also why `groupFinds` keys months by year regardless of
 * what is printed.
 */
export const monthGroupLabel = (monthStart: number, now: number, locale: string) => {
  const at = new Date(monthStart);
  const sameYear = at.getFullYear() === new Date(now).getFullYear();
  const month = at.toLocaleDateString(locale, { month: 'long' });
  return sameYear ? month : `${month} ${at.getFullYear()}`;
};
