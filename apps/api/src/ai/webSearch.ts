// P1 — web_search_factual backing client. Tavily ONLY (ported from the
// FoddersGameBot _tavily_search: snippet-first, with a tightly gated cleaned
// raw-content mode for song-text analysis; no direct scrapers or LLM query
// planner). Built on the injected
// fetch + an 8s AbortController, like deepseekClient. The Tavily key lives only
// in the api process (like DEEPSEEK_API_KEY) and never reaches a client bundle.
//
// Guards baked in (the brief's forks): a freshness-aware cache (3 min for
// life/death/news, 1 h otherwise), a score quality floor (drop < 0.5), and a
// MANDATORY daily cap — over the cap we refuse WITHOUT calling fetch.

import type { WebSearchOutcome, WebSearchProvider, WebSource } from './types.js';

const TAVILY_URL = 'https://api.tavily.com/search';
const TIMEOUT_MS = 8000;
const SCORE_THRESHOLD = 0.5;
const FRESH_TTL_MS = 3 * 60 * 1000; // «жив/умер»/news — volatile
const STALE_TTL_MS = 60 * 60 * 1000; // everything else
const MAX_RESULTS = 5;
const MAX_SOURCE_CONTENT_CHARS = 12_000;
const DAY_MS = 86_400_000;

type CacheEntry = { at: number; outcome: WebSearchOutcome };

type RawResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  raw_content?: unknown;
  score?: unknown;
  published_date?: unknown;
};

const toSource = (raw: RawResult, includeContent: boolean): WebSource => ({
  title: String(raw?.title || '').slice(0, 200),
  url: String(raw?.url || ''),
  snippet: String(
    includeContent && typeof raw?.raw_content === 'string' && raw.raw_content.trim()
      ? raw.raw_content
      : raw?.content || ''
  ).slice(0, MAX_SOURCE_CONTENT_CHARS),
  score: typeof raw?.score === 'number' && Number.isFinite(raw.score) ? raw.score : 0,
  publishedDate: typeof raw?.published_date === 'string' ? raw.published_date : undefined
});

export const createTavilyWebSearch = (config: {
  apiKey: string;
  dailyCap: number;
  fetch: typeof fetch;
  now: () => number;
}): WebSearchProvider => {
  const cache = new Map<string, CacheEntry>();
  let day = -1;
  let dayCount = 0;

  const search = async (
    query: string,
    opts: { fresh: boolean; includeContent?: boolean }
  ): Promise<WebSearchOutcome> => {
    const trimmed = String(query || '').trim();
    if (!trimmed || !config.apiKey) return { status: 'empty', sources: [] };

    const includeContent = opts.includeContent === true;
    // A snippet-only cache entry cannot satisfy a later lyrics analysis that
    // explicitly needs the cleaned page text.
    const key = `${includeContent ? 'content' : 'snippet'}:${trimmed.toLowerCase()}`;
    const now = config.now();
    const ttl = opts.fresh ? FRESH_TTL_MS : STALE_TTL_MS;
    const cached = cache.get(key);
    if (cached && now - cached.at < ttl) return cached.outcome;

    // Daily cap — reset on day change, refuse WITHOUT a request when exceeded.
    const today = Math.floor(now / DAY_MS);
    if (today !== day) {
      day = today;
      dayCount = 0;
    }
    if (dayCount >= config.dailyCap) return { status: 'capped', sources: [] };
    dayCount += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await config.fetch(TAVILY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: config.apiKey,
          query: trimmed,
          search_depth: 'basic',
          include_raw_content: includeContent ? 'text' : false,
          include_answer: false,
          max_results: MAX_RESULTS
        }),
        signal: controller.signal
      });
      if (!response.ok) return { status: 'error', sources: [] };
      const body = (await response.json()) as { results?: RawResult[] } | null;
      const sources = (Array.isArray(body?.results) ? body!.results! : [])
        .map((result) => toSource(result, includeContent))
        .filter((source) => source.url && source.score >= SCORE_THRESHOLD)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTS);
      const outcome: WebSearchOutcome = sources.length
        ? { status: 'ok', sources }
        : { status: 'empty', sources: [] };
      // Cache resolved outcomes (ok/empty) only — transient error/cap retry next.
      cache.set(key, { at: now, outcome });
      return outcome;
    } catch {
      return { status: 'error', sources: [] };
    } finally {
      clearTimeout(timer);
    }
  };

  return { search };
};
