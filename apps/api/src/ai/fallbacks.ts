// Warm, in-character fallbacks. EVERY failure mode (AI disabled, DeepSeek
// timeout/error, empty or voice-unsafe text, planner parse failure) routes
// here — never a stack trace, never a sterile "I cannot help with that". If we
// happen to have trending stations on hand, we offer them so the answer is
// never a dead end.

import { cleanText } from './antiHallucination.js';
import type {
  ChatResult,
  ServiceLink,
  Surface,
  VerifiedStationRef,
  WebSource
} from './types.js';

export type FallbackReason =
  | 'disabled'
  | 'compose-error'
  | 'empty'
  | 'voice-unsafe'
  | 'capped';

const WARM_LINES: string[] = [
  'Ой, я на секунду засмотрелась в окно и потеряла нить — скажи ещё разок, под что тебе музыку?',
  'М, у меня сейчас в голове только шум пластинки — давай ещё раз: какое настроение ловим?',
  'Прости, замечталась. Расскажи, чего хочется послушать — спокойного, бодрого, чего-то нового?'
];

const WARM_WITH_STATIONS =
  'Точного ответа у меня сейчас нет, но вот что у меня тепло звучит прямо сейчас — попробуй, вдруг зацепит.';

// Pick a line deterministically from the injected clock (no Math.random — keeps
// the brain pure and reproducible in tests).
const pickLine = (now: number): string =>
  WARM_LINES[Math.abs(now) % WARM_LINES.length] ?? WARM_LINES[0]!;

export const buildFallbackResult = (options: {
  surface: Surface;
  now: number;
  stations?: VerifiedStationRef[];
  serviceLinks?: ServiceLink[];
  sources?: WebSource[];
  reason: FallbackReason;
}): ChatResult => {
  const stations = (options.stations || []).slice(0, 5);
  const text = stations.length ? WARM_WITH_STATIONS : pickLine(options.now);
  return {
    reply: cleanText(text, options.surface),
    stations,
    serviceLinks: options.serviceLinks || [],
    sources: options.sources || [],
    actions: [{ kind: 'none' }]
  };
};
