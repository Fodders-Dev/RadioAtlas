export type RequestedSourceAlternatives =
  | { kind: 'near'; count: 1 | 2 | 3; foreign: boolean }
  | { kind: 'clarify' };

const REQUEST_VERB = /(?<!\p{L})(?:найди|подбери|покажи|посоветуй|порекомендуй|дай|включи|включите|поставь|поставьте|find|get|recommend|show|give|play|start)(?!\p{L})/iu;
const RELATIVE = /(?<!\p{L})(?:похож(?:ее|ую|ая|ие|их|ую)|similar|в\s+том\s+же\s+духе|same\s+spirit|like\s+this)(?!\p{L})/iu;
const CURRENT_TARGET = /(?<!\p{L})(?:эту\s+станци\p{L}*|текущую\s+станци\p{L}*|этой\s+станци\p{L}*|неё|нее|нею|ней|this(?:\s+station)?|the\s+current\s+station|it)(?!\p{L})/iu;
const FOREIGN = /(?<!\p{L})(?:из\s+друг(?:ой|ую|ая|ие|их)\s+стран\p{L}*|from\s+(?:another|a\s+different|different)\s+country)(?!\p{L})/iu;
const COUNT = /(?<![\p{L}\p{N}])(?:(the\s+other|another|одну|один|одна|одно|другую|другая|другой|другое|one|two|three|четыре|пять|три|два|две|four|five|\d+))(?![\p{L}\p{N}])/giu;
const COUNT_VALUES: Record<string, number> = {
  one: 1, another: 1, 'the other': 1, одну: 1, один: 1, одна: 1, одно: 1, другую: 1, другая: 1, другой: 1, другое: 1,
  two: 2, два: 2, две: 2, three: 3, три: 3, four: 4, четыре: 4, five: 5, пять: 5
};
const ALLOWED_WORDS = new Set([
  'найди', 'подбери', 'покажи', 'посоветуй', 'порекомендуй', 'дай', 'включи', 'включите', 'поставь', 'поставьте',
  'find', 'get', 'recommend', 'show', 'give', 'play', 'start', 'please', 'пожалуйста', 'мне',
  'похожее', 'похожую', 'похожая', 'похожие', 'похожих', 'similar', 'like', 'same', 'spirit', 'в', 'том', 'же', 'духе',
  'на', 'to', 'эту', 'этой', 'текущую', 'неё', 'нее', 'нею', 'ней', 'станцию', 'станции', 'станция', 'станций', 'станциями', 'станцией', 'this', 'station', 'stations', 'the', 'current', 'it',
  'но', 'другое', 'другую', 'другой', 'другая', 'but', 'different', 'other', 'another', 'country', 'страну', 'страны', 'страна', 'стран',
  'радио', 'эфир', 'эфира', 'радиостанцию', 'радиостанции', 'one', 'two', 'three', 'одну', 'один', 'одна', 'одно', 'два', 'две', 'три', 'и', 'а', 'some', 'a', 'an'
]);

const wordTokens = (value: string): string[] => value.match(/[\p{L}\p{N}]+/gu) || [];

const quotedText = (text: string): boolean => /"[^"]*"|(?<!\p{L})'[^']*'(?!\p{L})|«[^»]*»|“[^”]*”|‘[^’]*’/u.test(text);
const maskQuotedText = (text: string): string => text.replace(/"[^"]*"|(?<!\p{L})'[^']*'(?!\p{L})|«[^»]*»|“[^”]*”|‘[^’]*’/gu, ' ');

const stripSafeClauses = (text: string): string => text
  .replace(/(?<!\p{L})не\s+(?:включай|включайте|запускай|запускайте|проигрывай|играй)(?:\s+(?:эту|станцию|это|её|ее|пока|сейчас|автоматически))?(?!\p{L})/giu, ' ')
  .replace(/(?<![\p{L}\p{N}])(?:do\s+not|don['’]t)\s+(?:play|start|autoplay)(?:\s+(?:it|yet|now|automatically))?(?![\p{L}\p{N}])/giu, ' ')
  .replace(/(?<!\p{L})не\s+(?:добавляй|добавляйте|сохраняй|сохраняйте)(?:\s+(?:эту|станцию|это|её|ее|их))?\s+(?:в|к)\s+(?:очередь|избранное)(?!\p{L})/giu, ' ')
  .replace(/(?<![\p{L}\p{N}])(?:do\s+not|don['’]t)\s+(?:add|save)(?:\s+(?:this|these|station|stations|it|them))?\s+(?:to|in)\s+(?:the\s+)?(?:queue|favorites?|favourites?)(?![\p{L}\p{N}])/giu, ' ');

const isHardRefusal = (text: string): boolean =>
  /(?<!\p{L})(?:почему|зачем|что\s+(?:означает|значит)|объясни|расскажи|why|what\s+(?:does|is)|tell\s+me\s+about|compare|сравни|сравнение)(?!\p{L})/iu.test(text) ||
  /(?<!\p{L})не\s+(?:ищи|подбирай|показывай|рекомендуй|советуй)|(?<![\p{L}\p{N}])(?:do\s+not|don['’]t)\s+(?:find|search|look|recommend|pick)(?!\p{L})/iu.test(text) ||
  /(?<!\p{L})(?:мне\s+кажется|кажется|seems?|is|are|was|were)(?!\p{L})/iu.test(text) ||
  /(?<!\p{L})(?:песн\p{L}*|трек\p{L}*|альбом\p{L}*|композици\p{L}*|song\p{L}*|track\p{L}*|album\p{L}*|music)(?!\p{L})/iu.test(text);

const standaloneRelative = (text: string): boolean => {
  const value = text.replace(/[.!?;,:]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  return /^(?:похожее(?:\s+но\s+другое)?(?:\s+на\s+(?:неё|нее|нею|ней|эту\s+станци\p{L}*|текущую\s+станци\p{L}*))?|в том же духе|similar to this(?:\s+station)?|like this(?: but different)?)$/iu.test(value);
};

const hasExplicitExternalAnchor = (text: string): boolean => {
  const relation = /(?:похож(?:ее|ую|ая|ие|их|ую)?\s+на|similar\s+to)\s+([^.!?,;]+)/iu.exec(text);
  if (relation?.[1]) {
    const targetWord = wordTokens(relation[1])[0]?.toLocaleLowerCase('ru');
    const modifierOrNumber = targetWord && (/^\d+$/u.test(targetWord) || ['спокойнее', 'контрастнее', 'энергичнее', 'более', 'calmer', 'quieter', 'more'].includes(targetWord));
    const currentTarget = targetWord && (
      ['эту', 'этой', 'текущую', 'неё', 'нее', 'нею', 'ней', 'this', 'it'].includes(targetWord) ||
      (targetWord === 'the' && /^the\s+current\s+station(?!\p{L})/iu.test(relation[1].trim()))
    );
    if (targetWord && !modifierOrNumber && !currentTarget) return true;
  }
  const quotedExternal = /(?:похож\p{L}*\s+на|similar\s+to)\s+["'«“‘]([^"'»”’]+)["'»”’]/iu.exec(text);
  if (quotedExternal?.[1] && !CURRENT_TARGET.test(quotedExternal[1])) return true;
  return false;
};

const countMatches = (text: string): Array<{ word: string; value: number; start: number; end: number }> =>
  [...text.matchAll(COUNT)].flatMap((match) => {
    const word = match[1]?.toLocaleLowerCase('ru');
    const start = match.index;
    if (!word || start === undefined) return [];
    const value = COUNT_VALUES[word] ?? Number(word);
    return [{ word, value, start, end: start + match[0].length }];
  });

export const requestedSourceAlternatives = (message: string): RequestedSourceAlternatives | undefined => {
  const normalized = message.normalize('NFKC').toLocaleLowerCase('ru');
  const visible = maskQuotedText(normalized);
  if (!visible.trim() || isHardRefusal(visible)) return undefined;

  const foreign = FOREIGN.test(visible);
  const safeText = stripSafeClauses(visible).replace(FOREIGN, ' ');
  const hasRelative = RELATIVE.test(safeText);
  const hasAction = REQUEST_VERB.test(safeText);
  const hasCurrentTarget = CURRENT_TARGET.test(safeText) || /(?<!\p{L})(?:к\s+этой\s+станции|чем\s+эта\s+станция|than\s+this\s+station)(?!\p{L})/iu.test(safeText);
  const hasUnsupportedRelativeModifier = /(?<!\p{L})(?:контрастн\p{L}*|спокойн\p{L}*|энергичн\p{L}*|calmer|quieter|more\s+contrasting|contrasting)(?!\p{L})/iu.test(safeText);
  const countOccurrences = countMatches(safeText);
  const directCounts = countOccurrences.filter((count) => {
    const after = safeText.slice(count.end, count.end + 42);
    return /(?<!\p{L})(?:похож\p{L}*|similar|станци\p{L}*|station\p{L}*|в\s+том\s+же\s+духе)(?!\p{L})/iu.test(after);
  });
  const isRelativeRequest = (hasAction && hasRelative) || standaloneRelative(safeText) || (!hasAction && hasRelative && directCounts.length > 0) ||
    (hasAction && hasCurrentTarget && hasUnsupportedRelativeModifier);
  if (!isRelativeRequest) return undefined;
  if (hasExplicitExternalAnchor(message)) return undefined;

  if (directCounts.some((count) => count.value > 3 || count.value < 1)) return { kind: 'clarify' };
  if (directCounts.length > 1) return { kind: 'clarify' };
  const count = (directCounts[0]?.value ?? 2) as 1 | 2 | 3;

  const selectedCount = directCounts[0];
  const cardinalWords = new Set(['one', 'two', 'three', 'four', 'five', 'одну', 'один', 'одна', 'одно', 'два', 'две', 'три', 'четыре', 'пять']);
  const contrastFiller = (entry: typeof countOccurrences[number]): boolean => {
    if (!['the other', 'another', 'другую', 'другая', 'другой', 'другое'].includes(entry.word)) return false;
    const before = safeText.slice(Math.max(0, entry.start - 32), entry.start);
    return /(?:но|but)\s*$/iu.test(before) && RELATIVE.test(before);
  };
  const unassignedCount = countOccurrences.some((entry) => {
    if (entry.start === selectedCount?.start || contrastFiller(entry)) return false;
    return cardinalWords.has(entry.word) || entry.value > 0;
  });
  if (unassignedCount) return { kind: 'clarify' };

  const remainder = selectedCount
    ? `${safeText.slice(0, selectedCount.start)} ${safeText.slice(selectedCount.end)}`
    : safeText;
  const tokens = wordTokens(remainder);
  if (quotedText(normalized) || tokens.some((token) => !ALLOWED_WORDS.has(token))) return { kind: 'clarify' };
  return { kind: 'near', count, foreign };
};
