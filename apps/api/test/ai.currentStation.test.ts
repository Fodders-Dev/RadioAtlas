import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentStationQuestion, isNowPlayingQuestion } from '../src/ai/brain.js';

/**
 * "What station is this?" used to fall through to the planner, which knows the
 * station's display NAME from the player context but not which catalogue row it
 * is — so it answered from a string or not at all. The now-playing context now
 * carries the station uuid, and this question is answered from the catalogue.
 *
 * The detector has to be narrow in one specific way: it must fire only for
 * questions about THIS station. "Что за станция Радио Рекорд" names a station
 * and belongs to the planner's search tools, not to the current-station path.
 */
test('recognises questions about the station being listened to', () => {
  for (const message of [
    'что это за станция?',
    'Что за станция',
    'чё это за радио',
    'расскажи про эту станцию',
    'Расскажи мне о станции',
    'расскажи об этом радио',
    'что ты знаешь про эту станцию?',
    'откуда эта станция',
    'what station is this?',
    'tell me about this station',
    'what is that radio'
  ]) {
    assert.equal(isCurrentStationQuestion(message), true, `should match: ${message}`);
  }
});

test('does NOT hijack questions that name a station, or unrelated chat', () => {
  // These belong to the planner + its search tools.
  for (const message of [
    'что за станция Радио Рекорд',
    'найди станцию с джазом',
    'включи радио шансон',
    'посоветуй радио на вечер',
    'а что это за песня',
    'что сейчас играет',
    'какая песня звучит',
    'привет',
    'что послушать'
  ]) {
    assert.equal(isCurrentStationQuestion(message), false, `should NOT match: ${message}`);
  }
});

test('the track question and the station question stay separate', () => {
  // Both used to be "the now playing question"; they need different answers —
  // one is about the song, the other about the broadcaster.
  assert.equal(isNowPlayingQuestion('что сейчас играет'), true);
  assert.equal(isCurrentStationQuestion('что сейчас играет'), false);

  assert.equal(isCurrentStationQuestion('что это за станция'), true);
  assert.equal(isNowPlayingQuestion('что это за станция'), false);
});
