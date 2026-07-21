import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNowPlayingContext } from '../src/aiRoutes.js';

test('parseNowPlayingContext accepts a bounded live track and station', () => {
  assert.deepEqual(
    parseNowPlayingContext({ track: '  Artist — Track  ', stationName: '  Night Radio  ' }),
    { track: 'Artist — Track', stationName: 'Night Radio' }
  );
});

test('parseNowPlayingContext keeps the active station when track metadata is unavailable', () => {
  assert.deepEqual(parseNowPlayingContext({ stationName: 'Osaka Nights' }), {
    stationName: 'Osaka Nights'
  });
  assert.equal(parseNowPlayingContext({ track: ' ', stationName: ' ' }), undefined);
});
