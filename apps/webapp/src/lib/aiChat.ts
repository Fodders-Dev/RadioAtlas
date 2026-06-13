// Mini App → /ai/chat client. Sends the session Bearer (when signed in; the
// route also accepts anonymous) and the in-memory history. The DeepSeek key
// never reaches the client — this only talks to our own API.

import { getApiBase } from './apiBase';

const SESSION_STORAGE_KEY = 'radio:session:v1';

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

export type ChatActionRef = {
  kind: 'play' | 'open-station' | 'none';
  stationuuid?: string;
};

export type ChatResponse = {
  reply: string;
  stations: ChatStationRef[];
  serviceLinks: ChatServiceLink[];
  actions: ChatActionRef[];
};

export type ChatHistoryTurn = { role: ChatRole; text: string };

const readToken = (): string => {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) || '';
  } catch {
    return '';
  }
};

export const isAiAssistantEnabled = (): boolean =>
  String(import.meta.env.VITE_AI_ENABLED || '') === '1';

export const postChatMessage = async (
  message: string,
  history: ChatHistoryTurn[]
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
    body: JSON.stringify({ message, history })
  });
  if (!response.ok) {
    throw new Error(`chat failed (${response.status})`);
  }
  const body = (await response.json()) as Partial<ChatResponse> | null;
  return {
    reply: typeof body?.reply === 'string' ? body.reply : '',
    stations: Array.isArray(body?.stations) ? body!.stations! : [],
    serviceLinks: Array.isArray(body?.serviceLinks) ? body!.serviceLinks! : [],
    actions: Array.isArray(body?.actions) ? body!.actions! : []
  };
};
