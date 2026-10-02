import assert from 'node:assert/strict';
import test from 'node:test';
import { attachSearchIndex, buildSearchResponse, type CatalogStation } from '../src/catalog/service.js';
import { createCatalogToolProvider, type CatalogServiceLike } from '../src/ai/catalogToolProvider.js';
import { chatWithAssistant } from '../src/ai/brain.js';

type SearchFilters = Parameters<typeof buildSearchResponse>[1];
type SearchRequest = Parameters<CatalogServiceLike['search']>[0];
type SearchItem = Awaited<ReturnType<CatalogServiceLike['search']>>['items'][number];

const row = (over: Partial<CatalogStation>): CatalogStation => {
  const id = over.stationuuid || 'station';
  const stream = `https://stream.example/${id}`;
  return {
    stationuuid: id,
    name: over.name || 'Radio',
    url: over.url || stream,
    url_resolved: over.url_resolved || stream,
    homepage: '',
    favicon: '',
    tags: over.tags || '',
    country: over.country || 'Canada',
    countrycode: 'CA',
    state: '',
    language: 'English',
    codec: 'AAC',
    bitrate: 128,
    geo_lat: null,
    geo_long: null,
    lastcheckok: 1,
    ...over
  };
};

const catalogFor = (
  rows: CatalogStation[],
  options: { inject?: (items: SearchItem[]) => SearchItem[] } = {}
) => {
  const indexed = attachSearchIndex(rows);
  const calls: SearchRequest[] = [];
  const catalog: CatalogServiceLike = {
    search: async filters => {
      calls.push(filters);
      const response = buildSearchResponse(indexed, filters as SearchFilters);
      return {
        items: options.inject ? options.inject(response.items) : response.items,
        nextCursor: response.nextCursor
      };
    },
    getStationById: async id => rows.find(station => station.stationuuid === id) || null,
    getSummary: async () => ({}),
    getCatalog: async () => rows
  };
  return {catalog, calls};
};

test('semantic provider search retrieves punctuation and spelling aliases with no station-name clues', async () => {
  const scenarios = [
    {
      semanticGenre: 'lo-fi',
      rows: [row({stationuuid:'lo-hyphen', name:'Station One', tags:'lo-fi'}), row({stationuuid:'lo-space', name:'Station Two', tags:'lo fi'}), row({stationuuid:'lo-short', name:'Station Three', tags:'lofi'})],
      expected: ['lo-hyphen', 'lo-space', 'lo-short'],
      canonical: 'lo fi'
    },
    {
      semanticGenre: 'Hip-Hop',
      rows: [row({stationuuid:'hip-hyphen', name:'Station Four', tags:'hip-hop'}), row({stationuuid:'hip-space', name:'Station Five', tags:'hip hop'})],
      expected: ['hip-hyphen', 'hip-space'],
      canonical: 'hip hop'
    },
    {
      semanticGenre: 'Drum & Bass',
      rows: [row({stationuuid:'dnb', name:'Station Six', tags:'DnB'}), row({stationuuid:'drum-n', name:'Station Seven', tags:"drum 'n' bass"}), row({stationuuid:'drum-amp', name:'Station Eight', tags:'drum & bass'})],
      expected: ['dnb', 'drum-n', 'drum-amp'],
      canonical: 'drum and bass'
    }
  ];

  for (const scenario of scenarios) {
    const {catalog, calls} = catalogFor(scenario.rows);
    const stations = await createCatalogToolProvider(catalog).searchStations({
      query: 'This wording is not in any station name',
      tag: 'This is also ignored for semantic retrieval',
      semanticGenre: scenario.semanticGenre,
      limit: 8
    });
    assert.deepEqual(new Set(stations.map(station => station.stationuuid)), new Set(scenario.expected));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.q, '');
    assert.equal(calls[0]?.tag, scenario.canonical);
    assert.ok(calls[0]?.tagAliases && calls[0].tagAliases.length > 1);
  }
});

test('semantic exact evidence filtering rejects compound-tag and name-only lookalikes before the cap', async () => {
  const compound = row({stationuuid:'compound', name:'Future Garage', tags:'future garage mix'});
  const laterTag = row({stationuuid:'later-tag', name:'Actual Station', tags:'rock,pop,jazz,ambient,funk,soul,future garage'});
  const valid = row({stationuuid:'valid', name:'Second Actual Station', tags:'future garage'});
  const {catalog, calls} = catalogFor([compound, laterTag, valid], {
    // Exercise the provider's own-evidence guard even when a structural catalog
    // adapter returns noisy rows alongside the real ranked-search page.
    inject: items => [compound, ...items]
  });
  const stations = await createCatalogToolProvider(catalog).searchStations({
    query: 'Future Garage', tag: 'future garage', semanticGenre: 'future garage', limit: 2
  });

  assert.deepEqual(stations.map(station => station.stationuuid), ['later-tag', 'valid']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.q, '');
});

test('semantic search keeps country and repeat exclusions, while ordinary literal search stays literal', async () => {
  const played = row({stationuuid:'played', name:'Known Lo Fi', tags:'lo-fi'});
  const mirror = row({stationuuid:'mirror', name:'Known Lo-Fi AAC', tags:'lo fi', url_resolved:'https://stream.example/mirror'});
  const localOne = row({stationuuid:'local-one', name:'Local One', tags:'lo-fi', url_resolved:'https://local.example/one'});
  const localTwo = row({stationuuid:'local-two', name:'Local Two', tags:'lo fi', url_resolved:'https://local.example/two'});
  const foreign = row({stationuuid:'foreign', name:'Foreign', country:'France', tags:'lo-fi', url_resolved:'https://foreign.example/one'});
  const rows = [played, mirror, localOne, localTwo, foreign];
  const semantic = catalogFor(rows);
  const stations = await createCatalogToolProvider(semantic.catalog).searchStations({
    query: 'irrelevant title', tag:'lo-fi', semanticGenre:'lo-fi', country:'Canada',
    excludeStationIds:['played'], limit:2
  });
  assert.deepEqual(stations.map(station => station.stationuuid), ['local-one', 'local-two']);
  assert.ok(stations.every(station => station.country === 'Canada'));

  const ordinary = catalogFor(rows);
  await createCatalogToolProvider(ordinary.catalog).searchStations({query:'local', tag:'lo-fi', limit:2});
  assert.equal(ordinary.calls[0]?.q, 'local');
  assert.equal(ordinary.calls[0]?.tag, 'lo-fi');
  assert.equal(ordinary.calls[0]?.tagAliases, undefined);
});

test('spelling variants survive the full brain and real catalogue search, not only the provider filter',async()=>{
  const rows=[row({stationuuid:'hyphen',name:'Night One',tags:'lo-fi'}),
    row({stationuuid:'compact',name:'Night Two',tags:'lofi'}),row({stationuuid:'space',name:'Night Three',tags:'lo fi'})];
  const {catalog}=catalogFor(rows);
  const result=await chatWithAssistant({userMessage:'Подбери домашний бит. Три варианта, не включай.',surface:'miniapp',locale:'ru'}, {
    model:{enabled:true,apiKey:'stub',baseUrl:'https://model.example',model:'deepseek-v4-pro',timeoutSec:8,maxOutputTokens:1000},
    tools:createCatalogToolProvider(catalog),musicServices:[],now:()=>5,log:()=>{},
    fetch:(async(_url,init)=>{
      const body=JSON.parse(String(init?.body));
      const planner=body.messages.some((message:any)=>message.content.includes('PLANNER MODE'));
      const content=planner ? JSON.stringify({action:'use_tool',intent:'recommend',tool:'search_stations',args:{query:'electronic'},
        semanticSearch:{kind:'hypothesis',tags:['lo-fi']}}) : JSON.stringify({v:1,cards:[]});
      return new Response(JSON.stringify({choices:[{message:{content}}],usage:{prompt_tokens:10,completion_tokens:10}}),{status:200});
    }) as typeof fetch
  });
  assert.deepEqual(new Set(result.stations.map(station=>station.stationuuid)),new Set(['hyphen','compact','space']));
  assert.ok(result.actions.every(action=>action.kind !== 'play'));
});

test('semantic exclusions refill a bounded later page instead of letting contradictory tags occupy the cap',async()=>{
  const calls:SearchRequest[]=[];
  const excluded=row({stationuuid:'ambient',name:'Soft Source',tags:'industrial,dark ambient'});
  const valid=row({stationuuid:'rhythm',name:'Different Source',tags:'industrial'});
  const catalog:CatalogServiceLike={
    search:async args=>{calls.push(args);return {items:args.cursor ? [valid] : [excluded],nextCursor:args.cursor ? null : '24'};},
    getStationById:async()=>null,getSummary:async()=>({}),getCatalog:async()=>[]
  };
  const selected=await createCatalogToolProvider(catalog).searchStations({query:'industrial',semanticGenre:'industrial',
    semanticExcludeTags:['ambient'],limit:1});
  assert.deepEqual(selected.map(s=>s.stationuuid),['rhythm']);
  assert.equal(calls.length,2);
  assert.ok(calls[1]!.cursor > 0);
});
