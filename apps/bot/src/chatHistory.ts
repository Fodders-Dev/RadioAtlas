import type { AiChatHistoryTurn } from './aiChat.js';

// Per-user rolling conversation memory for the bot's «Лира» chat.
//
// The brain already consumes `history` (it feeds both the planner and the
// composer — apps/api/src/ai/brain.ts), and the Mini App sends it. But the bot
// sent NONE — so every Telegram message read as brand-new, even a reply: «уйти от
// азиатских нот» → «а какое настроение?» (the live goldfish-memory bug). This is
// the missing per-user buffer.
//
// In-memory by design (no DB — mirrors the in-memory aiLimiter): keep the last
// `maxTurns` user/assistant turns per user, drop a user's history after `ttlMs`
// idle, clamp each stored turn, and lazily prune on write so memory stays bounded
// on the shared 512M box. Restart clears it — acceptable for short-lived chat
// context.

export type ChatHistoryStore = {
  get: (userId: string) => AiChatHistoryTurn[];
  record: (userId: string, userText: string, assistantText: string) => void;
};

type Entry = { turns: AiChatHistoryTurn[]; lastSeen: number };

export type ChatHistoryOptions = {
  maxTurns?: number; // total turns kept per user (user+assistant); even → whole exchanges
  ttlMs?: number; // idle expiry — a stale conversation should not bleed into a new one
  maxTextLen?: number; // clamp each stored turn so a long reply can't bloat memory
  maxUsers?: number; // hard cap on tracked users (LRU-evict the least-recent over it)
  now?: () => number;
};

export const createChatHistory = (options: ChatHistoryOptions = {}): ChatHistoryStore => {
  const maxTurns = Math.max(2, options.maxTurns ?? 12);
  const ttlMs = options.ttlMs ?? 30 * 60_000;
  const maxTextLen = options.maxTextLen ?? 700;
  const maxUsers = Math.max(1, options.maxUsers ?? 5000);
  const now = options.now ?? (() => Date.now());
  const store = new Map<string, Entry>();

  const isFresh = (entry: Entry | undefined, at: number): entry is Entry =>
    !!entry && at - entry.lastSeen <= ttlMs;

  const clamp = (text: string): string => {
    const value = String(text || '').trim();
    return value.length > maxTextLen ? value.slice(0, maxTextLen) : value;
  };

  const prune = (at: number): void => {
    for (const [id, entry] of store) {
      if (at - entry.lastSeen > ttlMs) store.delete(id);
    }
    if (store.size > maxUsers) {
      const oldestFirst = [...store.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      const overflow = store.size - maxUsers;
      for (let i = 0; i < overflow; i += 1) store.delete(oldestFirst[i][0]);
    }
  };

  return {
    get(userId) {
      const at = now();
      const entry = store.get(userId);
      if (!isFresh(entry, at)) {
        if (entry) store.delete(userId);
        return [];
      }
      return entry.turns.slice();
    },
    record(userId, userText, assistantText) {
      const at = now();
      const user = clamp(userText);
      const assistant = clamp(assistantText);
      if (!userId || !user || !assistant) return;
      const existing = store.get(userId);
      const entry: Entry = isFresh(existing, at) ? existing : { turns: [], lastSeen: at };
      entry.turns.push({ role: 'user', text: user }, { role: 'assistant', text: assistant });
      if (entry.turns.length > maxTurns) {
        entry.turns.splice(0, entry.turns.length - maxTurns);
      }
      entry.lastSeen = at;
      store.set(userId, entry);
      prune(at);
    }
  };
};
