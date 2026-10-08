import { hasCountryScopeMention, requestedCountry } from './requestedCountry.js';
import { requestedStationCount } from './recommendationCount.js';
import type { ChatTurn } from './types.js';

export type SelectionContinuity =
  | { mode: 'new' }
  | { mode: 'continue'; fromUserTurnId: string };

export type SelectionUserTurn = { id: string; text: string };

export type SelectionContext = {
  turns: string[];
  continuing: boolean;
  /** True when USER text specified or explicitly cleared country scope. */
  countrySpecified: boolean;
  country?: string;
  count?: number;
  exclusionIds: string[];
  era?: { fromYear: number; toYear: number };
};

export const MAX_SELECTION_USER_TURNS = 6;
export const MAX_SELECTION_TURN_CHARS = 1000;

type EraPeriod = { fromYear: number; toYear: number };
const eraMentions = (text: string, skipNegated: boolean): Array<{ at: number; period: EraPeriod }> => {
  const mentions: Array<{ at: number; period: EraPeriod }> = [];
  const isNegated = (at: number) => skipNegated && /(?:не(?:\s+с)?|not(?:\s+(?:from|the))?|без|without)\s*$/iu
    .test(text.slice(Math.max(0, at - 20), at));
  const rangePattern = /(?:^|[^\d])((?:19|20)\d{2})\s*(?:[-–—]|по|до|to|through)\s*((?:19|20)\d{2})(?:$|[^\d])/giu;
  for (const match of text.matchAll(rangePattern)) {
    const at = (match.index ?? 0) + match[0].indexOf(match[1]!);
    const fromYear = Number(match[1]);
    const toYear = Number(match[2]);
    if (!isNegated(at) && fromYear <= toYear && toYear - fromYear <= 100) mentions.push({at, period:{fromYear,toYear}});
  }
  const decadePattern = /нулев\p{L}*|двухтысячн\p{L}*|девяност\p{L}*|nineties|восьмидесят\p{L}*|eighties|(?:^|\D)(?:(?:19|20))?(?:00|60|70|80|90|10|20)\s*(?:['’]?s|er|[-–—]?(?:х|ых|ые|е))(?![\d])/giu;
  for (const match of text.matchAll(decadePattern)) {
    const at = match.index ?? 0;
    if (isNegated(at)) continue;
    const term = match[0].toLocaleLowerCase();
    let fromYear: number;
    if (/нулев|двухтысячн|(?:00|2000)/u.test(term)) fromYear = 2000;
    else if (/девяност|nineties|90/u.test(term)) fromYear = 1990;
    else if (/восьмидесят|eighties|80/u.test(term)) fromYear = 1980;
    else {
      const numeric = Number(term.match(/(?:19|20)?(\d{2})/u)?.[1]);
      if (!Number.isFinite(numeric)) continue;
      fromYear = numeric === 10 || numeric === 20 ? 2000 + numeric : 1900 + numeric;
    }
    mentions.push({at, period:{fromYear,toYear:fromYear + 9}});
  }
  return mentions.sort((a,b) => a.at - b.at);
};

export const parseRequestedEra = (text: string): EraPeriod | undefined => eraMentions(text, true).at(-1)?.period;

export const requestedEraCatalogueTags = (era: EraPeriod): string[] => {
  const tags: string[] = [];
  const labels: Record<number, string[]> = {
    1960:['60s','1960s'], 1970:['70s','1970s'], 1980:['80s','1980s'],
    1990:['90s','1990s'], 2000:['00s','2000s','нулевые'], 2010:['10s','2010s','десятые'],
    2020:['20s','2020s']
  };
  const firstDecade = Math.floor(era.fromYear / 10) * 10;
  const lastDecade = Math.floor(era.toYear / 10) * 10;
  for (let decade = firstDecade; decade <= lastDecade && decade - firstDecade <= 100; decade += 10) {
    for (const tag of labels[decade] || []) if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
};

export const stationMatchesRequestedEra = (evidence: readonly string[], era: EraPeriod): boolean => {
  const known = evidence.flatMap(value => eraMentions(value, false).map(mention => mention.period));
  return !known.length || known.some(period => period.fromYear <= era.toYear && period.toYear >= era.fromYear);
};

const EXCLUSION_IDS = [
  'dnb', 'shoegaze', 'chanson', 'bard', 'talk', 'news', 'rap', 'metal',
  'hardcore', 'rock', 'jazz', 'pop', 'house', 'trance', 'ambient', 'folk',
  'country', 'reggae', 'classical', '90s'
] as const;

// Keep release language narrow and tied to a known exclusion. A bare «можно»
// or “allowed” never clears a constraint.
const RELEASE_TERMS: Readonly<Record<(typeof EXCLUSION_IDS)[number], RegExp>> = {
  dnb: /(?:dnb|днб|drum\s*(?:and|n|&|'n')?\s*bass|драм[-\s]*(?:энд[-\s]*)?б[еэ]йс)/iu,
  shoegaze: /(?:shoegaze|шугейз)/iu,
  chanson: /(?:chanson|шансон)/iu,
  bard: /(?:бард|авторск(?:ая|ой)?\s+песн|singer[-\s]?songwriter)/iu,
  talk: /(?:разговор|болтов|ведущ|talk|spoken|podcast)/iu,
  news: /(?:новост\p{L}*|news)/iu,
  rap: /(?:рэп\p{L}*|\brap\b|hip[-\s]?hop|хип[-\s]?хоп\p{L}*)/iu,
  metal: /(?:метал\p{L}*|\bmetal\b)/iu,
  hardcore: /(?:hardcore|хардкор)/iu,
  rock: /(?:рок\p{L}*|\brock\b)/iu,
  jazz: /(?:джаз\p{L}*|\bjazz\b)/iu,
  pop: /(?:попс\p{L}*|поп(?:а|у|ом)?|\bpop\b)/iu,
  house: /(?:хаус\p{L}*|\bhouse\b)/iu,
  trance: /(?:транс\p{L}*|\btrance\b)/iu,
  ambient: /(?:ambient|эмбиент)/iu,
  folk: /(?:фолк\p{L}*|\bfolk\b)/iu,
  country: /(?:кантри|\bcountry\b)/iu,
  reggae: /(?:reggae|регги)/iu,
  classical: /(?:классическ\p{L}*|classical)/iu,
  '90s': /(?:90\s*[-\s]*(?:['’]?s|er|х|ых|ые|е)|1990(?:['’]?s|s)|девяност\p{L}*|nineties)/iu
};

const explicitReleaseMatches = (text: string, term: RegExp): Array<{ start: number; end: number }> => {
  const escapedTerm = term.source;
  const pattern = new RegExp(
    `(?:(?<![\\p{L}\\p{N}_])(?:можно|разрешаю|разрешены|разрешён|разрешена|разрешено|allowed|okay|ok)\\s+(?:теперь\\s+)?${escapedTerm}(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}_])${escapedTerm}\\s+(?:теперь\\s+)?(?:можно|разрешены|разрешён|разрешена|разрешено|allowed|okay|ok)(?![\\p{L}\\p{N}_]))`,
    'giu'
  );
  const matches: Array<{ start: number; end: number }> = [];
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    if (/(?:не|нельзя|not|never|without)\s*$/iu.test(before)) continue;
    const nextBoundary = text.slice(match.index).search(/[.!?;\n]/u);
    if (nextBoundary >= 0 && /[?？]/u.test(text[match.index + nextBoundary] ?? '')) continue;
    matches.push({ start: match.index, end: match.index + match[0].length });
  }
  return matches;
};

const explicitReleaseIndex = (text: string, term: RegExp): number | undefined =>
  explicitReleaseMatches(text, term).at(-1)?.start;

/** Remove only affirmative, closed-vocabulary permission phrases for factual gating. */
export const stripExplicitExclusionReleases = (text: string): string => {
  const spans = EXCLUSION_IDS.flatMap(id => explicitReleaseMatches(text, RELEASE_TERMS[id]))
    .sort((left, right) => left.start - right.start || right.end - left.end);
  if (!spans.length) return text;
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end);
    else merged.push({ ...span });
  }
  let result = '';
  let cursor = 0;
  for (const span of merged) {
    result += text.slice(cursor, span.start) + ' ';
    cursor = span.end;
  }
  return (result + text.slice(cursor)).replace(/[ \t]+([.!?])/gu, '$1').replace(/\s{2,}/gu, ' ').trim();
};

const lastExplicitExclusionIndex = (text: string, term: RegExp): number | undefined => {
  const clauses = /(?:^|[\s,.;!?—–])(?:без|кроме|(?:полностью\s+)?(?:исключи|исключить|исключая|убери|убрать)|никак(?:ого|ой|их)|не\s+(?:надо|нужен|нужна|нужно|нужны|хочу|ставь|включай|добавляй))\s+([^,.;!?—–]+)/giu;
  let last: number | undefined;
  for (const match of text.matchAll(clauses)) {
    if (term.test(match[1] ?? '')) last = match.index ?? 0;
  }
  return last;
};

const unrestrictedCountryIndex = (text: string): number | undefined => {
  const pattern = /(?:из\s+любой\s+страны|любая\s+страна|без\s+ограничений\s+по\s+стране|from\s+any\s+country|any\s+country|country\s+doesn['’]?t\s+matter|anywhere)/giu;
  let last: number | undefined;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const before = text.slice(Math.max(0, index - 14), index);
    if (/(?:не\s+из|не|not|never|without)\s*$/iu.test(before)) continue;
    last = index;
  }
  return last;
};

const unrestrictedCountIndex = (text: string): number | undefined => {
  const pattern = /(?:любое\s+количество\s+(?:радио|станци\p{L}*|вариант\p{L}*)|сколько\s+угодно\s+(?:радио|станци\p{L}*|вариант\p{L}*)|any\s+number\s+of\s+(?:stations|radios|options)|unlimited\s+(?:stations|radios|options)|без\s+ограничения\s+количества)/giu;
  let last: number | undefined;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (/(?:не|not|never)\s*$/iu.test(text.slice(Math.max(0, index - 10), index))) continue;
    last = index;
  }
  return last;
};

/**
 * Select at most six recent USER turns. IDs use original history indices, so
 * dropping assistant turns or trimming text does not change their identity.
 */
export const boundedSelectionUserTurns = (history: ChatTurn[]): SelectionUserTurn[] => {
  const selected: SelectionUserTurn[] = [];
  for (let index = history.length - 1; index >= 0 && selected.length < MAX_SELECTION_USER_TURNS; index--) {
    const turn = history[index];
    if (!turn || turn.role !== 'user') continue;
    const text = Array.from(turn.text.trim()).slice(0, MAX_SELECTION_TURN_CHARS).join('');
    selected.push({ id: `u${index}`, text });
  }
  return selected.reverse();
};

/** Parse the planner's closed continuity choice. Invalid decisions fail closed. */
export const parseSelectionContinuity = (value: unknown): SelectionContinuity | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.mode === 'new' && Object.keys(record).length === 1) return { mode: 'new' };
  if (
    record.mode === 'continue' &&
    Object.keys(record).length === 2 &&
    typeof record.fromUserTurnId === 'string' &&
    /^u(?:0|[1-9]\d{0,8})$/u.test(record.fromUserTurnId)
  ) return { mode: 'continue', fromUserTurnId: record.fromUserTurnId };
  return undefined;
};

export const resolveSelectionContext = (
  prior: SelectionUserTurn[],
  latest: string,
  continuity: SelectionContinuity,
  options: {
    isMusicRequest: (text: string) => boolean;
    isBarrier: (text: string) => boolean;
    exclusionIds: (text: string) => string[];
  }
): SelectionContext | undefined => {
  let included: string[];
  if (continuity.mode === 'new') {
    included = [latest];
  } else {
    const originIndex = prior.findIndex((turn) => turn.id === continuity.fromUserTurnId);
    if (originIndex < 0 || !options.isMusicRequest(prior[originIndex]!.text)) return undefined;
    const subsequent = [...prior.slice(originIndex + 1).map((turn) => turn.text), latest];
    if (subsequent.some(options.isBarrier)) return undefined;
    included = [...prior.slice(originIndex).map((turn) => turn.text), latest];
  }

  let country: string | undefined;
  let countrySpecified = false;
  let count: number | undefined;
  let era: { fromYear: number; toYear: number } | undefined;
  const activeExclusions = new Set<string>();
  for (const text of included) {
    era = parseRequestedEra(text) ?? era;
    const anyCountryAt = unrestrictedCountryIndex(text);
    if (hasCountryScopeMention(text) || anyCountryAt !== undefined) {
      countrySpecified = true;
      if (anyCountryAt === undefined) country = requestedCountry(text);
      else {
        const afterAny = text.slice(anyCountryAt);
        country = hasCountryScopeMention(afterAny) ? requestedCountry(afterAny) : undefined;
      }
    }
    const anyCountAt = unrestrictedCountIndex(text);
    if (anyCountAt === undefined) {
      const requestedCount = requestedStationCount(text);
      if (requestedCount !== undefined) count = requestedCount;
    } else {
      // Resolve only later explicit count language after an unrestricted
      // clause. A count before it is replaced; a later count wins.
      count = requestedStationCount(text.slice(anyCountAt));
    }

    const requestedExclusions = options.exclusionIds(text);
    for (const id of requestedExclusions) {
      if ((EXCLUSION_IDS as readonly string[]).includes(id)) activeExclusions.add(id);
    }
    for (const id of EXCLUSION_IDS) {
      const releaseAt = explicitReleaseIndex(text, RELEASE_TERMS[id]);
      if (releaseAt === undefined) continue;
      const exclusionAt = requestedExclusions.includes(id)
        ? lastExplicitExclusionIndex(text, RELEASE_TERMS[id])
        : undefined;
      if (exclusionAt === undefined || exclusionAt < releaseAt) activeExclusions.delete(id);
    }
  }

  return {
    turns: included,
    continuing: continuity.mode === 'continue',
    countrySpecified,
    ...(country ? { country } : {}),
    ...(count !== undefined ? { count } : {}),
    exclusionIds: [...activeExclusions],
    ...(era ? { era } : {})
  };
};
