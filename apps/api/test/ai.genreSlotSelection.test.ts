import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogToolProvider } from '../src/ai/catalogToolProvider.js';
import { runLiraAgent } from '../src/ai/agentRunner.js';
import { selectGenreSlots } from '../src/ai/genreSlotSelection.js';
import { omitSharedCountrySuffix } from '../src/ai/requestedCountry.js';
import { requestedGenreSlots } from '../src/ai/requestedGenreSlots.js';
import type { ChatInput } from '../src/ai/types.js';

const row = (id: string, tags: string, country = 'Japan', url = `https://stream.invalid/${id}`) => ({
  stationuuid:id, name:`Source ${id}`, tags, country, url_resolved:url
});
const toolsOf = (rows: ReturnType<typeof row>[]) => createCatalogToolProvider({
  getCatalog:async()=>rows, search:async()=>{throw new Error('slots must filter before ranked search cap');},
  getStationById:async id=>rows.find(row=>row.stationuuid===id) || null, getSummary:async()=>({})
});
const ask = async (message:string, rows:ReturnType<typeof row>[], extra:Partial<ChatInput>={}) => {
  const input:ChatInput={surface:'miniapp',userMessage:message,...extra};
  const before=JSON.stringify(input);
  let calls=0;
  const result=await runLiraAgent(input, {
    model:{enabled:true,apiKey:'fixture-only',baseUrl:'https://model.invalid',model:'fixture',maxOutputTokens:300,timeoutSec:2},
    tools:toolsOf(rows),musicServices:[],fetch:(async()=>{calls++;throw new Error('No model calls permitted');}) as typeof fetch,
    log:()=>{},now:()=>1
  });
  assert.equal(calls,0);
  assert.equal(JSON.stringify(input),before);
  assert.equal(result.agentRun?.status,'completed');
  assert.equal(result.agentRun?.verifierPassed,true);
  assert.deepEqual(result.sources,[]); assert.deepEqual(result.serviceLinks,[]);
  return result;
};

test('two genres: country, hidden IDs and real genre evidence are applied before caps',async()=>{
  const rows=[...Array.from({length:30},(_,index)=>row(`foreign-${index}`,'funk,ambient','France')),
    row('hidden','funk'),row('title-only','128kbps'),row('funk','60s,70er,black music,city,mp3,aac,320kbps,funk'),row('ambient','ambient')];
  rows[31]!.name='Funk and Ambient radio';
  const result=await ask('Найди одну фанк-станцию и одну эмбиент-станцию из Японии. Не включай.',rows,{userTaste:{hiddenStationIds:['hidden']}});
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['funk','ambient']);
  assert.ok(result.actions.every(action=>action.kind==='open-station'));
  assert.ok(!result.reply.includes('foreign-') && !result.reply.includes('title-only'));
  assert.equal(result.agentRun?.toolCalls.filter(call=>call.name==='search_stations').length,2);
});

test('hybrid remains available to the second slot instead of greedy first-slot consumption',async()=>{
  const result=await ask('Один фанк, один эмбиент. Не включай.',[row('hybrid','funk,ambient'),row('funk','funk')]);
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['funk','hybrid']);
});

test('independent counts produce two funk and one ambient, not the last global count',async()=>{
  const result=await ask('Подбери две фанк-станции и одну эмбиент-станцию. Не включай.',[
    row('f1','funk'),row('f2','funk'),row('f3','funk'),row('a','ambient')]);
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['f1','f2','a']);
  assert.ok(result.reply.includes('Source f1') && result.reply.includes('Source f2') && result.reply.includes('Source a'));
});

test('missing genre stays visibly missing and is not padded with unrelated stations',async()=>{
  const result=await ask('Один фанк, один эмбиент. Не включай.',[row('f','funk'),row('rock','rock')]);
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['f']);
  assert.match(result.reply,/Эмбиент.*не найден/);
  assert.ok(!result.reply.includes('Source rock'));
});

test('two UUIDs for the same exact stream cannot masquerade as the two genre sources',async()=>{
  const result=await ask('Один фанк, один эмбиент. Не включай.',[
    row('x','funk','Japan','https://stream.invalid/same'),row('y','ambient','Japan','https://stream.invalid/same#player')]);
  assert.equal(result.stations.length,1);
  assert.match(result.reply,/не найден/);
});

test('stream mirrors are removed before the eight-candidate cap, keeping a full pair possible',async()=>{
  const rows=[...Array.from({length:8},(_,index)=>row(`mirror-${index}`,'funk,ambient','Japan','https://stream.invalid/hybrid')),
    row('unique-funk','funk')];
  const result=await ask('Один фанк, один эмбиент. Не включай.',rows);
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['unique-funk','mirror-0']);
});

test('NoPlay and NoWrites remain read-only for an explicit pair request',async()=>{
  const result=await ask('Одну с фанком и одну с эмбиентом. Не добавляй их в очередь. Не включай.',[row('f','funk'),row('a','ambient')]);
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['f','a']);
  assert.ok(result.actions.every(action=>action.kind==='open-station' && action.permission==='read'));
});

test('shared-country stripping never consumes extra promises or per-slot countries',()=>{
  const accepted='Give me one funk station and one ambient station from Japan. Do not play.';
  assert.ok(requestedGenreSlots(omitSharedCountrySuffix(accepted)));
  for(const text of ['One funk from Japan and one ambient from France',
    'One funk and one ambient from Japan on piano only',
    'One funk and one ambient not from Japan',
    'One funk and one ambient from Japan and France']) {
    assert.equal(requestedGenreSlots(omitSharedCountrySuffix(text)),undefined,text);
  }
});

test('explicit play preserves write permission, while English pair replies stay grounded',async()=>{
  const result=await ask('Включи одну фанк-станцию и одну эмбиент-станцию',[row('f','funk'),row('a','ambient')],{locale:'en'});
  assert.equal(result.actions[0]?.kind,'play');
  assert.equal(result.actions[0]?.permission,'write');
  assert.match(result.reply,/catalogue genres/);
});

test('misbehaving tool output is rechecked at the brain selection boundary',async()=>{
  const tools=toolsOf([row('bad','rock')]);
  tools.searchStations=async()=>[{stationuuid:'bad',name:'Funk Radio',tags:['rock'],country:'Japan',url_resolved:'https://s.invalid/bad',favicon:''}];
  const selected=await selectGenreSlots([{genre:'funk',count:1},{genre:'ambient',count:1}],tools,[],rows=>rows);
  assert.deepEqual(selected.map(group=>group.stations),[[],[]]);
});
