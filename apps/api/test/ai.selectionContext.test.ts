import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boundedSelectionUserTurns,
  parseRequestedEra,
  parseSelectionContinuity,
  resolveSelectionContext,
  stationMatchesRequestedEra,
  stripExplicitExclusionReleases
} from '../src/ai/selectionContext.js';
import { parsePlannerDecision } from '../src/ai/tools.js';
import type { ChatTurn } from '../src/ai/types.js';

const isMusicRequest = (text: string) => /подбери|recommend|radio/iu.test(text);
const isBarrier = (text: string) => /пицц|экзамен|weather/iu.test(text);
const exclusionIds = (text: string) => /без\s+новост|no news/iu.test(text) ? ['news'] : [];
const opts = { isMusicRequest, isBarrier, exclusionIds };

test('requested era keeps positive period intent, ignores a rejected decade, and leaves unknown catalogue dates eligible', () => {
  assert.deepEqual(parseRequestedEra('как у дяди в нулевых'), {fromYear:2000,toYear:2009});
  assert.deepEqual(parseRequestedEra('не 90-ые, а что-то с 2000 по 2014'), {fromYear:2000,toYear:2014});
  assert.deepEqual(parseRequestedEra('что-то из 2010s'), {fromYear:2010,toYear:2019});
  assert.deepEqual(parseRequestedEra('2020s'), {fromYear:2020,toYear:2029});
  assert.equal(parseRequestedEra('не 90-ые'), undefined);
  assert.equal(parseRequestedEra('без нулевых'), undefined);
  assert.equal(parseRequestedEra('not the 90s'), undefined);
  assert.deepEqual(parseRequestedEra('не с 2000 по 2014, а 2010s'), {fromYear:2010,toYear:2019});
  assert.deepEqual(parseRequestedEra('с 2000 по 2014, точнее 2010s'), {fromYear:2010,toYear:2019});
  assert.equal(stationMatchesRequestedEra(['90s'], {fromYear:2000,toYear:2014}), false);
  assert.equal(stationMatchesRequestedEra(['2000s'], {fromYear:2000,toYear:2014}), true);
  assert.equal(stationMatchesRequestedEra([], {fromYear:2000,toYear:2014}), true);
  assert.equal(stationMatchesRequestedEra(['80s 90s'], {fromYear:1980,toYear:1989}), true);
});

test('continuity parser accepts only the two closed forms and bounded user ids', () => {
  assert.deepEqual(parseSelectionContinuity({ mode: 'new' }), { mode: 'new' });
  assert.deepEqual(parseSelectionContinuity({ mode: 'continue', fromUserTurnId: 'u12' }), {
    mode: 'continue', fromUserTurnId: 'u12'
  });
  for (const value of [
    null, [], 'new', { mode: 'new', fromUserTurnId: 'u1' },
    { mode: 'continue' }, { mode: 'continue', fromUserTurnId: 'assistant-1' },
    { mode: 'continue', fromUserTurnId: 'u1', extra: true },
    { mode: 'continue', fromUserTurnId: 'u1234567890' }
  ]) assert.equal(parseSelectionContinuity(value), undefined);
});

test('planner parser carries continuity only for accepted recommendation intent', () => {
  const valid = { mode: 'continue', fromUserTurnId: 'u2' };
  assert.deepEqual(parsePlannerDecision(JSON.stringify({ action: 'final', intent: 'recommend', continuity: valid })).continuity, valid);
  for (const intent of ['chat', 'knowledge', 'clarify', undefined]) {
    assert.equal(parsePlannerDecision(JSON.stringify({ action: 'final', intent, continuity: valid })).continuity, undefined);
  }
  assert.equal(parsePlannerDecision(JSON.stringify({ action: 'final', intent: 'recommend', continuity: { mode: 'continue' } })).continuity, undefined);
});

test('bounded history returns recent USER-only turns with stable original-index ids and Unicode cap', () => {
  const history: ChatTurn[] = [
    { role: 'user', text: ' old ' },
    { role: 'assistant', text: 'assistant secret must never appear' },
    { role: 'user', text: ` ${'я'.repeat(1000)}😀tail ` },
    ...Array.from({ length: 7 }, (_, i): ChatTurn => ({ role: i % 2 ? 'assistant' : 'user', text: `turn-${i}` }))
  ];
  const turns = boundedSelectionUserTurns(history);
  assert.equal(turns.length, 6);
  assert.deepEqual(turns.map((turn) => turn.id), ['u0', 'u2', 'u3', 'u5', 'u7', 'u9']);
  assert.equal(Array.from(turns[1]!.text).length, 1000);
  assert.equal(turns[1]!.text, 'я'.repeat(1000));
  assert.ok(turns.every((turn) => !turn.text.includes('assistant')));
});

test('new selection context uses latest text only', () => {
  const context = resolveSelectionContext([
    { id: 'u0', text: 'Подбери радио из России, без новостей, два варианта' }
  ], 'Подбери джаз из Японии, три станции', { mode: 'new' }, opts);
  assert.deepEqual(context, {
    turns: ['Подбери джаз из Японии, три станции'],
    continuing: false,
    countrySpecified: true,
    country: 'Japan',
    count: 3,
    exclusionIds: []
  });
});

test('valid continuation carries constraints and applies later explicit country, count and exclusion release', () => {
  const context = resolveSelectionContext([
    { id: 'u0', text: 'Подбери энергичное радио из России, без новостей. Два варианта' },
    { id: 'u1', text: 'Хочется рванее' }
  ], 'Теперь из Японии, три станции; новости можно', { mode: 'continue', fromUserTurnId: 'u0' }, opts);
  assert.deepEqual(context, {
    turns: [
      'Подбери энергичное радио из России, без новостей. Два варианта',
      'Хочется рванее',
      'Теперь из Японии, три станции; новости можно'
    ],
    continuing: true,
    countrySpecified: true,
    country: 'Japan',
    count: 3,
    exclusionIds: []
  });
});

test('intermediate explicit exclusions persist until a matching explicit release', () => {
  const context = resolveSelectionContext([
    { id: 'u0', text: 'Подбери radio' },
    { id: 'u1', text: 'Без новостей' },
    { id: 'u2', text: 'Теперь метал можно' }
  ], 'Хочется энергичнее', { mode: 'continue', fromUserTurnId: 'u0' }, {
    ...opts,
    exclusionIds: (text) => /без\s+новост/iu.test(text) ? ['news'] : /без\s+метал/iu.test(text) ? ['metal'] : []
  });
  assert.deepEqual(context?.exclusionIds, ['news']);
});

test('country ambiguity explicitly clears inherited scope, while unrestricted count clears count', () => {
  const context = resolveSelectionContext([
    { id: 'u0', text: 'Подбери radio из России, два варианта' }
  ], 'Из России и Японии, сколько угодно вариантов', { mode: 'continue', fromUserTurnId: 'u0' }, opts);
  assert.equal(context?.country, undefined);
  assert.equal(context?.count, undefined);
});

test('continuation fails closed for missing or non-music origins and later barriers', () => {
  const prior = [
    { id: 'u0', text: 'Что значит слово радио?' },
    { id: 'u2', text: 'Подбери radio' }
  ];
  assert.equal(resolveSelectionContext(prior, 'Хочется энергичнее', { mode: 'continue', fromUserTurnId: 'u1' }, opts), undefined);
  assert.equal(resolveSelectionContext(prior, 'Хочется энергичнее', { mode: 'continue', fromUserTurnId: 'u0' }, opts), undefined);
  assert.equal(resolveSelectionContext([...prior, { id: 'u3', text: 'Закажи пиццу' }], 'Хочется энергичнее', { mode: 'continue', fromUserTurnId: 'u2' }, opts), undefined);
  assert.equal(resolveSelectionContext(prior, 'Пицца, кстати', { mode: 'continue', fromUserTurnId: 'u2' }, opts), undefined);
});

test('a broad permission phrase does not clear a named exclusion', () => {
  const context = resolveSelectionContext([
    { id: 'u0', text: 'Подбери radio без новостей' }
  ], 'Можно, сделай поживее', { mode: 'continue', fromUserTurnId: 'u0' }, opts);
  assert.deepEqual(context?.exclusionIds, ['news']);
});

test('release phrases must be affirmative statements and the later same-turn constraint wins', () => {
  for (const latest of ['Можно новости?', 'Нельзя новости', 'Не можно новости', 'Без новостей, новости можно, но без новостей']) {
    const context = resolveSelectionContext([
      { id: 'u0', text: 'Подбери radio без новостей' }
    ], latest, { mode: 'continue', fromUserTurnId: 'u0' }, opts);
    assert.deepEqual(context?.exclusionIds, ['news'], latest);
  }
  const released = resolveSelectionContext([
    { id: 'u0', text: 'Подбери radio без новостей' }
  ], 'Без новостей, теперь новости можно', { mode: 'continue', fromUserTurnId: 'u0' }, opts);
  assert.deepEqual(released?.exclusionIds, []);
});

test('unrestricted country changes follow chronological order and ignore negated any-country phrases', () => {
  const prior = [{ id: 'u0', text: 'Подбери radio из России' }];
  const newestCountry = resolveSelectionContext(prior, 'Из любой страны, теперь из Франции', { mode: 'continue', fromUserTurnId: 'u0' }, opts);
  assert.equal(newestCountry?.country, 'France');
  const newestAny = resolveSelectionContext(prior, 'Из Франции, любая страна', { mode: 'continue', fromUserTurnId: 'u0' }, opts);
  assert.equal(newestAny?.country, undefined);
  const negated = resolveSelectionContext(prior, 'Не из любой страны, а только из Франции', { mode: 'continue', fromUserTurnId: 'u0' }, opts);
  assert.equal(negated?.country, 'France');
});

test('unrestricted count and repeated releases are resolved in their written order', () => {
  const prior = [{ id: 'u0', text: 'Подбери radio, два варианта, без новостей' }];
  const clearCount = resolveSelectionContext(prior, 'Теперь без ограничения количества', { mode: 'continue', fromUserTurnId: 'u0' }, opts);
  assert.equal(clearCount?.count, undefined);
  const setCountAfterClear = resolveSelectionContext(prior, 'Без ограничения количества, теперь три станции', { mode: 'continue', fromUserTurnId: 'u0' }, opts);
  assert.equal(setCountAfterClear?.count, 3);
  const laterRelease = resolveSelectionContext(prior, 'Новости можно; без новостей; теперь новости можно', { mode: 'continue', fromUserTurnId: 'u0' }, opts);
  assert.deepEqual(laterRelease?.exclusionIds, []);
});

test('factual gating strips only closed affirmative release phrases', () => {
  assert.equal(stripExplicitExclusionReleases('Новости можно'), '');
  const factualPlusRelease = stripExplicitExclusionReleases('Что нового у Beatles? Новости можно.');
  assert.ok(factualPlusRelease.includes('Что нового у Beatles?'));
  assert.ok(!factualPlusRelease.includes('Новости можно'));
  assert.equal(stripExplicitExclusionReleases('Можно новости?'), 'Можно новости?');
  assert.equal(stripExplicitExclusionReleases('Нельзя новости'), 'Нельзя новости');
  assert.equal(stripExplicitExclusionReleases('Не можно новости'), 'Не можно новости');
});
