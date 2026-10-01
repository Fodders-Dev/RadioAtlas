const NUMBER_VALUES: ReadonlyArray<readonly [number, RegExp]> = [
  [1, /^(?:1|one|один|одна|одно|одну|одного|одной|одном|одному|одним|одною)$/iu],
  [2, /^(?:2|two|два|две|двух|двум|двумя)$/iu],
  [3, /^(?:3|three|три|трёх|трех|трём|трем|тремя)$/iu],
  [4, /^(?:4|four|четыре|четырёх|четырех|четырём|четырем|четырьмя)$/iu],
  [5, /^(?:5|five|пять|пяти|пятью)$/iu]
];

const NUMBER_TOKEN = /(?:^|[^\p{L}\p{N}])((?:\d+|one|two|three|four|five|один|одна|одно|одну|одного|одной|одном|одному|одним|одною|два|две|двух|двум|двумя|три|трёх|трех|трём|трем|тремя|четыре|четырёх|четырех|четырём|четырем|четырьмя|пять|пяти|пятью))(?![\p{L}\p{N}])/giu;
const RECOMMENDATION_UNIT = /^(?:станци\p{L}*|station\p{L}*|радио|radio\p{L}*|эфир\p{L}*|вариант\p{L}*|option\p{L}*|recommendation\p{L}*|pick\p{L}*)$/iu;
const REQUEST_VERB = /^(?:дай|дайте|предложи|предложите|подбери|подберите|порекомендуй|порекомендуйте|рекомендуй|recommend|suggest|give|show|find)$/iu;
const EXCLUSIVE = /^(?:только|лишь|одну|один|одна|одно|one|just|only)$/iu;
const NON_COUNT_CONTEXT = /^(?:на|в|за|через|до|после|около|for|in|after|before|час\p{L}*|минут\p{L}*|день|дня|дней|месяц\p{L}*|год\p{L}*|hour\p{L}*|minute\p{L}*|day\p{L}*|month\p{L}*|year\p{L}*|мая|июня|июля|августа|сентября|октября|ноября|декабря|января|февраля|марта|апреля)$/iu;
const OTHER_MEDIA_UNIT = /^(?:трек\p{L}*|песн\p{L}*|альбом\p{L}*|композици\p{L}*|track\p{L}*|song\p{L}*|album\p{L}*|playlist\p{L}*)$/iu;
const DURATION_UNIT = /^(?:час\p{L}*|минут\p{L}*|день|дня|дней|месяц\p{L}*|год\p{L}*|hour\p{L}*|minute\p{L}*|day\p{L}*|month\p{L}*|year\p{L}*)$/iu;

function numberValue(token: string): number | undefined {
  if (/^\d+$/u.test(token)) {
    const numeric = Number(token);
    return Number.isSafeInteger(numeric) && numeric > 0 ? Math.min(5, numeric) : undefined;
  }
  return NUMBER_VALUES.find(([, pattern]) => pattern.test(token))?.[0];
}

function wordsBetween(text: string, left: number, right: number): string[] {
  return text.slice(left, right).match(/[\p{L}\p{N}]+/gu) ?? [];
}

function clauseBounds(message: string, index: number): { start: number; end: number } {
  const separators = ['.', ';', '!', '?', '\n'];
  const start = Math.max(...separators.map((separator) => message.lastIndexOf(separator, index))) + 1;
  const ends = separators.map((separator) => message.indexOf(separator, index)).filter((end) => end >= 0);
  return { start, end: ends.length ? Math.min(...ends) : message.length };
}

function hasOrdinalSuffix(text: string, end: number): boolean {
  return /^\s*[-‐‑]?(?:й|я|ю|е|ый|ая|ое)(?!\p{L})/iu.test(text.slice(end));
}

function sentenceWords(message: string, index: number): string[] {
  const { start, end } = clauseBounds(message, index);
  return wordsBetween(message, start, end);
}

/**
 * Return an explicitly requested number of recommended stations (capped at
 * five), or undefined when the message does not make a clear quantity request.
 * The caller should retain its normal recommendation limit when this is
 * undefined.
 */
export function requestedStationCount(message: string): number | undefined {
  const matches: Array<{ value: number; start: number; end: number }> = [];
  for (const match of message.matchAll(NUMBER_TOKEN)) {
    const raw = match[1];
    if (!raw) continue;
    const value = numberValue(raw);
    if (value === undefined) continue;
    const start = (match.index ?? 0) + match[0].indexOf(raw);
    if (hasOrdinalSuffix(message, start + raw.length)) continue;
    matches.push({ value, start, end: start + raw.length });
  }

  const requestedCounts: Array<{ value: number; start: number }> = [];

  // A cardinal immediately attached to a station/recommendation unit is the
  // clearest signal. A two-word gap admits natural phrasing such as “two great
  // stations” without matching distant dates, times, or unrelated quantities.
  for (const quantity of matches) {
    const bounds = clauseBounds(message, quantity.start);
    const after = wordsBetween(message, quantity.end, Math.min(bounds.end, quantity.end + 48));
    const unitIndex = after.findIndex((word) => RECOMMENDATION_UNIT.test(word));
    const unitGap = unitIndex < 0 ? [] : after.slice(0, unitIndex);
    if (unitIndex >= 0 && unitIndex <= 2 && !unitGap.some((word) => NON_COUNT_CONTEXT.test(word) || OTHER_MEDIA_UNIT.test(word))) {
      requestedCounts.push({ value: quantity.value, start: quantity.start });
      continue;
    }
    const before = wordsBetween(message, Math.max(bounds.start, quantity.start - 48), quantity.start);
    if (before.length <= 2 && !before.some((word) => NON_COUNT_CONTEXT.test(word) || OTHER_MEDIA_UNIT.test(word)) && before.some((word) => RECOMMENDATION_UNIT.test(word))) {
      requestedCounts.push({ value: quantity.value, start: quantity.start });
    }
  }

  // Explicit recommendation verbs allow elliptical requests such as “give me
  // one”. The clause must not name another media type; “дай одну на три часа”
  // remains a one-station request, while “дай два трека” does not.
  for (const quantity of matches) {
    const bounds = clauseBounds(message, quantity.start);
    const before = wordsBetween(message, Math.max(bounds.start, quantity.start - 48), quantity.start);
    const after = wordsBetween(message, quantity.end, Math.min(bounds.end, quantity.end + 48));
    const durationRequest = after[0] === 'на' && after.length >= 3 && numberValue(after[1] ?? '') !== undefined && DURATION_UNIT.test(after[2] ?? '');
    const clause = sentenceWords(message, quantity.start);
    if (
      before.length <= 3 &&
      !before.some((word) => NON_COUNT_CONTEXT.test(word)) &&
      (durationRequest || !NON_COUNT_CONTEXT.test(after[0] ?? '')) &&
      !clause.some((word) => OTHER_MEDIA_UNIT.test(word)) &&
      before.some((word) => REQUEST_VERB.test(word))
    ) requestedCounts.push({ value: quantity.value, start: quantity.start });
  }

  // A short elliptical “only one” request can imply one recommendation. Keep
  // this to a short sentence and reject explicit songs, tracks, albums, or time.
  for (const quantity of matches) {
    const bounds = clauseBounds(message, quantity.start);
    const before = wordsBetween(message, Math.max(bounds.start, quantity.start - 24), quantity.start);
    const sentence = sentenceWords(message, quantity.start);
    if (
      sentence.length <= 4 &&
      !sentence.some((word) => OTHER_MEDIA_UNIT.test(word) || DURATION_UNIT.test(word)) &&
      before.some((word) => EXCLUSIVE.test(word))
    ) requestedCounts.push({ value: quantity.value, start: quantity.start });
  }

  requestedCounts.sort((left, right) => left.start - right.start);
  return requestedCounts.at(-1)?.value;
}
