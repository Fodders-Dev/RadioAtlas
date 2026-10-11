// Grounding + voice guards. Two jobs:
//  1. The ONLY stations that become cards/buttons are the ones a tool actually
//     returned (collectVerifiedStations) — a station the model merely names in
//     prose never produces a button. This is the anti-hallucination backstop.
//  2. The reply must sound like «Лира» — no unsolicited bot/AI disclosure,
//     no bar/bartender metaphor, and no tech-speak ("база/каталог/выдача"). A
//     direct identity question may get an honest answer; other violations
//     reject the text so the caller swaps a warm fallback.

import type { ToolObservation, VerifiedStationRef, WebSource } from './types.js';

const MAX_STATION_CARDS = 5;
const MAX_SOURCE_CITATIONS = 2;
const MAX_REPLY_CHARS = 3500;

// Collect every station a tool surfaced, de-duped by uuid, capped. Order is
// preserved (first observation wins) so the most relevant tool result leads.
const normalizedStationNameKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/(?:^|\s)[[(]?(?:hd|hq|opus|aac|mp3|ogg|flac|128k|192k|256k|320k)[)\]]?(?=\s|$)/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const collectVerifiedStations = (
  observations: ToolObservation[]
): VerifiedStationRef[] => {
  const seen = new Set<string>();
  const seenNames = new Set<string>();
  const out: VerifiedStationRef[] = [];
  for (const observation of observations) {
    for (const station of observation.stations || []) {
      if (!station || !station.stationuuid || seen.has(station.stationuuid)) continue;
      // Only stations with a resolvable stream become playable cards.
      if (!station.url_resolved) continue;
      const nameKey = normalizedStationNameKey(station.name || '');
      if (nameKey && seenNames.has(nameKey)) continue;
      seen.add(station.stationuuid);
      if (nameKey) seenNames.add(nameKey);
      out.push(station);
      if (out.length >= MAX_STATION_CARDS) return out;
    }
  }
  return out;
};

// Collect every web source a tool surfaced, de-duped by url, capped. Citation
// buttons are ONLY ever built from these (same anti-hallucination rule as
// stations — a URL the model merely names in prose never becomes a button).
export const collectVerifiedSources = (observations: ToolObservation[]): WebSource[] => {
  const seen = new Set<string>();
  const out: WebSource[] = [];
  for (const observation of observations) {
    for (const source of observation.sources || []) {
      if (!source || !source.url || seen.has(source.url)) continue;
      seen.add(source.url);
      out.push(source);
      if (out.length >= MAX_SOURCE_CITATIONS) return out;
    }
  }
  return out;
};

// Identity disclosure is rejected unless the current user directly asks who
// Lira is. This does not relax the unrelated persona and product guards below.
const IDENTITY_VIOLATIONS: RegExp[] = [
  /я\s*[—-]?\s*(?:бот|ии|ассистент|нейросет|искусственн|программа|алгоритм)/i,
  // noun forms: «являюсь ботом / нейросетью / моделью» (Cyrillic class — \w is
  // ASCII-only and would not consume «юсь»)
  /явля[а-яё]*\s+(?:ботом|ассистентом|нейросет[а-яё]*|программой|моделью)/i,
  /языков(?:ая|ой|ую)\s+модел/i
];

const PERSONA_VIOLATIONS: RegExp[] = [
  /бармен/i,
  // «налью / налей / наливаю…» but NOT «песня наливается силой»
  /налива(?:ю|ешь|ем)|налью|налей/i,
  /за\s+стойк/i,
  // tech-speak «каталог станций/радио/выдачи» but NOT «каталог Blue Note»
  /каталог(?:\s+(?:станц|радио|выдач))/i,
  /выдач/i,
  /баз[аеуы]\s+данных/i
];

// Keep this classifier intentionally narrow and based on the current USER
// message only. History or an assistant's earlier offer does not authorize an
// unsolicited identity disclosure.
export const isDirectIdentityQuestion = (text: string): boolean => {
  const hasQuestionMark = /[?？]/u.test(String(text || ''));
  const value = String(text || '').trim().replace(/[!?.,…]+$/u, '').trim().toLocaleLowerCase();
  if (/^(?:(?:скажи|подскажи|слушай)[, ]+)?(?:а\s+)?(?:кто\s+ты|ты\s+кто)$/iu.test(value)) return true;
  const identityQuestion = /^(?:(?:скажи|подскажи|слушай)[, ]+)?(?:а\s+)?ты\s+(?:бот|ии|ассистент|нейросеть|человек|настоящ(?:ий|ая)\s+человек|жив(?:ой|ая))(?:\s+или\s+(?:бот|ии|ассистент|нейросеть|человек))?$/iu.test(value);
  return identityQuestion && (hasQuestionMark || /\s+или\s+/iu.test(value));
};

export const isVoiceSafe = (text: string, options: {allowIdentityDisclosure?: boolean} = {}): boolean => {
  const value = String(text || '');
  return (options.allowIdentityDisclosure || !IDENTITY_VIOLATIONS.some(pattern => pattern.test(value))) &&
    !PERSONA_VIOLATIONS.some((pattern) => pattern.test(value));
};

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Cut to a soft length on a sentence/word boundary so we never end mid-word.
const truncateOnBoundary = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSentence = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? '),
    slice.lastIndexOf('\n')
  );
  if (lastSentence > max * 0.6) return slice.slice(0, lastSentence + 1).trim();
  const lastSpace = slice.lastIndexOf(' ');
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim() + '…';
};

// Лира opens ~2/3 of replies with a reflexive interjection («О,»/«Ой,»/«Ого,»…).
// persona.ts forbids it but the model ignores that, so strip a SINGLE leading
// interjection token + its trailing punctuation deterministically, then
// re-capitalize the new first letter. The bare «О» branch requires real
// punctuation (,/!/…) so we never eat the preposition «о» in «о чём ты»; the
// multi-letter interjections are unambiguous and may be followed by a space too.
// The next char after the token must be a separator, so «Эхо»/«Охапка» are safe.
const LEADING_INTERJECTION = /^\s*(?:(?:ой|ого|ох|ага|эх)[\s,!…—–-]+|о[,!…]+[\s—–-]*)/i;

const stripLeadingInterjection = (text: string): string => {
  const stripped = text.replace(LEADING_INTERJECTION, '');
  // Only act if we actually removed an opener, and never blank a one-word
  // reaction («Ого!» → '' would be worse than keeping it).
  if (!stripped || stripped === text) return text;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
};

// Strip markdown that the persona is told not to use but a model might still
// emit. Telegram gets light HTML (escaped, then bold/code re-applied); the Mini
// App gets plain unicode text.
export const cleanText = (
  raw: string,
  surface: 'miniapp' | 'telegram'
): string => {
  let text = String(raw || '').replace(/\r\n/g, '\n').trim();
  // Drop markdown headers and list bullets that read awkwardly as chat.
  text = text.replace(/^#{1,6}\s+/gm, '');
  // Collapse markdown links [label](url) → label (we never want raw URLs in
  // prose; stations/services are buttons).
  text = text.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1');
  // Tame runaway blank lines.
  text = text.replace(/\n{3,}/g, '\n\n');
  // Drop the reflexive «О,/Ой,/Ого,…» opener tic (deterministic; persona alone
  // doesn't stop it).
  text = stripLeadingInterjection(text);

  // Truncate the PLAIN text BEFORE applying HTML/markdown conversion. If we cut
  // after building <b>/<code>, a boundary inside a span produces an unbalanced
  // tag → Telegram rejects the message with a 400. Cutting the plain markdown
  // first means an interrupted **…/`… simply never matches the span regex and
  // stays as literal text — the emitted HTML is always balanced.
  text = truncateOnBoundary(text.trim(), MAX_REPLY_CHARS);

  if (surface === 'telegram') {
    text = escapeHtml(text);
    text = text.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  } else {
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/`([^`]+)`/g, '$1');
  }

  return text.trim();
};
