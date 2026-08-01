// Which stations are worth spending an AI scene background on.
//
// Pure and side-effect free ON PURPOSE. This used to live inside
// generateScenePack.mjs behind an `isMain` guard comparing import.meta.url
// against process.argv[1], so that importing it from a test would not fire the
// program. That guard is a silent-failure machine:
//
//   * Node resolves an ESM entry point to its REAL path, while process.argv[1]
//     is only path.resolve()d. The nightly job runs `cd /opt/RadioAtlas/current
//     && node scripts/generateScenePack.mjs`, and `current` is a SYMLINK to
//     releases/<sha> — so the two can disagree and the guard silently yields
//     false. The program then exits 0 having done nothing: no output, no error,
//     a green systemd unit and an unspent budget.
//   * `new URL('file://' + path)` does not percent-encode the way
//     import.meta.url does, so a single space in the checkout path breaks it
//     the same silent way.
//
// Splitting the module removes the whole class: the program is a program, the
// library is a library, and nothing has to guess which one it is.

// Durable shelves first: `sponsored`/`trending`/`topVoted` are stable between
// rebuilds, the mood rails rotate inside a bounded featured pool, and the
// spotlights rotate hourly/daily so they are worth topping up last.
// `catalogPool`, `freshSignals` and `searchLaunch` are absent ON PURPOSE: each
// is a seeded sample over the whole ~61k catalogue, re-drawn hourly, so an
// image generated for one is a ~0.1% coin flip.
export const RANKED_SURFACES = [
  'sponsored',
  'trending',
  'topVoted',
  'moodRails',
  'countrySpotlight',
  'genreSpotlight',
  'aroundTheWorld'
];

export const collectStations = (value, result = []) => {
  if (!value) return result;
  if (Array.isArray(value)) {
    value.forEach((item) => collectStations(item, result));
    return result;
  }
  if (typeof value !== 'object') return result;
  if (typeof value.stationuuid === 'string' && value.stationuuid.trim()) {
    result.push(value.stationuuid.trim());
    return result;
  }
  Object.values(value).forEach((child) => collectStations(child, result));
  return result;
};

// Returns the de-duplicated candidate list, what it took from where, and which
// keys it deliberately ignored — a budget this small must never drop stations
// silently.
export const selectRankedStationIds = (summary, priorityIds = []) => {
  const ordered = [...priorityIds];
  const perSurface = {};
  for (const surface of RANKED_SURFACES) {
    const ids = collectStations(summary?.[surface]);
    perSurface[surface] = ids.length;
    ordered.push(...ids);
  }
  const ignored = Object.keys(summary || {}).filter(
    (key) => !RANKED_SURFACES.includes(key) && collectStations(summary[key]).length > 0
  );
  return { stationIds: [...new Set(ordered)], perSurface, ignored };
};
