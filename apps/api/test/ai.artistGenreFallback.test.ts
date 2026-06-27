import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveArtistGenres, ARTIST_GENRES } from '../src/ai/artistGenreFallback.js';

test('Egor Letov / Гражданская Оборона → russian punk (NOT bare punk)', () => {
  assert.deepEqual(resolveArtistGenres('Егор Летов или Гражданская Оборона'), ['russian punk', 'post-punk']);
  assert.equal(resolveArtistGenres('летов')?.[0], 'russian punk');
  assert.equal(resolveArtistGenres('гражданская оборона')?.[0], 'russian punk');
  assert.equal(resolveArtistGenres('гр.об')?.[0], 'russian punk');
});

test('other Russian punk/rock legends map to Russian tags', () => {
  assert.equal(resolveArtistGenres('Сектор Газа')?.[0], 'russian punk');
  assert.equal(resolveArtistGenres('ДДТ')?.[0], 'russian rock');
  assert.equal(resolveArtistGenres('Наутилус Помпилиус')?.[0], 'russian rock');
  assert.equal(resolveArtistGenres('Земфира')?.[0], 'russian rock');
  assert.equal(resolveArtistGenres('Тараканы')?.[0], 'ska punk');
});

test('«кино» matched standalone, not inside «киномузыка»', () => {
  assert.equal(resolveArtistGenres('радио где играет цой')?.[0], 'russian rock');
  assert.equal(resolveArtistGenres('кино')?.[0], 'russian rock');
  assert.equal(resolveArtistGenres('классика киномузыки'), null);
});

test('unknown artist / empty → null (no over-matching)', () => {
  assert.equal(resolveArtistGenres('Drake'), null);
  assert.equal(resolveArtistGenres('Дима Билан'), null);
  assert.equal(resolveArtistGenres(''), null);
  // @ts-expect-error — defensive against non-string input
  assert.equal(resolveArtistGenres(null), null);
});

test('every entry has 1–2 valid tags', () => {
  for (const e of ARTIST_GENRES) {
    assert.ok(e.tags.length >= 1 && e.tags.length <= 2, `${e.label}: tag count`);
    assert.ok(e.tags.every((t) => typeof t === 'string' && t.trim().length > 0), `${e.label}: blank tag`);
    assert.ok(e.label && e.pattern instanceof RegExp, `${e.label}: shape`);
  }
});
