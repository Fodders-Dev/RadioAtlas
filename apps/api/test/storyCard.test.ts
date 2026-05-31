import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchStationArtwork,
  isNameRenderable,
  renderStoryCard,
  type StoryCardDeps
} from '../src/share/storyCard.js';
import {
  __setSsrfAllowedHostsForTesting,
  __setSsrfDnsLookupForTesting
} from '../src/media/shared.js';

const deps: StoryCardDeps = {
  assetsDir: new URL('../assets/', import.meta.url),
  userAgent: 'RadioAtlas/1.0'
};

test('isNameRenderable: Latin/Cyrillic/Greek + common are covered; other scripts are not', () => {
  assert.equal(isNameRenderable('Café 100.7'), true); // Latin + common
  assert.equal(isNameRenderable('Казак ФМ'), true); // Cyrillic
  assert.equal(isNameRenderable('Ράδιο Αθήνα'), true); // Greek
  assert.equal(isNameRenderable('Radio №1 — 24/7'), true); // numero sign / dash are common
  assert.equal(isNameRenderable('東京FM'), false); // CJK → omit (no tofu)
  assert.equal(isNameRenderable('راديو القاهرة'), false); // Arabic → omit
  assert.equal(isNameRenderable(''), false);
  assert.equal(isNameRenderable(null), false);
});

test('fetchStationArtwork: an http favicon is rejected before any fetch (https-only → gradient)', async () => {
  const result = await fetchStationArtwork('http://example.com/icon.png', deps);
  assert.equal(result, null);
});

test('fetchStationArtwork: a host resolving to a private IP is blocked by the SSRF guard', async () => {
  // The card's artwork fetch must ride the same pinned/guarded path as streams:
  // a host that resolves to a private address is refused → gradient fallback.
  __setSsrfAllowedHostsForTesting([]);
  __setSsrfDnsLookupForTesting(async () => [{ address: '169.254.169.254', family: 4 }]);
  try {
    const result = await fetchStationArtwork('https://metadata.evil.test/icon.png', deps);
    assert.equal(result, null, 'private-IP host → no artwork (SSRF blocked)');
  } finally {
    __setSsrfDnsLookupForTesting(null);
    __setSsrfAllowedHostsForTesting(null);
  }
});

test('fetchStationArtwork: a missing favicon → null (gradient fallback)', async () => {
  assert.equal(await fetchStationArtwork('', deps), null);
  assert.equal(await fetchStationArtwork(null, deps), null);
});

// Regression guard for the Cyrillic-tofu bug: a covered-Cyrillic name must NOT be
// omitted, and the render must load the per-subset fonts and produce a non-trivial
// PNG (the three subsets are registered under distinct family names so satori
// per-glyph-falls-back instead of drawing tofu). Glyph correctness itself is
// verified by eye on the rendered card — bytes alone let the tofu through once.
test('renders a Cyrillic station card (fonts load, name not omitted, non-empty PNG)', async () => {
  const name = 'Весёлый Dance - Радио Ваня';
  assert.equal(isNameRenderable(name), true, 'Cyrillic name is covered (not omitted)');
  const png = await renderStoryCard(
    { stationuuid: 'cyr-1', name, favicon: '', country: 'The Russian Federation', tags: 'dance,pop' },
    { ...deps, fetchArtwork: async () => null } // no network; gradient tile
  );
  assert.ok(png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  assert.ok(png.byteLength > 10_000, 'real rendered content, not an empty canvas');
});
