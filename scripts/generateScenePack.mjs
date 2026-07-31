// Queue AI scene backgrounds for the stations a listener actually sees.
//
// Selection order is the whole point of this script. The catalog summary is a
// mix of RANKED shelves and RANDOM pools, and it used to be walked in plain
// object key order — which starts at `catalogPool`. That pool is a seeded sample
// over the entire ~61k catalogue, re-drawn hourly, so an image generated for it
// has roughly a 0.1% chance of ever being on screen again. Every bootstrap pack
// spent its whole budget there. Measured on prod 2026-07-31: catalogPool 0/48
// covered, freshSignals 0/8, searchLaunch 0/8, while trending sat at 9/12 and
// topVoted at 12/12 — those two had been seeded by hand, in ranked order.
//
// So: ranked shelves only, most-durable first, and never the random pools.

// Durable shelves first: `sponsored`/`trending`/`topVoted` are stable between
// rebuilds, the mood rails now rotate inside a bounded featured pool, and the
// spotlights rotate hourly/daily so they are worth topping up last.
// `catalogPool`, `freshSignals` and `searchLaunch` are absent ON PURPOSE.
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

// Pure so the ordering can be tested without an API. Returns the de-duplicated
// candidate list plus what it took from where, and which keys it deliberately
// ignored — a budget this small must never drop stations silently.
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

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isMain) {
  const apiBase = String(process.env.RADIOATLAS_API_URL || 'http://127.0.0.1:3001')
    .trim()
    .replace(/\/+$/, '');
  const token = String(process.env.INTERNAL_WEBHOOK_TOKEN || '').trim();
  const requestedLimit = Number(process.env.SCENE_PACK_LIMIT || 50);
  const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 50));
  const priorityIds = String(process.env.SCENE_PACK_STATION_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  // A station that already has an image resolves without spending quota, but it
  // still burns one of the 50 slots in the request body. Drop those so a nightly
  // run always carries a full batch of stations that actually need work.
  const skipCovered = String(process.env.SCENE_PACK_SKIP_COVERED || '1').trim() !== '0';

  if (!token) {
    throw new Error('INTERNAL_WEBHOOK_TOKEN is required');
  }

  const isCovered = async (stationId) => {
    try {
      const response = await fetch(`${apiBase}/artwork/scene/${encodeURIComponent(stationId)}`, {
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) return false;
      const body = await response.json();
      return body?.status === 'ready';
    } catch {
      // A probe failure must never silently drop a station from the pack.
      return false;
    }
  };

  const cliIds = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
  let candidates = cliIds;

  if (!candidates.length) {
    const summaryResponse = await fetch(`${apiBase}/catalog/summary?seed=${Date.now()}`, {
      headers: { Accept: 'application/json' }
    });
    if (!summaryResponse.ok) {
      throw new Error(`catalog summary failed (${summaryResponse.status})`);
    }
    const summary = await summaryResponse.json();
    const selection = selectRankedStationIds(summary, priorityIds);
    candidates = selection.stationIds;
    console.error(
      `ranked candidates ${candidates.length} (${Object.entries(selection.perSurface)
        .map(([key, count]) => `${key}=${count}`)
        .join(' ')})`
    );
    if (selection.ignored.length) {
      console.error(
        `ignored random pools (an image there is a ~0.1% coin flip): ${selection.ignored.join(', ')}`
      );
    }
  }

  candidates = [...new Set(candidates)];
  let stationIds = candidates;

  if (skipCovered && !cliIds.length) {
    let covered = 0;
    const needed = [];
    for (const stationId of candidates) {
      if (needed.length >= limit) break;
      // eslint-disable-next-line no-await-in-loop
      if (await isCovered(stationId)) covered += 1;
      else needed.push(stationId);
    }
    console.error(`already covered ${covered}; queuing ${needed.length} of ${candidates.length}`);
    stationIds = needed;
  }

  stationIds = stationIds.slice(0, limit);
  if (!stationIds.length) {
    console.log(JSON.stringify({ items: [], note: 'every ranked station already has a scene' }));
    process.exit(0);
  }

  const response = await fetch(`${apiBase}/internal/artwork/scenes/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Internal-Token': token
    },
    body: JSON.stringify({ stationIds })
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`scene generation request failed (${response.status}): ${body}`);
  }

  console.log(body);
}
