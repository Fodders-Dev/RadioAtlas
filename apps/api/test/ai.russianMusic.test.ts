import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveArtistGenres,
  resolveAnchorGenres,
  resolveRussianGenrePhrase
} from '../src/ai/artistGenreFallback.js';

// Owner's exact examples (verified live to leak FOREIGN pop before this change):
// «Радио где играет Ева Польна и Винтаж» returned Swiss/French pop. The fix is
// deterministic — a Russian artist resolves to a RUSSIAN catalog tag, never a
// bare «pop» that the catalog fills with foreign stations.
test('Russian pop/estrada artists → Russian tags (owner examples)', () => {
  assert.equal(resolveArtistGenres('Ева Польна')?.[0], 'russian pop');
  assert.equal(resolveArtistGenres('ева польна и винтаж')?.[0], 'russian pop');
  assert.equal(resolveArtistGenres('Винтаж')?.[0], 'russian dance');
  assert.equal(resolveArtistGenres('Шура')?.[0], 'russian pop');
  assert.equal(resolveArtistGenres('Полина Гагарина')?.[0], 'russian pop');
  assert.equal(resolveArtistGenres('Алла Пугачёва')?.[0], 'советская эстрада');
  assert.equal(resolveArtistGenres('Киркоров')?.[0], 'russian pop');
});

test('Russian rap/hip-hop artists → Cyrillic хип-хоп (100% RU), not foreign hip hop', () => {
  assert.equal(resolveArtistGenres('Баста')?.[0], 'хип-хоп');
  assert.equal(resolveArtistGenres('Макс Корж')?.[0], 'хип-хоп');
  assert.equal(resolveArtistGenres('Оксимирон')?.[0], 'хип-хоп');
  assert.equal(resolveArtistGenres('Егор Крид')?.includes('хип-хоп'), true);
});

test('Би-2 → russian rock; t.A.T.u → russian pop', () => {
  assert.equal(resolveArtistGenres('Би-2')?.[0], 'russian rock');
  assert.equal(resolveArtistGenres('би 2')?.[0], 'russian rock');
  assert.equal(resolveArtistGenres('t.A.T.u')?.[0], 'russian pop');
  assert.equal(resolveArtistGenres('тату')?.[0], 'russian pop');
});

test('common-noun singer stems are NOT anchor-safe (no smalltalk hijack)', () => {
  // «шура»/«винтаж»/«тату»/«мираж»/«баста» are everyday words → they must NOT
  // fire on the «в стиле X» anchor path, only on explicit «где играет X».
  assert.equal(resolveAnchorGenres('в стиле шура'), null);
  assert.equal(resolveAnchorGenres('что-то типа винтаж'), null);
  assert.equal(resolveAnchorGenres('хочу тату'), null);
  assert.equal(resolveAnchorGenres('баста, хватит'), null);
  // …while distinctive full names stay anchor-safe (usable via «в стиле X»).
  assert.equal(resolveAnchorGenres('в духе Полины Гагариной')?.[0], 'russian pop');
  assert.equal(resolveAnchorGenres('типа Егор Крид')?.[0], 'russian pop');
});

test('unrelated chat still returns null (no over-matching)', () => {
  assert.equal(resolveArtistGenres('Drake'), null);
  assert.equal(resolveArtistGenres('какая сегодня погода'), null);
  assert.equal(resolveArtistGenres(''), null);
});

// «Хочу русскую эстраду» returned 0 cards live because parseGenreTags drops any
// Cyrillic tag, so the model path can never produce «советская эстрада». This
// deterministic map bypasses it. Each tag is cat-probe-verified to return RU.
test('resolveRussianGenrePhrase → verified Russian catalog tags', () => {
  assert.deepEqual(resolveRussianGenrePhrase('хочу русскую эстраду'), [
    'советская эстрада',
    'эстрада',
    'russian pop'
  ]);
  assert.equal(resolveRussianGenrePhrase('русский поп')?.[0], 'russian pop');
  assert.equal(resolveRussianGenrePhrase('русскую попсу')?.[0], 'russian pop');
  assert.equal(resolveRussianGenrePhrase('русский рэп')?.[0], 'хип-хоп');
  assert.equal(resolveRussianGenrePhrase('русский шансон')?.[0], 'шансон');
  assert.equal(resolveRussianGenrePhrase('шансон')?.[0], 'шансон');
  assert.equal(resolveRussianGenrePhrase('русский рок')?.[0], 'russian rock');
});

test('resolveRussianGenrePhrase ignores non-Russian genre asks', () => {
  assert.equal(resolveRussianGenrePhrase('jazz'), null);
  assert.equal(resolveRussianGenrePhrase('французский поп'), null);
  assert.equal(resolveRussianGenrePhrase('привет, как дела'), null);
  assert.equal(resolveRussianGenrePhrase(''), null);
});
