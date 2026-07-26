import assert from 'node:assert/strict';
import test from 'node:test';
import { subjectLanguageScope } from '../src/ai/subjectLanguage.js';

/**
 * Live repro this exists for: «Жасмин - Головоломка / Че за песня?» came back
 * with stations from France, Switzerland, Türkiye, an Arabic-pop channel and the
 * USA — the artist is Russian. A bare `pop` search is 2/50 Russian; adding
 * `language=russian` is 47/50 (#205).
 */
test('a Cyrillic subject scopes to Russian', () => {
  for (const message of [
    'Жасмин - Головоломка\nЧе за песня?',
    'Жасмин - Головоломка, что за песня',
    'что за песня Земфира - Искала',
    'о чём эта песня Сплин - Выхода нет',
    'кто поёт Ленинград - Экспонат',
    'расскажи про Кино - Группа крови',
    'смысл песни ДДТ - Осень'
  ]) {
    assert.equal(
      subjectLanguageScope(message),
      'russian',
      `should scope to russian: ${message.replace(/\n/g, ' | ')}`
    );
  }
});

test('a Latin subject is left alone even when the question is Russian', () => {
  // The listener writes every message in Russian; the SUBJECT's script is the
  // signal, not the question's.
  for (const message of [
    'Robert Miles - Children что это',
    'что за песня Radiohead - Creep',
    'кто поёт Depeche Mode - Enjoy the Silence',
    'о чём эта песня Nirvana - Come As You Are',
    'what is this song Aphex Twin - Xtal'
  ]) {
    assert.equal(
      subjectLanguageScope(message),
      null,
      `must NOT scope: ${message}`
    );
  }
});

test('a question with no named subject never scopes', () => {
  // These are genre/mood asks. Scoping them would turn «найди джаз» into
  // Russian-only jazz, which is exactly the opposite of what the listener wants.
  for (const message of [
    'найди джаз',
    'что за песня',
    'че за песня?',
    'что это такое',
    'посоветуй что-нибудь',
    'что послушать',
    'кто поёт?',
    'what is this song',
    ''
  ]) {
    assert.equal(subjectLanguageScope(message), null, `must NOT scope: ${message}`);
  }
});

test('never returns a language other than russian', () => {
  // The contract is "constrain to Russian, or do not constrain" — it must never
  // invent a scope for a language we have not measured.
  for (const message of ['Rammstein - Sonne что это', 'Жасмин', 'Mylène Farmer - Désenchantée']) {
    const scope = subjectLanguageScope(message);
    assert.ok(scope === 'russian' || scope === null, `unexpected scope ${scope} for ${message}`);
  }
});
