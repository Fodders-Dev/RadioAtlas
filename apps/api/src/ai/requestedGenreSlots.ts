type Genre = { genre: string; pattern: RegExp };

const GENRES: Genre[] = [
  { genre: 'funk', pattern: /(?<![\p{L}\p{N}])(?:funk|фанк(?:а|е|ом|у|овый|овая|овое|овую|овые|овых|овыми)?)(?![\p{L}\p{N}])/giu },
  { genre: 'ambient', pattern: /(?<![\p{L}\p{N}])(?:ambient|эмбиент(?:а|е|ом|у|ный|ная|ное|ную|ные|ных|ными)?)(?![\p{L}\p{N}])/giu },
  { genre: 'jazz', pattern: /(?<![\p{L}\p{N}])(?:jazz|джаз(?:а|е|ом|у|овый|овая|овое|овую|овые|овых|овыми)?)(?![\p{L}\p{N}])/giu },
  { genre: 'rock', pattern: /(?<![\p{L}\p{N}])(?:rock|рок(?:а|е|ом|у|овый|овая|овое|овую|овые|овых|овыми)?)(?![\p{L}\p{N}])/giu },
  { genre: 'soul', pattern: /(?<![\p{L}\p{N}])(?:soul|соул(?:а|е|ом|у)?)(?![\p{L}\p{N}])/giu },
  { genre: 'blues', pattern: /(?<![\p{L}\p{N}])(?:blues|блюз(?:а|е|ом|у)?)(?![\p{L}\p{N}])/giu },
  { genre: 'pop', pattern: /(?<![\p{L}\p{N}])(?:pop|поп(?:а|е|ом|у)?)(?![\p{L}\p{N}])/giu },
  { genre: 'electronic', pattern: /(?<![\p{L}\p{N}])(?:electronic(?:\s+music)?|электронн(?:ая|ую|ой|ое|ые|ых|ым)?(?:\s+музык[а-яё]*)?|электроник(?:а|и|у|ой|е)?)(?![\p{L}\p{N}])/giu },
  { genre: 'house', pattern: /(?<![\p{L}\p{N}])(?:house|хаус(?:а|е|ом|у)?)(?![\p{L}\p{N}])/giu },
  { genre: 'techno', pattern: /(?<![\p{L}\p{N}])(?:techno|техно)(?![\p{L}\p{N}])/giu },
  { genre: 'classical', pattern: /(?<![\p{L}\p{N}])(?:classical|классик(?:а|и|у|ой|е|ую|ие|их)?|классическ(?:ая|ую|ое|ой|ие|их|им|ими)?)(?:\s+музык[а-яё]*)?(?![\p{L}\p{N}])/giu },
  { genre: 'reggae', pattern: /(?<![\p{L}\p{N}])(?:reggae|регги)(?![\p{L}\p{N}])/giu }
];

const COUNT_PATTERN = /(?<![\p{L}\p{N}])(?:(the\s+other|another|другую|другая|другой|другое|one|two|three|four|five|один|одна|одно|одну|два|две|три|четыре|пять|\d+))(?![\p{L}\p{N}])/giu;
const CONNECTORS = new Set([
  'с', 'со', 'станция', 'станции', 'станцию', 'станций', 'станцией', 'станциями', 'станциям', 'станц',
  'радио', 'радиостанция', 'радиостанции', 'радиостанцию', 'эфир', 'эфира', 'канал', 'каналы',
  'station', 'stations', 'radio', 'with', 'of', 'for', 'music', 'genre', 'genres', 'the', 'a', 'an'
]);
const FILLER = new Set([
  'подбери', 'найди', 'покажи', 'посоветуй', 'порекомендуй', 'включи', 'включите', 'поставь', 'поставьте', 'мне', 'пожалуйста', 'станция', 'станции', 'станцию', 'станций',
  'радио', 'эфир', 'эфира', 'две', 'два', 'одну', 'один', 'одна', 'одно', 'и', 'а', 'с', 'со', 'для', 'по', 'в', 'из',
  'give', 'me', 'find', 'recommend', 'show', 'play', 'please', 'some', 'stations', 'station', 'radio', 'one', 'two', 'and', 'for', 'with', 'a', 'an'
]);

type Match = { genre: string; start: number; end: number };
type CountMatch = { word: string; start: number; end: number; count: number };

const genreMatches = (text: string): Match[] => GENRES.flatMap(({ genre, pattern }) =>
  [...text.matchAll(pattern)].flatMap((match) => {
    const start = match.index;
    const value = match[0];
    return start === undefined ? [] : [{ genre, start, end: start + value.length }];
  })
).sort((a, b) => a.start - b.start);

const countValue = (word: string): number => {
  const value = word.toLocaleLowerCase('en');
  if (['one', 'another', 'the other', 'один', 'одна', 'одно', 'одну', 'другую', 'другая', 'другой', 'другое'].includes(value)) return 1;
  if (['two', 'два', 'две'].includes(value)) return 2;
  if (['three', 'три'].includes(value)) return 3;
  if (['four', 'четыре'].includes(value)) return 4;
  if (['five', 'пять'].includes(value)) return 5;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 && numeric <= 99 ? numeric : 0;
};

const isSimpleGap = (gap: string): boolean => {
  const words = gap.toLocaleLowerCase('ru').replace(/[—–:()]/g, ' ').match(/[\p{L}]+/gu) || [];
  return words.every((word) => CONNECTORS.has(word));
};

const stripAllowedNoPlayAndNoWrite = (text: string): string => text
  .replace(/(?<!\p{L})не\s+(?:добавляй|добавляйте|добавить|сохраняй|сохраняйте|сохранить|записывай)(?:\s+(?:эту|эти|станцию|станции|её|ее|их|это))*\s+(?:в|к)\s+(?:очередь|избранное)(?=$|[^\p{L}])/giu, ' ')
  .replace(/(?<![\p{L}\p{N}])(?:do\s+not|don['’]t)\s+(?:add|save)(?:\s+(?:these|this|stations?|them|it)){0,2}\s+(?:to|in)\s+(?:the\s+)?(?:queue|favorites?|favourites?)(?=$|[^\p{L}\p{N}])/giu, ' ')
  .replace(/(?<!\p{L})не\s+(?:включай|включайте|включить|добавляй|добавляйте|добавить|записывай|сохраняй)(?=$|[^\p{L}])/giu, ' ')
  .replace(/(?<![\p{L}\p{N}])(?:do\s+not|don['’]t)\s+(?:play|add|save|write)(?=$|[^\p{L}\p{N}])/giu, ' ');

const unsupportedRequest = (text: string): boolean =>
  /\b(?:песн[а-яё]*|трек[а-яё]*|альбом[а-яё]*|композици[а-яё]*|song[s]?|track[s]?|album[s]?|record[s]?)\b/iu.test(text) ||
  /\b(?:минут[а-яё]*|час[а-яё]*|день|дня|дней|год[а-яё]*|duration|minute[s]?|hour[s]?|day[s]?|year[s]?)\b/iu.test(text) ||
  /\b\d{2,}(?:[./-]\d{1,4})*\b|\b\d{1,2}(?:st|nd|rd|th)\b/iu.test(text) ||
  /\b(?:перв(?:ый|ая|ое|ую|ом|ого)|втор(?:ой|ая|ое|ую|ом|ого)|трет(?:ий|ья|ье|ью|ьем)|first|second|third|fourth|fifth)\b/iu.test(text) ||
  /\b(?:лучше|хуже|чем|сравни|сравнение|versus|vs\.?|compared\s+to|better\s+than|worse\s+than)\b/iu.test(text) ||
  /\b(?:не\s+(?:ищи|подбирай|рекомендуй|советуй)|не\s+надо\s+(?:искать|подбирать|рекомендовать)|не\s+ищу|без\s+рекомендаций|don't\s+(?:find|recommend|pick)|do\s+not\s+(?:find|recommend|pick)|no\s+recommendations)\b/iu.test(text) ||
  /\b(?:есть|является|составляет|включает|содержит|доступен|доступны|available|currently|means|includes|contains)\b/iu.test(text);

/**
 * Parses only two directly counted, distinct music genres. Any other semantic
 * words must belong to this small request grammar. Country constraints are
 * intentionally left to the caller's existing country-aware fallback path.
 */
export const requestedGenreSlots = (message: string): { genre: string; count: number }[] | undefined => {
  const text = message.normalize('NFKC').toLocaleLowerCase('ru');
  const noPlayStripped = stripAllowedNoPlayAndNoWrite(text);
  if (unsupportedRequest(noPlayStripped)) return undefined;

  const genres = genreMatches(noPlayStripped);
  if (genres.length !== 2 || genres[0]?.genre === genres[1]?.genre) return undefined;
  const counts: CountMatch[] = [...noPlayStripped.matchAll(COUNT_PATTERN)].flatMap((match) => {
    const word = match[1];
    const start = match.index;
    if (!word || start === undefined) return [];
    return [{ word, start, end: start + match[0].length, count: countValue(word) }];
  });

  const slots: Array<{ genre: string; count: number; start: number; end: number }> = [];
  const matchedGenreRanges = new Set<string>();
  for (let index = 0; index < counts.length; index++) {
    const count = counts[index]!;
    const nextCount = counts[index + 1]?.start ?? noPlayStripped.length;
    const sentenceEnd = noPlayStripped.slice(count.end).search(/[.!?;\n]/u);
    const end = Math.min(nextCount, sentenceEnd < 0 ? noPlayStripped.length : count.end + sentenceEnd);
    const candidates = genres.filter((genre) => genre.start >= count.end && genre.end <= end);
    if (candidates.length !== 1) continue;
    const genre = candidates[0]!;
    if (!isSimpleGap(noPlayStripped.slice(count.end, genre.start))) continue;
    slots.push({ genre: genre.genre, count: count.count, start: count.start, end: genre.end });
    matchedGenreRanges.add(`${genre.start}:${genre.end}`);
  }

  if (slots.length !== 2 || matchedGenreRanges.size !== genres.length) return undefined;
  if (slots.some((slot) => slot.count < 1 || slot.count > 2) || slots.reduce((sum, slot) => sum + slot.count, 0) > 4) return undefined;
  if (new Set(slots.map((slot) => slot.genre)).size !== 2) return undefined;

  let remainder = noPlayStripped;
  for (const slot of [...slots].sort((a, b) => b.start - a.start)) {
    remainder = `${remainder.slice(0, slot.start)} ${remainder.slice(slot.end)}`;
  }
  const tokens = remainder.match(/[\p{L}\p{N}]+/gu) || [];
  if (tokens.some((token) => !FILLER.has(token))) return undefined;

  // If an unassigned count introduces a station total, require it to equal the
  // described slots. Otherwise returning only the two parsed slots would drop
  // part of the user's request or contradict its count.
  const slotStarts = new Set(slots.map((slot) => slot.start));
  const requestedTotal = counts.find((count) => !slotStarts.has(count.start) &&
    /^\s*[:,–—-]?\s*(?:станц[а-яё]*|stations?\b)/iu.test(noPlayStripped.slice(count.end, count.end + 28)));
  const slotTotal = slots.reduce((sum, slot) => sum + slot.count, 0);
  if (requestedTotal && requestedTotal.count !== slotTotal) return undefined;
  return slots.map(({ genre, count }) => ({ genre, count }));
};
