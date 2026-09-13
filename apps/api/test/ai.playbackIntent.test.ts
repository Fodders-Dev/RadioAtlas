import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAssistantActionPolicy } from '../src/ai/agentPolicy.js';
import { hasPlayIntent, isPlaybackProhibited } from '../src/ai/playbackIntent.js';

test('explicit no-play requests veto playback even when another clause has a play verb', () => {
  for (const message of [
    'Предложи один эфир. Пока не включай.',
    'Включи джаз. Нет, пока не включай.',
    'Не запускай звук, только предложи.',
    'Не надо ничего включать.',
    'Не включай, пожалуйста, музыку.',
    'Поставь подборку без автозапуска.',
    'Предложи без звука.',
    "Suggest jazz, don't play it yet.",
    'Do not start playback.',
    'Recommend one without autoplay.'
  ]) {
    assert.equal(isPlaybackProhibited(message), true, message);
    assert.equal(hasPlayIntent(message), false, message);
    const result = applyAssistantActionPolicy(
      [{ kind: 'play', stationuuid: 'station-a' }], { stations: [] },
      { userMessage: message, surface: 'miniapp', nowPlaying: { stationUuid: 'station-a' } },
      'run-test'
    );
    assert.equal(result.actions[0]?.kind, 'open-station', message);
    assert.equal(result.actions[0]?.permission, 'read', message);
    assert.equal(result.actions[0]?.stationuuid, 'station-a', message);
  }
});

test('genre exclusions do not block an affirmative play request', () => {
  for (const message of ['Включи джаз', 'Поставь музыку без вокала', 'Вруби не попсу, а рок']) {
    assert.equal(hasPlayIntent(message), true, message);
  }
});

test('a no-play veto does not make an ungrounded station action valid', () => {
  const result = applyAssistantActionPolicy(
    [{ kind: 'play', stationuuid: 'unknown' }], { stations: [] },
    { userMessage: 'Пока не включай', surface: 'miniapp' }, 'run-test'
  );
  assert.equal(result.actions[0]?.kind, 'none');
});
