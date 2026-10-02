import assert from 'node:assert/strict';
import test from 'node:test';
import { chatWithAssistant } from '../src/ai/brain.js';
import { assertsUnverifiedProgram, promisesUnperformedLookup } from '../src/ai/replyOutcome.js';
import { claimsUnrequestedPlayback, describeVerifiedStationSlate, referencesStationPosition } from '../src/ai/recommendationReply.js';
import type { AssistantDeps, ChatInput, ChatTurn, VerifiedStationRef } from '../src/ai/types.js';

const station = (id: string, overrides: Partial<VerifiedStationRef> = {}): VerifiedStationRef => ({
  stationuuid: id, name: `Fast ${id}`, country: 'Russia', tags: ['drum and bass'],
  favicon: '', url_resolved: 'https://audio.example/live', ...overrides
});
const recommendation = JSON.stringify({action:'use_tool', intent:'recommend', tool:'search_stations', args:{query:'drum and bass'}});
const final = (intent: string) => JSON.stringify({action:'final', intent});
const ask = (userMessage: string, history: ChatTurn[] = []): ChatInput => ({userMessage, history, surface:'miniapp', locale:'ru'});
const harness = (options: {planner?: string[]; reply?: string; rows?: VerifiedStationRef[]} = {}) => {
  const requests: any[] = [];
  const searches: any[] = [];
  let plannerIndex = 0;
  const deps: AssistantDeps = {
    model: {enabled:true, apiKey:'stub', baseUrl:'https://model.example', model:'deepseek-v4-pro', timeoutSec:8, maxOutputTokens:1000},
    musicServices: ['youtube'], now:()=>7, log:()=>{},
    tools: {
      searchStations:async args=>{ searches.push(args); return options.rows ?? [station('a'),station('b')]; },
      getStation:async()=>null, discoverTrending:async()=>[]
    },
    fetch: (async (_url, init)=> {
      const body = JSON.parse(String(init?.body)); requests.push(body);
      const systems = body.messages.filter((m:any)=>m.role === 'system').map((m:any)=>m.content).join('\n');
      const content = systems.includes('PLANNER MODE')
        ? options.planner?.[plannerIndex++] ?? final('recommend')
        : systems.includes('radio genre tag') ? 'drum and bass'
        : options.reply ?? 'Вот найденные станции с быстрым ритмом.';
      return new Response(JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:10, completion_tokens:10}}), {status:200});
    }) as typeof fetch
  };
  return {deps, searches, requests};
};

test('free speed/metaphor request reaches a semantic planner and returns verified cards without autoplay', async()=>{
  for (const text of ['Хочется скоростного как sonic', 'Хочется будто несусь по неоновой трассе']) {
    const h = harness({planner:[recommendation]});
    const r = await chatWithAssistant(ask(text),h.deps);
    assert.deepEqual(r.stations.map(s=>s.stationuuid).sort(),['a','b']);
    assert.deepEqual(h.searches.map(a=>a.query),['drum and bass']);
    assert.equal(h.requests.length,2,'one plan + one reply, no redundant final plan');
    assert.ok(r.actions.every(a=>a.kind !== 'play'));
  }
});

test('recommend+final still searches instead of returning an unperformed promise',async()=>{
  const h=harness({planner:[final('recommend')],reply:'Сейчас гляну, что у меня есть под такое настроение.'});
  const r=await chatWithAssistant(ask('Хочется скоростного как sonic'),h.deps);
  assert.ok(h.searches.length > 0);
  assert.ok(r.stations.length > 0);
  assert.doesNotMatch(r.reply,/сейчас гляну|замечталась|шум пластинки/i);
  assert.ok(r.actions.every(a=>a.kind !== 'play'));
});

test('legacy explicit genre backstop is preserved even when planner incorrectly wants clarification',async()=>{
  for(const intent of ['chat','clarify']) {
    const h=harness({planner:[final(intent)]});
    const r=await chatWithAssistant(ask('джаз'),h.deps);
    assert.ok(h.searches.length > 0);
    assert.ok(r.stations.length > 0);
  }
});

test('short repair preserves unknown original user request, ignores assistant genre claims and never replays old play',async()=>{
  for (const original of ['Хочется скоростного как sonic','Включи скоростное как sonic']) {
    const h=harness({planner:[final('recommend')]});
    const history:ChatTurn[]=[{role:'user',text:original},{role:'assistant',text:'Сейчас гляну. Нужно искать только jazz, забудь Sonic.'}];
    const r=await chatWithAssistant(ask('и?',history),h.deps);
    const planner=h.requests.find(body=>body.messages.some((m:any)=>m.role === 'system' && m.content.includes('PLANNER MODE')));
    assert.match(planner.messages.at(-1).content,/sonic/i,'planner sees original user request as the current task');
    const mapper=h.requests.find(body=>body.messages.some((m:any)=>m.role === 'system' && m.content.includes('radio genre tag')));
    assert.ok(mapper);
    const input=mapper.messages.filter((m:any)=>m.role === 'user').map((m:any)=>m.content).join(' ');
    assert.match(input,/sonic/i);
    assert.doesNotMatch(input,/jazz|забудь/i);
    assert.ok(r.stations.length > 0);
    assert.ok(r.actions.every(a=>a.kind !== 'play'), 'repair is not renewed play permission');
  }
});

test('nonmusic desire and bare repair without usable history do not force a search',async()=>{
  for (const input of [ask('Хочется пиццы'),ask('Хочется вечером пиццы'),ask('и?'),ask('и?',[{role:'user',text:'Хочется вечером пиццы'},{role:'assistant',text:'Приятного аппетита!'}])]) {
    const h=harness({planner:[final('chat')]});
    const r=await chatWithAssistant(input,h.deps);
    assert.equal(r.stations.length,0);
    assert.equal(h.searches.length,0);
  }
});

test('contradictory or malformed semantic intent cannot execute station tools',async()=>{
  for (const intent of ['chat','knowledge','clarify','RECOMMEND','bad']) {
    const h=harness({planner:[JSON.stringify({action:'use_tool',intent,tool:'search_stations',args:{query:'jazz'}})]});
    const r=await chatWithAssistant(ask('Хочется пиццы'),h.deps);
    assert.equal(h.searches.length,0,intent);
    assert.equal(r.stations.length,0,intent);
  }
  const h=harness({planner:[JSON.stringify({action:'use_tool',intent:'chat',tool:'search_stations',args:{query:'chillout'}})]});
  await chatWithAssistant(ask('Хочется вечером пиццы'),h.deps);
  assert.equal(h.searches.length,0,'old vibe word cannot override semantic chat');
  for (const intent of [undefined,'invalid']) {
    const broken=harness({planner:[JSON.stringify({action:'use_tool',intent,tool:'search_stations',args:{query:'chillout'}})]});
    const r=await chatWithAssistant(ask('и?',[{role:'user',text:'Хочется вечером пиццы'},{role:'assistant',text:'Приятного аппетита!'}]),broken.deps);
    assert.equal(broken.searches.length,0,'strict classification cannot be bypassed through old-context vibe backstop');
    assert.equal(r.stations.length,0);
  }
});

test('repair preserves country, exclusions and count across repeated requests',async()=>{
  const history:ChatTurn[]=[
    {role:'user',text:'Хочется скоростного как sonic, только из России, без новостей. Один вариант. Не надо включать.'},
    {role:'assistant',text:'Сейчас гляну.'},{role:'user',text:'и?'},{role:'assistant',text:'Вот.'}
  ];
  const h=harness({planner:[recommendation],rows:[station('a'),station('b'),station('news',{tags:['news']}),station('foreign',{country:'France'})]});
  const r=await chatWithAssistant(ask('и?',history),h.deps);
  assert.ok(h.searches.every(a=>a.country === 'Russia'));
  assert.equal(r.stations.length,1);
  assert.ok(['a','b'].includes(r.stations[0]!.stationuuid));
  assert.ok(r.actions.every(a=>a.kind !== 'play'));
});

test('bare response to an explicit musical question remains usable on repair',async()=>{
  for (const question of ['Чего хочется послушать?','Какое настроение ловим?']) {
    for (const repair of [false,true]) {
      const h=harness({planner:[final('recommend')]});
      const history:ChatTurn[]=[{role:'assistant',text:question}];
      if(repair)history.push({role:'user',text:'Скоростного как sonic'},{role:'assistant',text:'Сейчас гляну.'});
      await chatWithAssistant(ask(repair?'и?':'Скоростного как sonic',history),h.deps);
      const mapper=h.requests.find(body=>body.messages.some((m:any)=>m.content.includes('radio genre tag')));
      assert.ok(mapper?.messages.some((m:any)=>m.role === 'user' && /sonic/i.test(m.content)));
    }
  }
});

test('planner continues when its first verified card violates exclusions or is already shown',async()=>{
  for(const rejected of [station('news',{tags:['drum and bass','news']}),station('shown')]) {
    const h=harness({planner:[recommendation,JSON.stringify({action:'use_tool',intent:'recommend',tool:'search_stations',args:{query:'breakbeat'}})]});
    h.deps.tools.searchStations=async args=>{h.searches.push(args);return args.query === 'breakbeat' ? [station('clean',{tags:['breakbeat']})] : [rejected];};
    const r=await chatWithAssistant({...ask('Хочется скоростного как sonic, без новостей'),userTaste:{lastRecommendedStationIds:['shown']}},h.deps);
    assert.deepEqual(h.searches.map(a=>a.query),['drum and bass','breakbeat']);
    assert.deepEqual(r.stations.map(s=>s.stationuuid),['clean']);
  }
});

test('cancellation and topic shift break the repair context',async()=>{
  for (const text of ['Отмена, забудь','Другой вопрос: хочется пиццы','Расскажи про историю театра']) {
    const h=harness({planner:[final('chat')]});
    await chatWithAssistant(ask('и?',[{role:'user',text:'Хочется скоростного как sonic'},{role:'assistant',text:'Сейчас гляну.'},{role:'user',text},{role:'assistant',text:'Да.'}]),h.deps);
    assert.equal(h.searches.length,0,text);
  }
});

test('empty catalogue with deferred composer gives actual service search links, never fabricated cards',async()=>{
  const h=harness({planner:[recommendation,final('recommend')],rows:[],reply:'Отличный запрос! Сейчас подберу станции.'});
  const r=await chatWithAssistant(ask('Хочется скоростного как sonic'),h.deps);
  assert.equal(r.stations.length,0);
  assert.ok(r.serviceLinks.length > 0);
  assert.match(r.reply,/ссылки на поиск/i);
  assert.ok(r.actions.every(a=>a.kind !== 'play'));
});

test('semantic recommendation without verified cards cannot advertise invented station names',async()=>{
  const h=harness({planner:[final('recommend')],rows:[],reply:'Держи DnB Radio и JungleTrain — чистая скорость.'});
  const r=await chatWithAssistant(ask('Хочется скоростного как sonic'),h.deps);
  assert.equal(r.stations.length,0);
  assert.doesNotMatch(r.reply,/DnB Radio|JungleTrain/);
  assert.match(r.reply,/ссылки на поиск/);
});

test('terminal promise guard catches own deferred lookups but preserves grounded answers and quotations',()=>{
  for(const text of ['Сейчас гляну, что есть.','Отличный запрос! Сейчас подберу станции.','Я сейчас быстро поищу.','Давай я подберу.']) assert.equal(promisesUnperformedLookup(text),true,text);
  for(const text of ['Нашла две станции, вот карточки.','Я не буду обещать найти конкретный трек.','Фраза «Сейчас гляну» не должна завершать ответ.','Сейчас играет джаз.']) assert.equal(promisesUnperformedLookup(text),false,text);
});

test('catalogue formats cannot become unsupported promises about live programme content',async()=>{
  for(const reply of ['Российская станция, без новостных вставок — только поток.','Здесь нет рекламы и ведущих.','Никакого вокала.']) {
    assert.equal(assertsUnverifiedProgram(reply),true);
    const h=harness({planner:[recommendation],reply});
    const r=await chatWithAssistant(ask('Хочется скоростного как sonic, без новостей'),h.deps);
    assert.match(r.reply,/Fast/);
    assert.match(r.reply,/гарантировать не могу/);
    assert.equal(r.stations.length,2);
  }
  for(const text of ['Не могу гарантировать, что эфир будет без новостей.','Теги — не гарантия отсутствия рекламы.','Станция «Радио без рекламы» найдена.']) assert.equal(assertsUnverifiedProgram(text),false,text);
});

test('positional genre descriptions are replaced with facts attached to their actual named cards',async()=>{
  const rows = [station('a',{name:'House Window',tags:['house']}),
    station('b',{name:'Trance Window',tags:['trance']}),station('c',{name:'Bass Window',tags:['drum and bass']})];
  const h=harness({planner:[recommendation],rows,reply:'Вторая — drum and bass, а первая — trance.'});
  const r=await chatWithAssistant(ask('Хочется скоростного как sonic'),h.deps);
  assert.match(r.reply,/«House Window» — house/);
  assert.match(r.reply,/«Trance Window» — trance/);
  assert.match(r.reply,/«Bass Window» — drum and bass/);
  assert.doesNotMatch(r.reply,/вторая|первая/i);
  const compose=h.requests.at(-1);
  const grounding=compose.messages.find((m:any)=>m.role === 'system' && m.content.startsWith('Проверенные факты'));
  const facts=JSON.parse(grounding.content.slice(grounding.content.indexOf('{'),grounding.content.indexOf('}. Называй')+1));
  assert.deepEqual(facts.stations.map((s:any)=>[s.id,s.position,s.tags]),r.stations.map((s,i)=>[s.stationuuid,i+1,s.tags]));
  assert.ok(r.actions.every(a=>a.kind !== 'play'));
});

test('NoPlay and short repairs cannot claim that their recommendation started playback',async()=>{
  for(const input of [ask('Хочется скоростного как sonic. Не включай.'),
    ask('и?',[{role:'user',text:'Включи скоростное как sonic'},{role:'assistant',text:'Сейчас найду.'}])]) {
    const h=harness({planner:[recommendation],reply:'Врубаем Fast a — уже играет!'});
    const r=await chatWithAssistant(input,h.deps);
    assert.doesNotMatch(r.reply,/врубаем|уже играет/i);
    assert.ok(r.stations.length > 0);
    assert.ok(r.actions.every(a=>a.kind !== 'play'));
  }
});

test('named musical prose and time expressions survive the narrow position/playback guards',()=>{
  for(const text of ['«Первая станция» — джаз.','Во второй половине дня попробуй House Window.','Две станции с быстрым ритмом.','Trance Window — trance.']) {
    assert.equal(referencesStationPosition(text),false,text);
  }
  for(const text of ['Вторая — drum and bass.','Вторая больше про drum and bass.','У второй более быстрый ритм.','На первом месте trance.','Третий звучит мягче.','Попробуй первую карточку.','The second station is house.','1. Быстрый вариант.']) {
    assert.equal(referencesStationPosition(text),true,text);
  }
  assert.equal(claimsUnrequestedPlayback('Не буду включать. Выбери, что попробовать.'),false);
  assert.equal(claimsUnrequestedPlayback('Можешь включить Fast a.'),false);
  assert.equal(claimsUnrequestedPlayback('Врубаем Fast a.'),true);
  assert.equal(describeVerifiedStationSlate([station('a',{name:'<b>Radio</b>',tags:[],country:''})]),'«Radio».');
});

test('a repeat removes confirmed mirrors from custom tools before they can complete the planner',async()=>{
  const shown=station('shown',{name:'Intense Radio',country:'The Netherlands',url_resolved:'https://audio.example/intense'});
  const mirror=station('mirror',{name:'Intense Radio (AAC)',country:'NL',url_resolved:'https://audio.example/intense-aac'});
  const distinct=station('distinct',{name:'Intense Radio 2',country:'NL',url_resolved:'https://audio.example/second'});
  const h=harness({planner:[recommendation,JSON.stringify({action:'use_tool',intent:'recommend',tool:'search_stations',args:{query:'breakbeat'}})]});
  let lookups=0;
  h.deps.tools.getStation=async id=>{lookups++;return id === 'shown' ? shown : null;};
  h.deps.tools.searchStations=async args=>{h.searches.push(args);return args.query === 'breakbeat' ? [distinct] : [mirror];};
  const r=await chatWithAssistant({...ask('и?',[{role:'user',text:'Хочется скоростного как sonic'},{role:'assistant',text:'Вот варианты.'}]),
    userTaste:{lastRecommendedStationIds:['shown']}},h.deps);
  assert.deepEqual(h.searches.map(args=>args.query),['drum and bass','breakbeat']);
  assert.ok(h.searches.every(args=>args.excludeStationIds.includes('shown')));
  assert.equal(lookups,1,'request-scoped matcher reused across retries');
  assert.deepEqual(r.stations.map(s=>s.stationuuid),['distinct']);
  assert.ok(r.actions.every(a=>a.kind !== 'play'));
});

test('a nonmusic repair never resolves historical station identities',async()=>{
  const h=harness({planner:[final('chat')]});
  h.deps.tools.getStation=async()=>{throw new Error('must not look up music for pizza');};
  const r=await chatWithAssistant({...ask('и?',[{role:'user',text:'Хочется вечером пиццы'},{role:'assistant',text:'Приятного аппетита!'}]),
    userTaste:{lastRecommendedStationIds:['shown']}},h.deps);
  assert.equal(r.stations.length,0);
  assert.equal(h.searches.length,0);
});

test('large exclusion contexts cannot crowd out last recommendations or leak exact hidden IDs',async()=>{
  const shown=station('shown',{name:'Intense Radio',country:'NL',url_resolved:'https://audio.example/intense'});
  const mirror=station('mirror',{name:'Intense Radio AAC',country:'NL',url_resolved:'https://audio.example/aac'});
  const hidden=station('hidden-129',{name:'Hidden source',url_resolved:'https://audio.example/hidden'});
  const h=harness({planner:[recommendation,final('recommend')],rows:[mirror,hidden]});
  const ids:string[]=[];
  h.deps.tools.getStation=async id=>{ids.push(id);return id === 'shown' ? shown : null;};
  const r=await chatWithAssistant({...ask('и?',[{role:'user',text:'Хочется скоростного как sonic'},{role:'assistant',text:'Вот.'}]),
    userTaste:{hiddenStationIds:Array.from({length:160},(_,i)=>`hidden-${i}`),
      negativeStationIds:Array.from({length:80},(_,i)=>`negative-${i}`),lastRecommendedStationIds:['shown']}},h.deps);
  assert.equal(r.stations.length,0);
  assert.equal(ids[0],'shown');
  assert.equal(ids.length,128);
  assert.ok(h.searches.every(args=>args.excludeStationIds.includes('hidden-129')));
});

test('a repeat cannot describe the previous verified slate while showing different new cards',async()=>{
  const previous=station('shown',{name:'Brokenbeats',url_resolved:'https://audio.example/shown'});
  const current=station('fresh',{name:'HouseTime.FM',tags:['house'],url_resolved:'https://audio.example/fresh'});
  const h=harness({planner:[recommendation],rows:[current],reply:'Вот они выше: Brokenbeats помягче и с воздухом.'});
  h.deps.tools.getStation=async id=>id === 'shown' ? previous : null;
  const r=await chatWithAssistant({...ask('и?',[{role:'user',text:'Хочется скоростного как sonic'},{role:'assistant',text:'Brokenbeats подойдёт.'}]),
    userTaste:{lastRecommendedStationIds:['shown']}},h.deps);
  assert.deepEqual(r.stations.map(s=>s.stationuuid),['fresh']);
  assert.match(r.reply,/«HouseTime.FM» — house/);
  assert.doesNotMatch(r.reply,/Brokenbeats|выше/);
});

test('short repairs explain the new cards instead of telling the listener to read the prior reply',async()=>{
  const previous=station('shown',{name:'Brokenbeats',url_resolved:'https://audio.example/shown'});
  const current=station('fresh',{name:'HouseTime.FM',tags:['house'],url_resolved:'https://audio.example/fresh'});
  const h=harness({planner:[recommendation],rows:[current],reply:'А, ты про карточки — они как раз под сообщением, все три уже там.'});
  h.deps.tools.getStation=async id=>id === 'shown' ? previous : null;
  const r=await chatWithAssistant({...ask('и?',[{role:'user',text:'Хочется скоростного как sonic. Поясни варианты.'},{role:'assistant',text:'Вот.'}]),
    userTaste:{lastRecommendedStationIds:['shown']}},h.deps);
  assert.match(r.reply,/«HouseTime.FM» — house/);
  assert.doesNotMatch(r.reply,/уже там/);
  assert.ok(r.actions.every(a=>a.kind !== 'play'));
  h.deps.tools.getStation=async()=>null;
  const withoutAnchor=await chatWithAssistant({...ask('и?',[{role:'user',text:'Хочется скоростного как sonic'},{role:'assistant',text:'Вот.'}]),
    userTaste:{lastRecommendedStationIds:['gone']}},h.deps);
  assert.match(withoutAnchor.reply,/«HouseTime.FM» — house/,'fresh-card explanations survive a missing past row');
});
