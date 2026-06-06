import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStationStreamTargets, canonicalizeStationStreamUrl } from '../src/stationStreams.js';

test('buildStationStreamTargets: a normal station yields resolved first, then the original fallback', () => {
  const targets = buildStationStreamTargets({
    name: 'Tokyo FM',
    url_resolved: 'https://stream.example.com/tokyo',
    url: 'http://stream.example.com/tokyo.pls',
    homepage: 'https://tokyofm.example.com'
  });
  assert.equal(targets[0], 'https://stream.example.com/tokyo');
  assert.ok(targets.includes('http://stream.example.com/tokyo.pls'), JSON.stringify(targets));
});

test('buildStationStreamTargets: deduplicates when resolved === original', () => {
  const targets = buildStationStreamTargets({
    name: 'Solo',
    url_resolved: 'https://only.example.com/live',
    url: 'https://only.example.com/live'
  });
  assert.deepEqual(targets, ['https://only.example.com/live']);
});

test('buildStationStreamTargets: Radio Salü is fixed to the salue5 CDN stream first', () => {
  const targets = buildStationStreamTargets({
    name: 'Radio Salü',
    url_resolved: 'http://internetradio.salue.de/salue.mp3',
    url: 'http://internetradio.salue.de/salue.mp3',
    homepage: 'https://www.salue.de/'
  });
  assert.equal(targets[0], 'https://internetradio.salue.de:8443/salue5', JSON.stringify(targets));
});

test('buildStationStreamTargets: Radio City is fixed to the StreamTheWorld CDN stream first', () => {
  const targets = buildStationStreamTargets({
    name: 'Radio City',
    url_resolved: 'http://31.13.223.148/city.mp3',
    url: 'http://31.13.223.148/city.mp3',
    homepage: 'https://www.radiocity.bg/'
  });
  assert.equal(
    targets[0],
    'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIO_CITYAAC_L.aac?dist=WEBSITEBG',
    JSON.stringify(targets)
  );
});

test('canonicalizeStationStreamUrl: rewrites the known Salü / City direct URLs', () => {
  assert.equal(
    canonicalizeStationStreamUrl('http://internetradio.salue.de/salue.mp3'),
    'https://internetradio.salue.de:8443/salue5'
  );
  assert.equal(
    canonicalizeStationStreamUrl('http://31.13.223.148/city.mp3'),
    'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIO_CITYAAC_L.aac?dist=WEBSITEBG'
  );
  assert.equal(canonicalizeStationStreamUrl('https://plain.example.com/x'), 'https://plain.example.com/x');
  assert.equal(canonicalizeStationStreamUrl(''), '');
});
