import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fetchStationArtwork,
  isNameRenderable,
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
