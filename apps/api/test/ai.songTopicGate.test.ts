import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isExplicitMusicRequest,
  isMusicOpinionQuestion,
  isSongTopicQuestion
} from '../src/ai/brain.js';

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

/**
 * The first two attempts at this gate failed IN PRODUCTION because the condition
 * reused predicates that mean "this turn is about music", not "the listener
 * asked for music". ACTION_INTENT matches «Че за песня?» — the word «песня» is
 * enough — so the gate never ran once. The log line it emits on a drop counted 0
 * across a whole session.
 *
 * The pair below is the actual contract: a QUESTION loses its cards, a REQUEST
 * keeps them. Both directions are pinned so the next refactor cannot quietly
 * collapse them back together.
 */
test('a question is not a request, and a request is not a question', () => {
  const questionsWithoutRequest = [
    'Че за песня?',
    'Жасмин - Головоломка\nЧе за песня?',
    'Когда эта песня вышла?',
    'кто поёт эту песню',
    'в каком году вышел трек'
  ];
  for (const message of questionsWithoutRequest) {
    assert.equal(isSongTopicQuestion(message), true, `question: ${message.replace(/\n/g, ' | ')}`);
    assert.equal(
      isExplicitMusicRequest(message),
      false,
      `must NOT read as a request (this is what broke it twice): ${message.replace(/\n/g, ' | ')}`
    );
  }

  const requests = [
    'посоветуй что-нибудь как Жасмин',
    'найди джаз',
    'включи русский рок',
    'поставь что-то спокойное',
    'что послушать вечером',
    'хочу бодрое радио',
    'подскажи станцию с блюзом'
  ];
  for (const message of requests) {
    assert.equal(isExplicitMusicRequest(message), true, `request: ${message}`);
  }
});

/**
 * 2026-08-15 provider A/B, six fixtures × three repeats against both providers.
 * Every fixture passed except `music-conversation` — «Почему людям так нравится
 * джаз?» — which DeepSeek failed 3/3 and OpenAI 2/3, both by returning
 * `open-station` plus station cards for a question that asked for an opinion,
 * not for radio. Two different models failing the same way is a gap in the
 * gate, not a model quirk: nothing in the knowledge, song, or trivia predicates
 * matched, so the cards the planner had collected were attached anyway.
 */
test('an open-ended question about music is a conversation turn, not a radio request', () => {
  for (const message of [
    'Почему людям так нравится джаз?',
    'почему все так любят синтвейв',
    'зачем люди слушают эмбиент',
    'отчего металл так популярен',
    'чем цепляет городской поп',
    'чем так хорош lo-fi',
    'в чём прелесть винила',
    'в чем секрет шугейза',
    'что такого в этом жанре',
    'why do people like jazz'
  ]) {
    assert.equal(
      isMusicOpinionQuestion(message),
      true,
      `should be an opinion question: ${message}`
    );
  }
});

test('asking FOR music keeps its cards even when phrased as a question', () => {
  // The trap this predicate has to avoid: a request wearing a question mark.
  // «Почему бы не поставить…» is a real ask, and the infinitive «поставить»
  // does NOT match MUSIC_REQUEST_VERB, so the opinion predicate is the only
  // thing standing between that request and a silently card-less answer.
  for (const message of [
    'почему бы не поставить что-то бодрое?',
    'почему бы не включить джаз',
    'посоветуй джаз',
    'найди что-нибудь спокойное',
    'что послушать вечером',
    'включи русский рок',
    'что сейчас играет?',
    'привет'
  ]) {
    assert.equal(
      isMusicOpinionQuestion(message),
      false,
      `must NOT be an opinion question: ${message}`
    );
  }
});
