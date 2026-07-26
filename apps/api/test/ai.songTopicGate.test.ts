import assert from 'node:assert/strict';
import test from 'node:test';
import { isSongTopicQuestion } from '../src/ai/brain.js';

/**
 * Live transcript this exists for. Each of these came back with station cards
 * that had nothing to do with the question:
 *   «Когда вышла эта песня с радио»  -> chiptune + electronic channels
 *   «Когда эта песня вышла?» (Корни) -> German ambient, Albanian tech-house
 *   «Че за песня?» (Жасмин)          -> French/Swiss/Turkish/Arabic/US pop
 *
 * classifySongKnowledgeIntent returned any=false for all three — it only covers
 * lyrics/meaning/translation — so the station gate never fired.
 */
test('a question ABOUT a song is recognised', () => {
  for (const message of [
    'Че за песня?',
    'Жасмин - Головоломка\nЧе за песня?',
    'Когда эта песня вышла?',
    'Когда вышла эта песня с радио',
    'кто поёт эту песню',
    'кто её исполняет',
    'в каком году вышел трек',
    'из какого альбома песня',
    'что за трек играет',
    'what song is this'
  ]) {
    assert.equal(isSongTopicQuestion(message), true, `should be a song question: ${message.replace(/\n/g, ' | ')}`);
  }
});

test('a REQUEST for music is not a question and keeps its cards', () => {
  // The whole point of the gate is that asking about a song gets an answer,
  // while asking FOR music still gets stations.
  for (const message of [
    'посоветуй что-нибудь как Жасмин',
    'найди джаз',
    'включи русский рок',
    'что послушать вечером',
    'хочу спокойное радио',
    'дай что-то бодрое',
    'привет'
  ]) {
    assert.equal(isSongTopicQuestion(message), false, `must NOT be a song question: ${message}`);
  }
});
