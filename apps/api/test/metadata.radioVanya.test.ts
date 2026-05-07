import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isRadioVanyaUrl,
  resolveRadioVanyaStreamId
} from '../src/media/metadataService.js';

const catalog = [
  {
    id: 0,
    link: 'https://icecast-radiovanya.cdnvideo.ru/radiovanya',
    slug: 'rv'
  },
  {
    id: 1,
    link: 'https://icecast-radiovanya.cdnvideo.ru/rv_90',
    slug: 'rv_90'
  },
  {
    id: 6,
    link: 'https://icecast-radiovanya.cdnvideo.ru/rv_spb',
    slug: 'rv_spb'
  }
];

test('isRadioVanyaUrl matches radiovanya CDN host', () => {
  assert.equal(isRadioVanyaUrl('http://icecast-radiovanya.cdnvideo.ru/radiovanya'), true);
  assert.equal(isRadioVanyaUrl('https://icecast-radiovanya.cdnvideo.ru/rv_90'), true);
  assert.equal(isRadioVanyaUrl('https://radiovanya.ru/'), true);
  assert.equal(isRadioVanyaUrl('https://www.radiovanya.ru/'), true);
});

test('isRadioVanyaUrl rejects unrelated stream hosts', () => {
  assert.equal(isRadioVanyaUrl('https://omskfm.ru:8443/881-128.mp3'), false);
  assert.equal(isRadioVanyaUrl('https://icecast.example.com/radiovanya'), false);
  assert.equal(isRadioVanyaUrl('not a url'), false);
});

test('resolveRadioVanyaStreamId maps the main feed when scheme differs', () => {
  // catalog has https; radio-browser stores http. Hostname + path
  // comparison should still resolve the stream id.
  assert.equal(
    resolveRadioVanyaStreamId(
      'http://icecast-radiovanya.cdnvideo.ru/radiovanya',
      catalog
    ),
    0
  );
});

test('resolveRadioVanyaStreamId maps sub-streams', () => {
  assert.equal(
    resolveRadioVanyaStreamId(
      'https://icecast-radiovanya.cdnvideo.ru/rv_90',
      catalog
    ),
    1
  );
  assert.equal(
    resolveRadioVanyaStreamId(
      'https://icecast-radiovanya.cdnvideo.ru/rv_spb/',
      catalog
    ),
    6
  );
});

test('resolveRadioVanyaStreamId returns null for unknown stream paths', () => {
  assert.equal(
    resolveRadioVanyaStreamId(
      'https://icecast-radiovanya.cdnvideo.ru/unknown_feed',
      catalog
    ),
    null
  );
});

test('resolveRadioVanyaStreamId returns null for malformed URLs', () => {
  assert.equal(resolveRadioVanyaStreamId('definitely not a url', catalog), null);
});
