import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFallbackResult, type FallbackReason } from '../src/ai/fallbacks.js';
import type { ServiceLink, VerifiedStationRef, WebSource } from '../src/ai/types.js';

const reasons: Array<{ reason: FallbackReason; expected: string }> = [
  { reason: 'disabled', expected: 'Лира сейчас отключена' },
  { reason: 'compose-error', expected: 'Не получилось собрать ответ' },
  { reason: 'empty', expected: 'не получилось подготовить ответ' },
  { reason: 'voice-unsafe', expected: 'Не хочу додумывать' },
  { reason: 'capped', expected: 'из-за ограничения' },
  { reason: 'unfinished', expected: 'не успела закончить ответ' },
  { reason: 'no-matches', expected: 'Подходящих эфиров' }
];

const station = (name: string, id = name): VerifiedStationRef => ({
  stationuuid: id,
  name,
  country: 'Japan',
  tags: ['city pop'],
  favicon: '',
  url_resolved: `https://radio.example/${id}`
});

const serviceLink: ServiceLink = {
  service: 'yandex',
  label: 'Яндекс Музыка',
  url: 'https://music.yandex.ru/search?text=city%20pop',
  query: 'city pop'
};

const source: WebSource = {
  title: 'City pop overview',
  url: 'https://example.com/city-pop',
  snippet: 'A sourced overview.',
  score: 0.9
};

test('every failure reason has a clear no-results reply', () => {
  for (const { reason, expected } of reasons) {
    const result = buildFallbackResult({ surface: 'miniapp', now: 10, reason });
    assert.ok(result.reply.includes(expected), `${reason}: ${result.reply}`);
    assert.deepEqual(result.stations, []);
    assert.deepEqual(result.serviceLinks, []);
    assert.deepEqual(result.sources, []);
    assert.deepEqual(result.actions, [{ kind: 'none' }]);
  }
});

test('unfinished reply does not ask the listener to restate their request or mood', () => {
  const result = buildFallbackResult({ surface: 'miniapp', now: 10, reason: 'unfinished' });
  assert.match(result.reply, /не успела закончить ответ/i);
  assert.doesNotMatch(result.reply, /расскажи|скажи ещё раз|какое настроение|под что/i);
});

test('station cards take precedence and the reply names only a returned, cleaned station', () => {
  const stations = [
    station('  Blue   Note\nTokyo  <b>'),
    ...Array.from({ length: 5 }, (_, index) => station(`Station ${index + 2}`, `id-${index + 2}`))
  ];
  const result = buildFallbackResult({
    surface: 'miniapp',
    now: 10,
    reason: 'compose-error',
    stations,
    serviceLinks: [serviceLink],
    sources: [source]
  });

  assert.equal(result.stations.length, 5);
  assert.equal(result.stations[0]?.stationuuid, stations[0]?.stationuuid);
  assert.match(result.reply, /Blue Note Tokyo/);
  assert.doesNotMatch(result.reply, /звучит прямо сейчас|играет сейчас/i);
  assert.ok(!result.reply.includes('<b>'));
  assert.deepEqual(result.serviceLinks, [serviceLink]);
  assert.deepEqual(result.sources, [source]);
  assert.deepEqual(result.actions, [{ kind: 'none' }]);
});

test('service search links take precedence over factual sources when there are no stations', () => {
  const result = buildFallbackResult({
    surface: 'miniapp',
    now: 10,
    reason: 'empty',
    serviceLinks: [serviceLink],
    sources: [source]
  });

  assert.match(result.reply, /ссылки на поиск в музыкальных сервисах/i);
  assert.doesNotMatch(result.reply, /нашла источники по этому вопросу/i);
  assert.deepEqual(result.serviceLinks, [serviceLink]);
  assert.deepEqual(result.sources, [source]);
});

test('factual source cards get a sourced-information framing when they are the only resource', () => {
  const result = buildFallbackResult({
    surface: 'miniapp',
    now: 10,
    reason: 'voice-unsafe',
    sources: [source]
  });

  assert.match(result.reply, /Нашла источники по этому вопросу/i);
  assert.deepEqual(result.sources, [source]);
});

test('Telegram fallback copy stays clean and does not claim that audio is playing', () => {
  const result = buildFallbackResult({
    surface: 'telegram',
    now: 10,
    reason: 'disabled',
    stations: [station('Radio & Sound')]
  });

  assert.match(result.reply, /Radio &amp; Sound/);
  assert.doesNotMatch(result.reply, /звучит прямо сейчас|играет сейчас/i);
  assert.deepEqual(result.actions, [{ kind: 'none' }]);
});
