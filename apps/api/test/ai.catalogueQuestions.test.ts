import assert from 'node:assert/strict';
import test from 'node:test';
import { answerCatalogueQuestion } from '../src/ai/catalogueQuestions.js';
import type { ChatInput, ToolProvider, VerifiedStationRef } from '../src/ai/types.js';

const funk: VerifiedStationRef = {stationuuid:'f', name:'Real Funk', country:'France', tags:['funk','soul'], favicon:'',url_resolved:'https://example.com/f'};
const ambient: VerifiedStationRef = {...funk, stationuuid:'a', name:'Real Ambient', country:'Japan',tags:['ambient']};
const lookupIds: string[] = [];
const tools: ToolProvider = {
  getStation: async id => {lookupIds.push(id); return [funk,ambient].find(s=>s.stationuuid===id) || null;},
  searchStations: async ()=>{throw new Error('questions must not search');},
  discoverTrending: async ()=>{throw new Error('questions must not discover');}
};
const input = (text:string, extra:Partial<ChatInput>={}):ChatInput => ({surface:'miniapp',userMessage:text,...extra});

test('comparison resolves the provided two IDs, uses actual differences and never writes',async()=>{
  lookupIds.length=0;
  const r = await answerCatalogueQuestion(input('Чем эти две станции отличаются? Не включай.',{userTaste:{lastSuggestedStationIds:['f','a'],lastRecommendedStationIds:['unrelated']}}),tools);
  assert.deepEqual(lookupIds,['f','a']);
  assert.deepEqual(r?.stations.map(s=>s.stationuuid),['f','a']);
  assert.match(r!.reply,/Real Funk.*funk, soul/);
  assert.match(r!.reply,/Real Ambient.*ambient/);
  assert.deepEqual(r?.actions,[{kind:'none'}]);
  assert.deepEqual(r?.usage,{prompt:0,completion:0});
});
test('one missing card is not replaced with an unrelated station',async()=>{
  const r = await answerCatalogueQuestion(input('Чем эти две отличаются?',{userTaste:{lastSuggestedStationIds:['f','missing']}}),tools);
  assert.deepEqual(r?.stations,[]);
  assert.match(r!.reply,/нет двух подтверждённых/);
});
test('taste analysis uses verified favourites rather than recommendations and is bounded',async()=>{
  lookupIds.length=0;
  const r=await answerCatalogueQuestion(input('Что объединяет мои избранные станции?',{userTaste:{favoriteStationIds:['f','a','f','missing','overflow'],lastRecommendedStationIds:['unrelated']}}),tools);
  assert.deepEqual(lookupIds,['f','a','missing']);
  assert.match(r!.reply,/Проверила 2 из 4/);
  assert.match(r!.reply,/Real Funk/);
  assert.match(r!.reply,/Общих жанровых тегов.*нет/);
  assert.deepEqual(r?.stations,[]);
});
test('absent personal data is described as absent input, not an empty collection',async()=>{
  const r=await answerCatalogueQuestion(input('А мои избранные станции ты сейчас видишь?'),tools);
  assert.match(r!.reply,/Не могу отличить пустое/);
  assert.deepEqual(r?.stations,[]);
  const tracks=await answerCatalogueQuestion(input('Что мои сохранённые треки говорят о моём вкусе?'),tools);
  assert.match(tracks!.reply,/пока не передаются/);
  assert.deepEqual(tracks?.stations,[]);
});
test('a failed favourite lookup does not invent a taste',async()=>{
  const r=await answerCatalogueQuestion(input('Что общего у моих избранных станций?',{userTaste:{favoriteStationIds:['missing']}}),tools);
  assert.match(r!.reply,/карточки сейчас не нашлись/);
});
test('actual discovery and play requests continue into the recommender',async()=>{
  assert.equal(await answerCatalogueQuestion(input('Дай радио под мой вкус на основе моих избранных станций'),tools),undefined);
  assert.equal(await answerCatalogueQuestion(input('Подбирай радио под мой вкус на основе моих избранных станций'),tools),undefined);
  assert.equal(await answerCatalogueQuestion(input('What do my favourites have in common? Play them.',{locale:'en'}),tools),undefined);
  assert.equal(await answerCatalogueQuestion(input('Show me stations matching my favourite music taste',{locale:'en'}),tools),undefined);
  assert.equal(await answerCatalogueQuestion(input('Подбери что-нибудь по моим избранным станциям'),tools),undefined);
  assert.equal(await answerCatalogueQuestion(input('Включи мои любимые станции'),tools),undefined);
  assert.equal(await answerCatalogueQuestion(input('Почему джаз одним нравится, а другим нет?'),tools),undefined);
});
test('explicit no-discovery does not bypass safe questions and legacy flattened IDs cannot form a pair',async()=>{
  const r=await answerCatalogueQuestion(input('Compare these two. Do not find new stations.',{locale:'en',userTaste:{lastSuggestedStationIds:['f','a']}}),tools);
  assert.equal(r?.stations.length,2);
  const old=await answerCatalogueQuestion(input('Чем эти две отличаются?',{userTaste:{lastRecommendedStationIds:['f','a'],lastSuggestedStationIds:['f']}}),tools);
  assert.match(old!.reply,/В последнем ответе нет пары/);
  assert.deepEqual(old?.stations,[]);
  const tracks=await answerCatalogueQuestion(input('What do my saved tracks tell you about my taste? Do not recommend anything.',{locale:'en'}),tools);
  assert.match(tracks!.reply,/not included/);
});
test('pure guarantee question has no arbitrary recommendations',async()=>{
  const r=await answerCatalogueQuestion(input('Можешь гарантировать два часа без рекламы или ведущих?'),tools);
  assert.match(r!.reply,/не могу/);
  assert.deepEqual(r?.stations,[]);
});
