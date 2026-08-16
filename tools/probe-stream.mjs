// Is a station's stream actually steady, or does it stall?
//
// Reads a live stream for N seconds and reports throughput per bucket plus any
// gap between chunks longer than GAP_MS. A 96kbps stream should deliver ~12KB/s
// with no gap beyond a second or two; a listener-visible stall looks like a gap
// of many seconds, or throughput collapsing to zero.
//
// Usage: node probe-stream.mjs <url> [seconds] [label]

const url = process.argv[2];
const seconds = Number(process.argv[3] || 180);
const label = process.argv[4] || 'stream';
const GAP_MS = 2000;
const BUCKET_MS = 15_000;

if (!url) {
  console.error('usage: node probe-stream.mjs <url> [seconds] [label]');
  process.exit(1);
}

const started = Date.now();
let total = 0;
let lastChunkAt = Date.now();
let firstByteAt = 0;
const gaps = [];
const buckets = [];
let bucketBytes = 0;
let bucketStart = Date.now();

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), seconds * 1000);

try {
  const response = await fetch(url, {
    signal: controller.signal,
    headers: {
      // A datacentre IP gets refused by plenty of hosts without a browser UA.
      'User-Agent':
        'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Mobile Safari/537.36',
      Accept: '*/*',
      'Icy-MetaData': '1'
    },
    redirect: 'follow'
  });

  console.log(`${label}: HTTP ${response.status} ${response.headers.get('content-type') || ''}`);
  const icyName = response.headers.get('icy-name');
  const icyBr = response.headers.get('icy-br');
  if (icyName || icyBr) console.log(`${label}: icy-name=${icyName || '-'} icy-br=${icyBr || '-'}`);
  if (!response.ok || !response.body) {
    console.log(`${label}: no body`);
    process.exit(0);
  }

  for await (const chunk of response.body) {
    const now = Date.now();
    if (!firstByteAt) {
      firstByteAt = now;
      console.log(`${label}: first byte after ${now - started}ms`);
      lastChunkAt = now;
      bucketStart = now;
    }
    const gap = now - lastChunkAt;
    if (gap >= GAP_MS) gaps.push({ atSec: Math.round((now - firstByteAt) / 1000), gapMs: gap });
    lastChunkAt = now;
    total += chunk.length;
    bucketBytes += chunk.length;
    if (now - bucketStart >= BUCKET_MS) {
      buckets.push(Math.round(bucketBytes / ((now - bucketStart) / 1000) / 1024));
      bucketBytes = 0;
      bucketStart = now;
    }
  }
} catch (error) {
  if (error?.name !== 'AbortError') {
    console.log(`${label}: ERROR ${error?.message || error}`);
  }
} finally {
  clearTimeout(timer);
}

const elapsed = (Date.now() - (firstByteAt || started)) / 1000;
console.log(
  `${label}: ${(total / 1024 / 1024).toFixed(2)}MB over ${elapsed.toFixed(0)}s = ` +
    `${(total / 1024 / elapsed).toFixed(1)} KB/s (~${Math.round((total * 8) / elapsed / 1000)} kbps)`
);
console.log(`${label}: throughput per 15s bucket (KB/s): ${buckets.join(' ')}`);
console.log(
  gaps.length
    ? `${label}: ${gaps.length} GAP(S) >= ${GAP_MS}ms: ` +
        gaps.map((g) => `${g.gapMs}ms at +${g.atSec}s`).join(', ')
    : `${label}: no gap >= ${GAP_MS}ms — steady`
);
