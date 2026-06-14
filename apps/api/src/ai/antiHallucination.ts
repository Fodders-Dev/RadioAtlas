// Grounding + voice guards. Two jobs:
//  1. The ONLY stations that become cards/buttons are the ones a tool actually
//     returned (collectVerifiedStations) — a station the model merely names in
//     prose never produces a button. This is the anti-hallucination backstop.
//  2. The reply must sound like «Лира» — never disclose bot/AI, never the
//     bar/bartender metaphor, never tech-speak ("база/каталог/выдача"). A
//     violation rejects the text so the caller swaps a warm fallback.

import type { ToolObservation, VerifiedStationRef } from './types.js';

const MAX_STATION_CARDS = 5;
const MAX_REPLY_CHARS = 3500;

// Collect every station a tool surfaced, de-duped by uuid, capped. Order is
// preserved (first observation wins) so the most relevant tool result leads.
export const collectVerifiedStations = (
  observations: ToolObservation[]
): VerifiedStationRef[] => {
  const seen = new Set<string>();
  const out: VerifiedStationRef[] = [];
  for (const observation of observations) {
    for (const station of observation.stations || []) {
      if (!station || !station.stationuuid || seen.has(station.stationuuid)) continue;
      // Only stations with a resolvable stream become playable cards.
      if (!station.url_resolved) continue;
      seen.add(station.stationuuid);
      out.push(station);
      if (out.length >= MAX_STATION_CARDS) return out;
    }
  }
  return out;
};

// Persona violations → reject (caller uses a warm deterministic fallback,
// NEVER a sterile/error reply). Kept targeted to avoid false-flagging ordinary
// music talk.
// NOTE: JS \b / \w are ASCII-only and do NOT mark Cyrillic word boundaries, so
// these match plain (case-insensitive) stems instead. Kept targeted so ordinary
// music talk is not false-flagged.
const VOICE_VIOLATIONS: RegExp[] = [
  /я\s*[—-]?\s*(?:бот|ии|ассистент|нейросет|искусственн|программа|алгоритм)/i,
  // noun forms: «являюсь ботом / нейросетью / моделью» (Cyrillic class — \w is
  // ASCII-only and would not consume «юсь»)
  /явля[а-яё]*\s+(?:ботом|ассистентом|нейросет[а-яё]*|программой|моделью)/i,
  /языков(?:ая|ой|ую)\s+модел/i,
  /бармен/i,
  // «налью / налей / наливаю…» but NOT «песня наливается силой»
  /налива(?:ю|ешь|ем)|налью|налей/i,
  /за\s+стойк/i,
  // tech-speak «каталог станций/радио/выдачи» but NOT «каталог Blue Note»
  /каталог(?:\s+(?:станц|радио|выдач))/i,
  /выдач/i,
  /баз[аеуы]\s+данных/i
];

export const isVoiceSafe = (text: string): boolean => {
  const value = String(text || '');
  return !VOICE_VIOLATIONS.some((pattern) => pattern.test(value));
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
