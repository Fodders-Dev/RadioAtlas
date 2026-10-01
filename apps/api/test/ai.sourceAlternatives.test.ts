import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogToolProvider } from '../src/ai/catalogToolProvider.js';
import { runLiraAgent } from '../src/ai/agentRunner.js';
import { createNearSourceScorer } from '../src/ai/sourceAlternatives.js';
import type { ChatInput, ToolProvider } from '../src/ai/types.js';

const row = (id:string, tags='funk,soul', country='France', url=`https://stream.invalid/${id}`) => ({
  stationuuid:id, name:`Source ${id}`, tags, country, url_resolved:url, favicon:''
});
const source = row('anchor');
const toolsOf = (rows:ReturnType<typeof row>[]) => createCatalogToolProvider({
  getCatalog:async()=>rows, getStationById:async id=>rows.find(row=>row.stationuuid===id) || null,
  search:async()=>{throw new Error('near matches must be ranked before catalogue cap');}, getSummary:async()=>({})
});
async function ask(message:string, rows:ReturnType<typeof row>[], extra:Partial<ChatInput>={}, override:Partial<ToolProvider>={}) {
  let modelCalls=0;
  const input:ChatInput={userMessage:message, surface:'miniapp',nowPlaying:{stationUuid:'anchor',stationName:'Untrusted display'},...extra};
  const before=JSON.stringify(input);
  const result=await runLiraAgent(input,{
    model:{enabled:true,apiKey:'fixture-only',baseUrl:'https://model.invalid',model:'fixture',maxOutputTokens:300,timeoutSec:2},
    tools:{...toolsOf(rows),...override},musicServices:[],fetch:(async()=>{modelCalls++;throw new Error('No model calls allowed');}) as typeof fetch,
    now:()=>1,log:()=>{}
  });
  assert.equal(modelCalls,0); assert.equal(JSON.stringify(input),before);
  assert.deepEqual(result.sources,[]); assert.deepEqual(result.serviceLinks,[]);
  return result;
}

test('precise genre matches after the first eight outrank broad formats',async()=>{
  const rows=[source,...Array.from({length:25},(_,i)=>row(`wide-${i}`,'funk,pop,rock,electronic,dance,house')),
    row('exact'),row('extra','funk,soul,jazz')];
  const result=await ask('Найди похожее, но другое. Не включай.',rows);
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['exact','extra']);
  assert.match(result.reply,/общее: funk, soul/);
  assert.ok(result.reply.includes('Source exact')&&result.reply.includes('Source extra'));
  assert.ok(!result.reply.includes('Untrusted display'));
  assert.equal(result.actions[0]?.kind,'open-station');
  assert.equal(result.agentRun?.status,'completed');
});

test('shared country and hidden/history exclusions apply before ranking cap',async()=>{
  const excluded=Array.from({length:25},(_,i)=>`hidden-${i}`);
  const rows=[source,...excluded.map(id=>row(id,'funk,soul','Japan')),...Array.from({length:25},(_,i)=>row(`foreign-${i}`)),
    row('previous','funk,soul','Japan'),row('japan','funk','Japan'),row('focused','funk,soul','Japan')];
  const result=await ask('Подбери две похожие станции из Японии. Не включай.',rows,
    {userTaste:{hiddenStationIds:excluded,lastRecommendedStationIds:['previous']}});
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['focused','japan']);
  assert.ok(result.stations.every(row=>row.country==='Japan'));
});

test('original stream and mirrors cannot fill the cap or masquerade as different sources',async()=>{
  const mirrors=Array.from({length:12},(_,i)=>row(`mirror-${i}`,'funk,soul','France','https://stream.invalid/other#player'));
  const result=await ask('Подбери три похожие станции. Не включай.',[
    source,row('anchor-mirror','funk,soul','France',source.url_resolved+'#player'),...mirrors,row('distinct','funk')]);
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['mirror-0','distinct']);
  assert.match(result.reply,/2 из 3/);
});

test('broad electronic alone is not a close relation to ambient',async()=>{
  const result=await ask('Найди похожее. Не включай.',[
    row('anchor','ambient,electronic'),row('metal','electronic,metal'),row('broad','electronic'),row('good','ambient')]);
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['good']);
  assert.match(result.reply,/1 из 2/);
  const absent=await ask('Найди похожее.',[row('anchor','electronic'),row('broad','electronic')]);
  assert.deepEqual(absent.stations,[]); assert.equal(absent.actions[0]?.kind,'none');
});

test('exact known subgenre is specific evidence even if its umbrella is broad',async()=>{
  const score=createNearSourceScorer(['indie rock']);
  assert.equal(score(['classic rock']),undefined);
  assert.ok(score(['indie rock'])?.common.includes('indie rock'));
  const result=await ask('Одну похожую на эту станцию. Не включай.',[
    row('anchor','indie rock'),row('classic','classic rock'),row('indie','indie rock')]);
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['indie']);
  assert.match(result.reply,/indie rock/);
});

test('known extra directions outside the matching vocabulary do not look like perfect matches',async()=>{
  const result=await ask('Найди одну похожую станцию. Не включай.',[
    row('anchor','ambient,electronic'),row('mixed','ambient,electronic,hardcore'),row('focused','ambient,electronic,downtempo')]);
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['focused']);
  assert.equal(createNearSourceScorer(['hardcore'])(['hardcore']),undefined);
  assert.equal(createNearSourceScorer(['ambient','hardcore'])(['ambient','hardcore'])?.otherExtra,0);
});

test('full private evidence, not six public display labels, determines connection',async()=>{
  const result=await ask('Найди похожее.',[
    row('anchor','blues,jazz,classical,reggae,folk,latin,disco,funk'),row('late','funk'),row('title-only','128kbps')]);
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['late']);
  assert.match(result.reply,/funk/);
  assert.ok(result.stations.every(row=>!Object.keys(row).some(key=>/evidence|rawTags/i.test(key))));
});

test('short counted continuation keeps current UUID, scope and prior exclusion',async()=>{
  const rows=[source,row('before','funk,soul','Japan'),row('next','funk','Japan'),row('wrong','funk,soul','Germany')];
  const result=await ask('ещё один вариант',rows,{history:[{role:'user',text:'Найди похожее из Японии. Не включай.'}],
    userTaste:{lastRecommendedStationIds:['before']}});
  assert.deepEqual(result.stations.map(row=>row.stationuuid),['next']);
  assert.equal(result.actions[0]?.kind,'open-station');
});

test('NoPlay/NoWrites survive and explicit play keeps existing transport policy',async()=>{
  const rows=[source,row('next')];
  const prohibited=await ask('Включи одну похожую, но не включай автоматически, не добавляй в очередь и не сохраняй в избранное.',rows);
  assert.deepEqual(prohibited.stations.map(row=>row.stationuuid),['next']);
  assert.ok(prohibited.actions.every(row=>row.kind==='open-station'));
  const play=await ask('Включи одну похожую станцию.',rows);
  assert.equal(play.actions[0]?.kind,'play');
  const english=await ask('Find one similar station. Do not play.',rows,{locale:'en'});
  assert.match(english.reply,/shared: funk, soul/);
  assert.equal(english.actions[0]?.kind,'open-station');
});

test('unknown conditions and contrast ask for direction without pretending to hear sound',async()=>{
  for (const message of ['Найди похожее без вокала','Подбери похожее, но спокойнее',
    'Подбери контрастную к этой станции','Найди похожее из Японии без рекламы']) {
    const result=await ask(message,[source,row('next')]);
    assert.deepEqual(result.stations,[]); assert.equal(result.actions[0]?.kind,'none');
    assert.match(result.reply,/дополнительные условия/);
  }
});

test('missing or wrong source IDs never become guessed anchors',async()=>{
  for (const extra of [{nowPlaying:undefined},{nowPlaying:{stationUuid:'missing'}}]) {
    const result=await ask('Найди похожее.',[source,row('next')],extra);
    assert.deepEqual(result.stations,[]); assert.match(result.reply,/выбранной станции/);
  }
  const result=await ask('Найди похожее.',[source],{}, {getStation:async()=>({...source,stationuuid:'wrong',tags:['funk']})});
  assert.deepEqual(result.stations,[]);
});

test('a misbehaving capped tool is validated again for country, source and genres',async()=>{
  const result=await ask('Найди похожее из Японии.',[source],{}, {searchStations:async()=>[
    {...source,tags:['funk','soul']}, {...row('wrong','rock','Japan'),tags:['rock']},
    {...row('foreign','funk','Germany'),tags:['funk']} ]});
  assert.deepEqual(result.stations,[]);
});
