import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCulturalVibe, CULTURAL_VIBES } from '../src/ai/culturalVibes.js';

test('GTA Vice City → synthwave-led tags (specific beats the generic GTA entry)', () => {
  assert.deepEqual(resolveCulturalVibe('сделай радио с вайбом GTA Vice City'), ['synthwave', 'new wave', '80s']);
  assert.equal(resolveCulturalVibe('вайс сити')?.[0], 'synthwave');
});

test('GTA San Andreas → west-coast tags', () => {
  assert.equal(resolveCulturalVibe('музыка как в San Andreas')?.[0], 'west coast');
  assert.equal(resolveCulturalVibe('сан-андреас')?.[0], 'west coast');
});

test('generic GTA → hip hop, matched as a whole word only', () => {
  assert.equal(resolveCulturalVibe('что-нибудь как в гта')?.[0], 'hip hop');
  assert.equal(resolveCulturalVibe('GTA 5')?.[0], 'hip hop');
  // Must NOT fire on «гта»/«gta» buried inside another word.
  assert.equal(resolveCulturalVibe('ингтаграм'), null);
  assert.equal(resolveCulturalVibe('avgtacker'), null);
});

test('Cyberpunk → industrial/synthwave', () => {
  assert.equal(resolveCulturalVibe('вайб как в Cyberpunk 2077')?.[0], 'industrial');
  assert.equal(resolveCulturalVibe('киберпанк')?.[0], 'industrial');
});

test('Anime: Naruto / One Piece / bare «аниме» match; «анимешный» does NOT', () => {
  assert.equal(resolveCulturalVibe('радио по наруто')?.[0], 'anime');
  assert.equal(resolveCulturalVibe('что-нибудь из аниме')?.[0], 'anime');
  assert.equal(resolveCulturalVibe('one piece опенинги')?.[0], 'anime');
  assert.equal(resolveCulturalVibe('анимешный мерч'), null);
});

test('Witcher / Fallout / Tarantino / Peaky Blinders', () => {
  assert.equal(resolveCulturalVibe('ведьмак')?.[0], 'celtic');
  assert.equal(resolveCulturalVibe('fallout')?.[0], 'oldies');
  assert.equal(resolveCulturalVibe('как у Тарантино')?.[0], 'surf rock');
  assert.equal(resolveCulturalVibe('острые козырьки')?.[0], 'blues rock');
});

test('plain genre / mood / artist / empty → null (no over-matching)', () => {
  assert.equal(resolveCulturalVibe('включи джаз'), null);
  assert.equal(resolveCulturalVibe('посоветуй спокойное на вечер'), null);
  assert.equal(resolveCulturalVibe('радио с Дискотекой Авария'), null);
  assert.equal(resolveCulturalVibe(''), null);
  // @ts-expect-error — defensive against non-string input
  assert.equal(resolveCulturalVibe(null), null);
});

test('every entry maps to 1–3 non-empty tags', () => {
  for (const v of CULTURAL_VIBES) {
    assert.ok(v.tags.length >= 1 && v.tags.length <= 3, `${v.label}: tag count`);
    assert.ok(v.tags.every((t) => typeof t === 'string' && t.trim().length > 0), `${v.label}: blank tag`);
    assert.ok(v.label && v.pattern instanceof RegExp, `${v.label}: shape`);
  }
});
