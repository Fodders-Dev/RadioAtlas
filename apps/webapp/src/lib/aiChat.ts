// Mini App → /ai/chat client. Sends the session Bearer (when signed in; the
// route also accepts anonymous) and the in-memory history. Provider keys never
// reach the client — this only talks to our own API.

import { getApiBase } from './apiBase';

const SESSION_STORAGE_KEY = 'radio:session:v1';
const SAFETY_ID_STORAGE_KEY = 'radio:lira-safety-id:v1';

export type ChatRole = 'user' | 'assistant';

export type ChatStationRef = {
  stationuuid: string;
  name: string;
  country: string;
  tags: string[];
  favicon: string;
  url_resolved: string;
  deepLink?: string;
};

export type ChatServiceLink = {
  service: string;
  label: string;
  url: string;
  query: string;
};

export type ChatSource = {
  title: string;
  url: string;
  publishedDate?: string;
};

export type ChatActionRef = {
  actionId?: string;
  kind: 'play' | 'open-station' | 'enqueue' | 'set-favorite' | 'pause' | 'none';
  stationuuid?: string;
  desired?: boolean;
  permission?: 'read' | 'write';
};

export type ChatActionReceipt = {
  actionId: string;
  kind: ChatActionRef['kind'];
  status: 'executed' | 'skipped' | 'failed';
  stationuuid?: string;
  detail?: string;
};

export type ChatAgentContext = {
  isPlaying?: boolean;
  queueStationIds?: string[];
};

export type ChatRunSummary = {
  runId: string;
  status: 'completed' | 'needs_input' | 'blocked' | 'failed';
  route: 'direct_action' | 'music_worker';
};

export type ChatResponse = {
  reply: string;
  stations: ChatStationRef[];
  serviceLinks: ChatServiceLink[];
  sources: ChatSource[];
  actions: ChatActionRef[];
  run?: ChatRunSummary;
};

export type ChatHistoryTurn = { role: ChatRole; text: string };

export type ChatUserTaste = {
  favoriteStationIds?: string[];
  recentStationIds?: string[];
  hiddenStationIds?: string[];
  negativeStationIds?: string[];
  lastRecommendedStationIds?: string[];
  stationScores?: Record<string, number>;
  tagScores?: Record<string, number>;
  countryScores?: Record<string, number>;
  languageScores?: Record<string, number>;
};

export type ChatNowPlaying = {
  track?: string;
  stationName?: string;
  stationUuid?: string;
};

export type ChatRequestOptions = {
  userTaste?: ChatUserTaste;
  nowPlaying?: ChatNowPlaying;
  agentContext?: ChatAgentContext;
  actionReceipts?: ChatActionReceipt[];
};

const readToken = (): string => {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

const readSafetyIdentifier = (): string => {
  try {
    const stored = localStorage.getItem(SAFETY_ID_STORAGE_KEY);
    if (stored) return stored;
    const entropy = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const value = `lira:${entropy}`.slice(0, 128);
    localStorage.setItem(SAFETY_ID_STORAGE_KEY, value);
    return value;
  } catch {
    return 'lira:anonymous';
  }
};

const ACTION_KINDS = new Set<ChatActionRef['kind']>([
  'play', 'open-station', 'enqueue', 'set-favorite', 'pause', 'none'
]);

const parseActions = (raw: unknown): ChatActionRef[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item): ChatActionRef | null => {
      const kind = item.kind as ChatActionRef['kind'];
      if (!ACTION_KINDS.has(kind)) return null;
      const actionId = typeof item.actionId === 'string' ? item.actionId.slice(0, 160) : undefined;
      const stationuuid = typeof item.stationuuid === 'string' ? item.stationuuid.slice(0, 160) : undefined;
      const permission = item.permission === 'read' || item.permission === 'write' ? item.permission : undefined;
      const desired = typeof item.desired === 'boolean' ? item.desired : undefined;
      return { kind, ...(actionId ? { actionId } : {}), ...(stationuuid ? { stationuuid } : {}), ...(permission ? { permission } : {}), ...(desired === undefined ? {} : { desired }) };
    })
    .filter((item): item is ChatActionRef => item !== null)
    .slice(0, 3);
};

export const isAiAssistantEnabled = (): boolean => {
  const configured = String(import.meta.env.VITE_AI_ENABLED || '').trim();
  if (configured) return configured === '1';
  // Local UI work should never silently lose the Lira navigation entry just
  // because a developer started Vite without copying an env file. Production
  // remains opt-in and still requires the API-side AI settings.
  return Boolean(import.meta.env.DEV);
};

export const postChatMessage = async (
  message: string,
  history: ChatHistoryTurn[],
  options: ChatRequestOptions = {}
): Promise<ChatResponse> => {
  const apiBase = getApiBase();
  if (!apiBase) throw new Error('assistant is unavailable');
  const token = readToken();
  const response = await fetch(`${apiBase}/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      message,
      history,
      userTaste: options.userTaste,
      nowPlaying: options.nowPlaying,
      agentContext: options.agentContext,
      actionReceipts: options.actionReceipts,
      safetyIdentifier: readSafetyIdentifier()
    })
  });
  if (!response.ok) {
    throw new Error(`chat failed (${response.status})`);
  }
  const body = (await response.json()) as Partial<ChatResponse> | null;
  return {
    reply: typeof body?.reply === 'string' ? body.reply : '',
    stations: Array.isArray(body?.stations) ? body!.stations! : [],
    serviceLinks: Array.isArray(body?.serviceLinks) ? body!.serviceLinks! : [],
    sources: Array.isArray(body?.sources) ? body!.sources! : [],
    actions: parseActions(body?.actions),
    run: body?.run && typeof body.run.runId === 'string' ? body.run : undefined
  };
};
