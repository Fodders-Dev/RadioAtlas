import type { StationLite } from '../types';
import type { CatalogMoodRail } from '../domain/contracts';

// Editorial framing over REAL catalogue queries — the A4 «Журнал» stories. A
// story is a poster, a locale key and a catalogue filter; its stations always
// come from the catalogue (the loaded pool first, then paged continuation), so
// nothing here invents a station, a track or a count.

export type PosterArt = 'jazz' | 'night' | 'groove' | 'world' | 'road' | 'focus';

export type CalmStory = {
  id: string;
  art: PosterArt;
  // Locale key under calm.journal.stories.<key>.{kicker,title,copy}
  copyKey: string;
  query: { tag?: string; mood?: string };
  // Which loaded stations may open the story before the catalogue answers.
  match?: RegExp;
};

const TAG_STORIES: CalmStory[] = [
  { id: 'jazz', art: 'jazz', copyKey: 'jazz', query: { tag: 'jazz' }, match: /^(jazz|acid jazz|smooth jazz|swing)$/i },
  { id: 'groove', art: 'groove', copyKey: 'groove', query: { tag: 'funk' }, match: /^(funk|soul|groove|disco)$/i },
  { id: 'world', art: 'world', copyKey: 'world', query: { tag: 'world music' }, match: /^(world|world music|traditional|folk)$/i }
];

const MOOD_STORIES: Record<string, { art: PosterArt; copyKey: string }> = {
  'mood-late-night': { art: 'night', copyKey: 'night' },
  'mood-driving': { art: 'road', copyKey: 'road' },
  'mood-focus': { art: 'focus', copyKey: 'focus' },
  'mood-workout': { art: 'groove', copyKey: 'workout' }
};

export const storyStations = (story: CalmStory, pool: StationLite[], rails: CatalogMoodRail[]): StationLite[] => {
  if (story.query.mood) return rails.find((rail) => rail.id === story.query.mood)?.stations ?? [];
  const match = story.match;
  if (!match) return [];
  return pool.filter((station) => station.tags.split(',').some((tag) => match.test(tag.trim())));
};

// UTC day number: the cover changes once a day, not on every reload, so the
// screen is stable within a visit and gives a reason to open it tomorrow.
export const todayIndex = (now = Date.now()) => Math.floor(now / 86_400_000);

// The lead story rotates by day among the stories that have loaded stations,
// so the cover never promises an empty shelf and no single genre becomes the
// journal's permanent face. The rest keep their editorial order.
export const buildStories = (pool: StationLite[], rails: CatalogMoodRail[], day = todayIndex()): CalmStory[] => {
  const moodStories: CalmStory[] = rails
    .filter((rail) => rail.stations.length && MOOD_STORIES[rail.id])
    .map((rail) => ({ id: rail.id, art: MOOD_STORIES[rail.id].art, copyKey: MOOD_STORIES[rail.id].copyKey, query: { mood: rail.id } }));
  const all = [TAG_STORIES[0], ...moodStories.filter((s) => s.id === 'mood-late-night'), ...TAG_STORIES.slice(1), ...moodStories.filter((s) => s.id !== 'mood-late-night')];
  const withStations = all.filter((story) => storyStations(story, pool, rails).length > 0);
  if (withStations.length > 1) {
    const [lead] = withStations.splice(((day % withStations.length) + withStations.length) % withStations.length, 1);
    withStations.unshift(lead);
  }
  // Stories without loaded stations stay reachable: the sheet pages the
  // catalogue itself. They just never lead.
  const rest = all.filter((story) => !withStations.includes(story));
  return [...withStations, ...rest];
};

export const topCountries = (pool: StationLite[], limit: number): string[] => {
  const counts = new Map<string, number>();
  for (const station of pool) {
    const country = station.country.trim();
    if (!country) continue;
    counts.set(country, (counts.get(country) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([country]) => country);
};

export const countryCode = (station: StationLite | undefined) => {
  const code = (station as { countrycode?: string } | undefined)?.countrycode;
  return typeof code === 'string' && code.length === 2 ? code.toUpperCase() : '';
};
