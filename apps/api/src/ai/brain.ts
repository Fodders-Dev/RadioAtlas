// chatWithAssistant — the shared brain. A two-phase agentic loop (rewritten in
// TS from the FoddersGameBot pattern):
//   1. PLANNER MODE (temp 0.1): decide whether to call a tool for fresh/
//      verifiable data, or go straight to the reply. Loops up to MAX_TOOL_STEPS,
//      de-duping tool+args, so a turn costs ≤4 DeepSeek calls.
//   2. REPLY MODE (temp 0.6): compose «Лира»'s reply, grounding any station
//      facts ONLY in the tool observations.
// Post-processing verifies stations (cards come from observations only), checks
// the voice, and cleans the text. Every failure path returns a warm fallback.

import { cleanText, collectVerifiedStations, isVoiceSafe } from './antiHallucination.js';
import { callDeepseek, type DeepseekMessage } from './deepseekClient.js';
import { buildFallbackResult } from './fallbacks.js';
import { buildSystemPrompt } from './persona.js';
import {
  MAX_TOOL_STEPS,
  TOOL_SCHEMAS,
  parsePlannerDecision,
  runTool,
  toolSignature
} from './tools.js';
import type {
  AssistantAction,
  AssistantDeps,
  ChatInput,
  ChatResult,
  ChatTurn,
  ChatUsage,
  ServiceLink,
  ToolObservation,
  VerifiedStationRef
} from './types.js';

const MAX_HISTORY_TURNS = 8;
const PLANNER_MAX_TOKENS = 400;

// Intent heuristics (RU). They never BLOCK a tool the planner wants — they only
// (a) let obvious chat skip the planner call for latency, and (b) decide whether
// a found station should auto-play.
const ACTION_INTENT = /(включ|постав|вруб|запусти|посовету|порекоменд|найд|ищ[уи]|хочу\s+послуша|подбер|что\s+послуша|станци|радио|трек|песн|альбом|саундтрек|soundtrack|плейлист|исполнител|артист|группа)/i;
const PLAY_INTENT = /(включ|постав|вруб|запусти|давай\s+послуша)/i;

// A strong "act now" intent: an explicit play verb OR a recommend/find verb.
// When this fires AND a concrete topic survives the noise-strip, the brain
// FORCES a station search even mid-conversation, instead of letting the planner
// ask "which jazz?" (the live regression: «включи джаз» with history → no cards).
const SEARCH_INTENT = /(включ|постав|вруб|запусти|давай\s+послуша|сыграй|ставь|посовету|порекоменд|найд|покаж|подбер|хочу\s+послуша)/i;

// Noise stems removed to derive the station-search query. Cyrillic — JS \b/\w
// are ASCII-only — so match by word-prefix, not boundary.
const QUERY_NOISE_STEMS = [
  'включ', 'постав', 'вруб', 'запусти', 'давай', 'послуша', 'посовету', 'порекоменд',
  'найд', 'покаж', 'подбер', 'хочу', 'дай', 'ставь', 'сыграй', 'мне', 'нам',
  'пожалуйста', 'плиз', 'что-ниб', 'чего-ниб', 'чё-ниб', 'какой-ниб', 'какую-ниб',
  'какое-ниб', 'каких-ниб'
];

export const buildStationQuery = (message: string): string => {
  const words = message
    .toLowerCase()
    .replace(/[?!.,;:()«»"']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.filter((word) => !QUERY_NOISE_STEMS.some((stem) => word.startsWith(stem)));
  return kept.join(' ').trim();
};

// The cleaned topic to search for, ONLY when the request is an explicit play/rec
// intent that names something concrete. A residual under 3 chars (e.g. «включи
// что-нибудь») is genuinely ambiguous → null, so the planner may clarify.
const explicitSearchQuery = (message: string): string | null => {
  if (!SEARCH_INTENT.test(message)) return null;
  const query = buildStationQuery(message);
  return query.length >= 3 ? query : null;
};

const isSmalltalk = (message: string): boolean => !ACTION_INTENT.test(message);

const trimHistory = (history: ChatTurn[] | undefined): ChatTurn[] =>
  (history || [])
    .filter((turn) => turn && typeof turn.text === 'string' && turn.text.trim())
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, text: turn.text.trim() }));

const transcriptMessages = (history: ChatTurn[], userMessage: string): DeepseekMessage[] => [
  ...history.map((turn) => ({ role: turn.role, content: turn.text })),
  { role: 'user' as const, content: userMessage }
];

const addUsage = (into: ChatUsage, add: ChatUsage | undefined) => {
  if (!add) return;
  into.prompt += add.prompt;
  into.completion += add.completion;
};

// Compact station facts the composer is allowed to reference (names/ids only
// from here). Excludes url_resolved — the model never needs the raw stream.
const factsForModel = (observations: ToolObservation[]) => ({
  stations: collectVerifiedStations(observations).map((station) => ({
    id: station.stationuuid,
    name: station.name,
    country: station.country,
    tags: station.tags
  })),
  hasServiceLinks: observations.some((obs) => (obs.serviceLinks || []).length > 0),
  trendingNote: observations.find((obs) => obs.tool === 'discover_trending')?.note || null
});

const buildPlannerSystem = (): string => {
  const toolList = TOOL_SCHEMAS.map(
    (schema) => `- ${schema.name}: ${schema.description} args=${schema.args}`
  ).join('\n');
  return [
    'PLANNER MODE. Ты планируешь следующий шаг музыкальной спутницы, прежде чем она ответит.',
    'Верни СТРОГО JSON, без прозы и markdown:',
    '{"action":"use_tool"|"final","tool":"<имя инструмента>","args":{...},"note":"<очень кратко>"}',
    '',
    'Доступные инструменты:',
    toolList,
    '',
    'Вызывай инструмент ТОЛЬКО когда нужны свежие/проверяемые данные: найти реальную станцию, подтвердить станцию, узнать что сейчас в тренде, или дать ссылки на внешние музыкальные сервисы для конкретного трека/альбома/артиста.',
    'Если человек явно просит включить/поставить станцию ИЛИ советует жанр/настроение/страну («включи джаз», «посоветуй спокойное на вечер», «поставь что-то бразильское») — СРАЗУ вызывай search_stations с этим запросом, даже посреди разговора и даже если уже болтали. НЕ переспрашивай «а какой именно?».',
    '',
    'РАСШИРЕНИЕ ЗАПРОСА. Каталог станций ищет по ИМЕНИ и ТЕГАМ станций (теги — в основном английские жанры), НЕ по именам артистов и не по свободным фразам. Поэтому в search_stations.query клади ЭФФЕКТИВНЫЙ поисковый запрос — канонический английский жанр/тег, а не дословную фразу пользователя:',
    '— Артист или группа → его жанр(ы): «Limp Bizkit» → «nu metal», «Daft Punk» → «electronic», «Hans Zimmer» → «soundtrack». Ищи ЖАНР, а не имя артиста.',
    '— Русское или нечёткое описание → канонический английский тег: «игровые саундтреки» → «video game music», «спокойное на вечер» → «chillout» или «ambient», «вечерний джаз» → «jazz», «что-то бразильское» → «brazilian», «бодрое для спорта» → «workout».',
    'Если search_stations вернул пусто (found=false или станций нет) — НЕ сдавайся: вызови ЕЩЁ ОДИН search_stations с ДРУГИМ запросом (более широкий жанр, другой английский тег или одно самое сильное слово) ПРЕЖДЕ чем звать music_service_search. Только когда и расширенный поиск пуст — тогда music_service_search.',
    'Уточняющий вопрос (action "final" без станций) допустим ТОЛЬКО когда жанр/настроение/страна вообще не названы («включи что-нибудь»).',
    'Обычный разговор, мнения, история и эрудиция о музыке → action "final" (без инструмента).',
    'Никогда не вызывай один и тот же инструмент с теми же аргументами дважды.',
    'Когда данных достаточно или инструмент не нужен → action "final".'
  ].join('\n');
};

const planAgentStep = async (
  deps: AssistantDeps,
  transcript: DeepseekMessage[],
  observations: ToolObservation[]
) => {
  const messages: DeepseekMessage[] = [
    { role: 'system', content: buildPlannerSystem() },
    ...transcript
  ];
  if (observations.length) {
    messages.push({
      role: 'system',
      content: `Уже собранные наблюдения (JSON): ${JSON.stringify(
        observations.map((obs) => ({
          tool: obs.tool,
          found: obs.found,
          stations: (obs.stations || []).map((s) => s.name),
          error: obs.error
        }))
      )}. Реши следующий шаг.`
    });
  }
  const result = await callDeepseek(
    deps.deepseek,
    messages,
    { temperature: 0.1, maxTokens: PLANNER_MAX_TOKENS },
    deps.fetch
  );
  return { result, decision: result.error ? { action: 'final' as const } : parsePlannerDecision(result.content) };
};

// Run the plan→tool→observe loop from `startStep` up to MAX_TOOL_STEPS, appending
// observations and accumulating usage. Shared by the normal path (startStep 0)
// and the forced-search path (startStep 1, after a deterministic first search).
const runPlannerLoop = async (
  deps: AssistantDeps,
  transcript: DeepseekMessage[],
  observations: ToolObservation[],
  usedSignatures: Set<string>,
  usage: ChatUsage,
  startStep: number
) => {
  for (let step = startStep; step < MAX_TOOL_STEPS; step += 1) {
    const { result, decision } = await planAgentStep(deps, transcript, observations);
    addUsage(usage, result.usage);
    if (decision.action !== 'use_tool' || !decision.tool) break;
    const args = decision.args || {};
    const signature = toolSignature(decision.tool, args);
    if (usedSignatures.has(signature)) break; // never repeat the same call
    usedSignatures.add(signature);
    const observation = await runTool(decision.tool, args, {
      tools: deps.tools,
      musicServices: deps.musicServices
    });
    observations.push(observation);
    if (observation.error) deps.log(`ai tool ${decision.tool} error: ${observation.error}`);
  }
};

const composeAgentReply = async (
  deps: AssistantDeps,
  systemPrompt: string,
  transcript: DeepseekMessage[],
  observations: ToolObservation[]
) => {
  const messages: DeepseekMessage[] = [
    { role: 'system', content: systemPrompt },
    ...transcript,
    {
      role: 'system',
      content: `Проверенные факты (бери станции — названия и id — ТОЛЬКО отсюда; ничего не выдумывай): ${JSON.stringify(
        factsForModel(observations)
      )}. Если станций здесь нет, но есть ссылки на музыкальные сервисы (hasServiceLinks=true) — тепло предложи послушать там (ссылки покажутся кнопками), не извиняйся и не говори, что ничего не нашла. Если нет ни станций, ни ссылок — мягко предложи уточнить настроение.`
    }
  ];
  return callDeepseek(
    deps.deepseek,
    messages,
    { temperature: 0.6, maxTokens: deps.deepseek.maxOutputTokens },
    deps.fetch
  );
};

const deriveActions = (
  stations: VerifiedStationRef[],
  playIntent: boolean
): AssistantAction[] => {
  const lead = stations[0];
  if (!lead) return [{ kind: 'none' }];
  return [
    {
      kind: playIntent ? 'play' : 'open-station',
      stationuuid: lead.stationuuid
    }
  ];
};

const collectServiceLinks = (observations: ToolObservation[]): ServiceLink[] => {
  for (const obs of observations) {
    if (obs.serviceLinks && obs.serviceLinks.length) return obs.serviceLinks;
  }
  return [];
};

export const chatWithAssistant = async (
  input: ChatInput,
  deps: AssistantDeps
): Promise<ChatResult> => {
  const surface = input.surface;
  const now = deps.now();
  const userMessage = String(input.userMessage || '').trim();

  // Enabled-gate: no key / disabled → warm fallback, never a hard error.
  if (!deps.deepseek.enabled || !deps.deepseek.apiKey || !userMessage) {
    return buildFallbackResult({ surface, now, reason: 'disabled' });
  }

  const systemPrompt = buildSystemPrompt(input.locale, surface);
  const history = trimHistory(input.history);
  const transcript = transcriptMessages(history, userMessage);
  const usage: ChatUsage = { prompt: 0, completion: 0 };
  const observations: ToolObservation[] = [];
  const usedSignatures = new Set<string>();
  const forcedQuery = explicitSearchQuery(userMessage);

  if (forcedQuery) {
    // Explicit play/rec intent with a concrete topic → ACT: search stations now
    // (deterministically, history notwithstanding), then keep planning for any
    // refinement (e.g. a named track → service links).
    const forcedArgs = { query: forcedQuery };
    usedSignatures.add(toolSignature('search_stations', forcedArgs));
    const forcedObservation = await runTool('search_stations', forcedArgs, {
      tools: deps.tools,
      musicServices: deps.musicServices
    });
    observations.push(forcedObservation);
    if (forcedObservation.error) deps.log(`ai tool search_stations error: ${forcedObservation.error}`);
    await runPlannerLoop(deps, transcript, observations, usedSignatures, usage, 1);
  } else if (!isSmalltalk(userMessage)) {
    // Normal planner loop — skipped for obvious chat (latency fast-path).
    await runPlannerLoop(deps, transcript, observations, usedSignatures, usage, 0);
  }

  // Empty-result fallback: an explicit play/rec intent that found NO stations and
  // NO links yet → fetch external service-search links for the same query, so
  // there is ALWAYS something tappable instead of a prose apology. Runs BEFORE
  // compose so the reply can offer the services rather than say "не нашла".
  if (
    forcedQuery &&
    collectVerifiedStations(observations).length === 0 &&
    collectServiceLinks(observations).length === 0
  ) {
    const linkObservation = await runTool('music_service_search', { query: forcedQuery }, {
      tools: deps.tools,
      musicServices: deps.musicServices
    });
    observations.push(linkObservation);
  }

  // Compose the reply.
  const composed = await composeAgentReply(deps, systemPrompt, transcript, observations);
  addUsage(usage, composed.usage);

  const stations = collectVerifiedStations(observations);
  const serviceLinks = collectServiceLinks(observations);

  // Compose failed / empty / off-voice → warm fallback (carrying any stations
  // we DID verify, so the answer is never a dead end).
  if (composed.error || !composed.content.trim() || !isVoiceSafe(composed.content)) {
    const reason = composed.error ? 'compose-error' : !composed.content.trim() ? 'empty' : 'voice-unsafe';
    if (reason === 'voice-unsafe') deps.log('ai compose rejected by voice safety');
    return {
      ...buildFallbackResult({ surface, now, reason, stations, serviceLinks }),
      usage
    };
  }

  return {
    reply: cleanText(composed.content, surface),
    stations,
    serviceLinks,
    actions: deriveActions(stations, PLAY_INTENT.test(userMessage)),
    usage
  };
};
