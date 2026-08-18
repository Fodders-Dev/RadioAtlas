import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __resetPresence,
  getPresenceStats,
  recordPresenceBeat
} from '../src/listeningPresence.js';
import { __resetPresencePeaks, reportPresenceGauges } from '../src/listeningRoutes.js';
import { getObservabilitySnapshot } from '../src/observabilityStore.js';

/**
 * `/listening/live` publishes nothing below three listeners on one station,
 * which is the privacy floor and is correct. The consequence nobody had
 * measured: the surface looks exactly the same when three people are spread
 * across three stations as when nobody has opened the app all week, so "the
 * threshold is why this never shows" was an inference standing in for a number.
 *
 * These gauges are that number. They must stay aggregate — a station id in a
 * gauge key would put "somebody is on this niche station" into the operator
 * payload, which is the thing the floor exists to prevent, and counter/gauge
 * keys are the one structure the age prune never touches.
 */

const gauges = () => getObservabilitySnapshot().gauges as Record<string, number>;

test('the gauges report what the public endpoint cannot', () => {
  __resetPresence();
  __resetPresencePeaks();

  // Two people on one station, one on another: invisible to /listening/live,
  // because neither station clears the floor of three.
  recordPresenceBeat('token-a', 'station-1');
  recordPresenceBeat('token-b', 'station-1');
  recordPresenceBeat('token-c', 'station-2');

  reportPresenceGauges(1_000_000);
  const now = gauges();
  assert.equal(now['presence:live_listeners'], 3);
  assert.equal(now['presence:live_stations'], 2);
  assert.equal(now['presence:peak_station_listeners_1h'], 2);
});

test('a peak survives the quiet minute that follows it', () => {
  __resetPresence();
  __resetPresencePeaks();

  recordPresenceBeat('token-a', 'station-1');
  recordPresenceBeat('token-b', 'station-1');
  recordPresenceBeat('token-c', 'station-1');
  reportPresenceGauges(2_000_000);
  assert.equal(gauges()['presence:peak_station_listeners_1h'], 3);

  // Everyone leaves. The instantaneous reading is the truth and goes to zero;
  // the peak is what makes a 30-second sample of a small audience mean
  // anything at all.
  __resetPresence();
  reportPresenceGauges(2_000_030);
  const after = gauges();
  assert.equal(after['presence:live_listeners'], 0);
  assert.equal(after['presence:peak_station_listeners_1h'], 3);
});

test('peaks reset on the hour so last week cannot look like this afternoon', () => {
  __resetPresence();
  __resetPresencePeaks();

  recordPresenceBeat('token-a', 'station-1');
  recordPresenceBeat('token-b', 'station-1');
  reportPresenceGauges(3_000_000);
  assert.equal(gauges()['presence:peak_listeners_1h'], 2);

  __resetPresence();
  reportPresenceGauges(3_000_000 + 3_600_001);
  assert.equal(gauges()['presence:peak_listeners_1h'], 0);
});

test('no gauge key carries a station id', () => {
  __resetPresence();
  __resetPresencePeaks();
  recordPresenceBeat('token-a', 'a-very-recognisable-station-uuid');
  reportPresenceGauges(4_000_000);
  const keys = Object.keys(gauges()).filter((key) => key.startsWith('presence:'));
  assert.ok(keys.length >= 4, 'the presence gauges should be reported');
  for (const key of keys) {
    assert.ok(
      !key.includes('a-very-recognisable-station-uuid'),
      `gauge key leaks a station id: ${key}`
    );
  }
});

test('getPresenceStats counts people, not stations', () => {
  __resetPresence();
  recordPresenceBeat('token-a', 'station-1');
  recordPresenceBeat('token-b', 'station-1');
  recordPresenceBeat('token-c', 'station-2');
  const stats = getPresenceStats();
  assert.deepEqual(stats, { listeners: 3, stations: 2, topStation: 2 });
});
