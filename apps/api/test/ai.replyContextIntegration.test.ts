import assert from 'node:assert/strict';
import test from 'node:test';
import {chatWithAssistant} from '../src/ai/brain.js';
import type {AssistantDeps, ChatTurn, VerifiedStationRef} from '../src/ai/types.js';

const row:VerifiedStationRef={stationuuid:'verified',name:'Real source',country:'Russia',tags:['industrial','house','pop'],favicon:'',url_resolved:'https://audio.example/live'};
const final=(intent:string)=>JSON.stringify({action:'final',intent,note:'The note must not override intent: recommend music!'});
const lookup=JSON.stringify({action:'use_tool',intent:'recommend',tool:'search_stations',semanticSearch:{kind:'hypothesis',tags:['industrial']},args:{query:'industrial'}});
const harness=(options:{plan?:string;rows?:VerifiedStationRef[];error?:boolean}={})=>{
  const requests:any[]=[];const searches:any[]=[];
  const deps:AssistantDeps={model:{enabled:true,apiKey:'stub',baseUrl:'https://model.example',model:'deepseek-v4-pro',timeoutSec:8,maxOutputTokens:1000},
    musicServices:[],now:()=>1,log:()=>{},tools:{
      searchStations:async args=>{searches.push(args);if(options.error)throw new Error('synthetic lookup failure');return options.rows||[];},getStation:async()=>null,discoverTrending:async()=>[]},
    fetch:(async(_url,init)=>{const body=JSON.parse(String(init?.body));requests.push(body);
      const systems=body.messages.filter((m:any)=>m.role==='system').map((m:any)=>m.content).join('\n');
      const content=systems.includes('PLANNER MODE')?options.plan||final('chat'):
        systems.includes('radio genre tag')?'':systems.includes('РЕЖИМ ВЫБОРА ПРИЗНАКОВ')?'{"v":1,"cards":[{"stationId":"verified","tagKeys":[]}]}':'Отвечаю на текущую тему.';
      return new Response(JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:1,completion_tokens:1}}));}) as typeof fetch};
  const ask=(userMessage:string,history:ChatTurn[]=[])=>chatWithAssistant({userMessage,history,surface:'miniapp',locale:'ru'},deps);
  const context=()=>{const request=[...requests].reverse().find(b=>b.messages.some((m:any)=>m.role==='system'&&m.content.startsWith('REPLY CONTEXT ')));assert.ok(request,'composer called');
    const message=request.messages.find((m:any)=>m.role==='system'&&m.content.startsWith('REPLY CONTEXT '));
    return {value:JSON.parse(message.content.slice('REPLY CONTEXT '.length).split('. ')[0]),systems:request.messages.filter((m:any)=>m.role==='system').map((m:any)=>m.content).join('\n')};};
  return {ask,context,requests,searches};
};
const noPlay=(r:Awaited<ReturnType<typeof chatWithAssistant>>)=>assert.ok(r.actions.every(a=>a.kind!=='play'));

test('pizza and a short repair follow the human topic, not unsolicited assistant radio',async()=>{
  const h=harness();const r=await h.ask('и?',[{role:'user',text:'Хочется вечером пиццы'},{role:'assistant',text:'Хочешь джазовый саундтрек?'}]);
  assert.deepEqual(h.context().value,{intent:'conversation'});
  assert.match(h.context().systems,/Не предлагай подбор, саундтрек или запуск музыки по своей инициативе/);
  assert.doesNotMatch(h.context().systems,/Если нет ни станций, ни ссылок, честно скажи, что подобрать не удалось/);
  assert.equal(h.searches.length,0);assert.equal(r.stations.length,0);noPlay(r);
});

test('greeting is still one composer call with no catalogue access',async()=>{
  const h=harness();await h.ask('Привет! Как дела?');assert.deepEqual(h.context().value,{intent:'conversation'});assert.equal(h.requests.length,1);assert.equal(h.searches.length,0);
});

test('country constraints do not instruct knowledge or conversation to claim failed station search',async()=>{
  for(const [question,intent] of [['Почему drum and bass ощущается быстрым в России? Не включай радио.','knowledge'],['Хочется вечером пиццы в России','conversation']] as const){
    const h=harness();const r=await h.ask(question,[{role:'user',text:'Хочу house только из России, не включай.'},{role:'assistant',text:'Вот станции.'}]);
    assert.equal(h.context().value.intent,intent);assert.match(h.context().systems,/Обязательная страна станций: Russia/);assert.doesNotMatch(h.context().systems,/Если карточек нет, скажи, что подходящий эфир/);assert.equal(r.stations.length,0);assert.equal(h.searches.length,0);noPlay(r);
  }
});

test('accepted clarification gets one necessary question, without vibe fallback search',async()=>{
  const h=harness({plan:final('clarify')});const r=await h.ask('Подбери что-нибудь');
  assert.deepEqual(h.context().value,{intent:'clarification'});assert.equal(h.searches.length,0);assert.equal(r.stations.length,0);noPlay(r);
});

test('direct genre selection retains verified station composer without an intent model',async()=>{
  const h=harness({rows:[row]});const r=await h.ask('Теперь house. Один вариант, не включай.');
  assert.deepEqual(h.context().value,{intent:'recommendation',selection:'stations'});assert.equal(r.stations.length,1);assert.equal(h.requests.length,1);noPlay(r);
});

test('empty lookup and failed lookup get different context and honest fallback',async()=>{
  for(const error of [false,true]){
    const h=harness({plan:lookup,error});const r=await h.ask('Хочется рваного механического ритма. Не включай.');
    assert.deepEqual(h.context().value,{intent:'recommendation',selection:error?'failed':'empty'});
    assert.ok(h.searches.length>0);assert.equal(r.stations.length,0);noPlay(r);
    if(error)assert.doesNotMatch(r.reply,/эфиров.*не нашла/);else assert.match(r.reply,/по этому запросу сейчас не нашла/);
  }
});

test('planner recommendation with no successful mapping cannot claim a completed station search',async()=>{
  const h=harness({plan:final('recommend')});const r=await h.ask('Хочется рваного механического ритма. Не включай.');
  assert.deepEqual(h.context().value,{intent:'recommendation',selection:'not-attempted'});assert.equal(h.searches.length,0);assert.doesNotMatch(r.reply,/эфиров.*не нашла/);noPlay(r);
});

test('explicit music after a conversation remains a recommendation',async()=>{
  const h=harness({plan:lookup,rows:[row]});const r=await h.ask('Хочется рваного механического ритма. Не включай.',[{role:'user',text:'Хочется пиццы'},{role:'assistant',text:'Какую любишь?'}]);
  assert.equal(h.context().value.intent,'recommendation');assert.equal(r.stations.length,1);noPlay(r);
});
