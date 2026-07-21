import type { WebSource } from './types.js';

// Web snippets can now contain cleaned lyrics-page content used privately by
// the composer. The browser and Telegram surfaces need attribution only, so the
// egress shape is intentionally allow-listed instead of spreading WebSource.
export const publicWebSources = (sources: WebSource[]) =>
  sources.map(({ title, url, publishedDate }) => ({
    title,
    url,
    ...(publishedDate ? { publishedDate } : {})
  }));
