// Verify, from the VPS, whether the stations we PROMOTE actually play — and emit
// the ones that definitively do not, as a source file the catalog overlay can
// consume.
//
// Why this exists: Radio Browser's lastcheckok said 1 ("healthy") for five
// stations on our own shop window that are stone dead, and its last check was
// 2026-01-15 — over six months stale. Our client-side health profile is learned
// PER USER, so every newcomer rediscovers the same dead stations personally.
//
// A station is only listed after failing BOTH the direct connection and our own
// media proxy, twice. Anything less is a network blip, not a dead station.
const API = 'http://127.0.0.1:3001';
const TIMEOUT_MS = 10000;
const CONCURRENCY = 8;

const RANKED = ['sponsored', 'trending', 'topVoted', 'moodRails', 'countrySpotlight', 'genreSpotlight', 'aroundTheWorld'];
const collect = (node, out = []) => {
  if (!node) return out;
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return out; }
  if (typeof node !== 'object') return out;
  if (typeof node.stationuuid === 'string') { out.push(node); return out; }
  Object.values(node).forEach((c) => collect(c, out));
  return out;
};

const openOnce = async (url) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: c.signal,
      headers: { 'User-Agent': 'RadioAtlas/1.0', Icy: '1' },
      redirect: 'follow'
    });
    if (!res.ok) return { ok: false, why: `http ${res.status}` };
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (!/audio|mpeg|ogg|aac|octet-stream|mp4|hls|mpegurl/.test(type)) return { ok: false, why: `type ${type.slice(0, 20) || 'none'}` };
    const reader = res.body.getReader();
    const first = await reader.read();
    await reader.cancel().catch(() => {});
    return (first.value?.byteLength ?? 0) > 0 ? { ok: true } : { ok: false, why: 'no bytes' };
  } catch (e) {
    return { ok: false, why: e.name === 'AbortError' ? 'timeout' : e.name };
  } finally {
    clearTimeout(t);
  }
};

// Dead means: direct fails, the proxy fails, and a retry of both fails too.
const isDead = async (url) => {
  const proxied = `${API}/stream?url=${encodeURIComponent(url)}`;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const direct = await openOnce(url);
    if (direct.ok) return null;
    const via = await openOnce(proxied);
    if (via.ok) return null;
    if (attempt === 1) return direct.why;
  }
  return 'unknown';
};

const summary = await (await fetch(`${API}/catalog/summary`)).json();
const seen = new Map();
for (const key of RANKED) for (const st of collect(summary[key])) if (!seen.has(st.stationuuid)) seen.set(st.stationuuid, st);
const all = [...seen.values()].filter((s) => s.url_resolved || s.url);
console.error(`probing ${all.length} promoted stations…`);

const dead = [];
let cursor = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < all.length) {
      const st = all[cursor++];
      const why = await isDead(st.url_resolved || st.url);
      if (why) dead.push({ id: st.stationuuid, name: st.name, why });
    }
  })
);

dead.sort((a, b) => a.id.localeCompare(b.id));
console.error(`dead: ${dead.length}/${all.length}`);
const stamp = new Date().toISOString().slice(0, 10);
console.log(JSON.stringify({ verifiedOn: stamp, probed: all.length, dead }, null, 1));
