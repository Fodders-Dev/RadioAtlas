const apiBase = String(process.env.RADIOATLAS_API_URL || 'http://127.0.0.1:3001')
  .trim()
  .replace(/\/+$/, '');
const token = String(process.env.INTERNAL_WEBHOOK_TOKEN || '').trim();
const requestedLimit = Number(process.env.SCENE_PACK_LIMIT || 50);
const limit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 50));

if (!token) {
  throw new Error('INTERNAL_WEBHOOK_TOKEN is required');
}

const collectStations = (value, result = []) => {
  if (!value || result.length >= limit) return result;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStations(item, result);
      if (result.length >= limit) break;
    }
    return result;
  }
  if (typeof value !== 'object') return result;
  if (typeof value.stationuuid === 'string' && value.stationuuid.trim()) {
    result.push(value.stationuuid.trim());
    return result;
  }
  for (const child of Object.values(value)) {
    collectStations(child, result);
    if (result.length >= limit) break;
  }
  return result;
};

const cliIds = process.argv.slice(2).map((value) => value.trim()).filter(Boolean);
let stationIds = cliIds;

if (!stationIds.length) {
  const summaryResponse = await fetch(`${apiBase}/catalog/summary?seed=${Date.now()}`, {
    headers: { Accept: 'application/json' }
  });
  if (!summaryResponse.ok) {
    throw new Error(`catalog summary failed (${summaryResponse.status})`);
  }
  const summary = await summaryResponse.json();
  stationIds = collectStations(summary);
}

stationIds = [...new Set(stationIds)].slice(0, limit);
if (!stationIds.length) {
  throw new Error('No station ids found for the scene pack');
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
