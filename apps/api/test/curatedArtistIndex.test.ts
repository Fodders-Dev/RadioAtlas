import assert from 'node:assert/strict';
import test from 'node:test';

import {
  artistTokensMatch,
  normalizeArtist,
  resolveCuratedArtist
} from '../src/ai/curatedArtistIndex.js';

// --- normalizeArtist ---------------------------------------------------------

test('normalizeArtist: lowercases, folds ё→е, drops punctuation, collapses spaces', () => {
  assert.equal(normalizeArtist('  Дискотека   Авария!  '), 'дискотека авария');
  assert.equal(normalizeArtist('Artik & Asti'), 'artik asti');
  assert.equal(normalizeArtist('Весёлый'), normalizeArtist('Веселый')); // ё and е fold the same
  assert.equal(normalizeArtist(''), '');
  assert.equal(normalizeArtist('!!! ??? ...'), '');
  assert.equal(normalizeArtist(null), '');
});

// --- artistTokensMatch -------------------------------------------------------

test('artistTokensMatch: every KEY token needs a query token sharing a ≥4 prefix', () => {
  // case ending differs but the 8-char prefix matches
  assert.ok(artistTokensMatch('дискотекой авария', 'дискотека авария'));
  assert.ok(artistTokensMatch('дискотека авария', 'дискотека авария'));
  // a short (≤3) key token must match EXACTLY
  assert.ok(artistTokensMatch('артик и асти', 'артик и асти'));
  // missing a key token → no match
  assert.ok(!artistTokensMatch('авария', 'дискотека авария'));
  // empty either side → no match
  assert.ok(!artistTokensMatch('', 'авария'));
  assert.ok(!artistTokensMatch('авария', ''));
  // a 2-char query token can't reach the 4-char prefix bar (cross-script too)
  assert.ok(!artistTokensMatch('ас', 'asti'));
});

test('artistTokensMatch: Latin artist tokens are exact, not loose prefixes', () => {
  assert.ok(artistTokensMatch('exclusively the weeknd', 'the weeknd'));
  assert.ok(!artistTokensMatch('oui fm top of the week', 'the weeknd'));
  assert.ok(!artistTokensMatch('classic hits on the weekend', 'the weeknd'));
});

// --- resolveCuratedArtist (the cases from the brief) -------------------------

const expectArtist = (query: string, artist: string, uuid: string) => {
  const hit = resolveCuratedArtist(query);
  assert.ok(hit, `expected a hit for «${query}»`);
  assert.equal(hit?.artist, artist);
  assert.equal(hit?.stationuuid, uuid);
};

test('resolveCuratedArtist: Дискотека Авария — inflected, base, and Latin alias', () => {
  expectArtist('дискотекой авария', 'Дискотека Авария', 'curated-radiovanya-avaria');
  expectArtist('дискотека авария', 'Дискотека Авария', 'curated-radiovanya-avaria');
  expectArtist('avaria', 'Дискотека Авария', 'curated-radiovanya-avaria');
});

test('resolveCuratedArtist: NYUSHA via Cyrillic «нюша» and Latin «nyusha»', () => {
  expectArtist('нюша', 'NYUSHA', 'curated-radiovanya-nyusha');
  expectArtist('nyusha', 'NYUSHA', 'curated-radiovanya-nyusha');
});

test('resolveCuratedArtist: Дима Билан via full name and «bilan»', () => {
  expectArtist('дима билан', 'Дима Билан', 'curated-radiovanya-bilan');
  expectArtist('bilan', 'Дима Билан', 'curated-radiovanya-bilan');
});

test('resolveCuratedArtist: Artik & Asti via Latin and Cyrillic «артик и асти»', () => {
  expectArtist('artik asti', 'Artik & Asti', 'curated-radiovanya-artik-asti');
  expectArtist('артик и асти', 'Artik & Asti', 'curated-radiovanya-artik-asti');
});

test('resolveCuratedArtist: an artist we do NOT own → null', () => {
  assert.equal(resolveCuratedArtist('Linkin Park'), null);
  assert.equal(resolveCuratedArtist('Coldplay'), null);
});

test('resolveCuratedArtist: extra query words around the artist still match', () => {
  // «радио с Дискотекой Авария онлайн» — surrounding words don't block the match.
  assert.equal(
    resolveCuratedArtist('дискотекой авария онлайн')?.stationuuid,
    'curated-radiovanya-avaria'
  );
});

test('resolveCuratedArtist: empty / punctuation-only → null', () => {
  assert.equal(resolveCuratedArtist(''), null);
  assert.equal(resolveCuratedArtist('   '), null);
  assert.equal(resolveCuratedArtist('!!!'), null);
});

test('resolveCuratedArtist: a short token does NOT false-match a Latin alias («ас» ↛ Asti)', () => {
  assert.equal(resolveCuratedArtist('ас'), null);
});
