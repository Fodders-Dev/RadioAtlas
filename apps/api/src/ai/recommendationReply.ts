import { sourceFacts } from './currentSourceDiscovery.js';
import { sanitizeSnippet } from './untrustedData.js';
import type { VerifiedStationRef } from './types.js';

const ownText = (reply: string) => reply.replace(/«[^»]*»|“[^”]*”|"[^"]*"/g, '');

// A card's position is fragile: ranking, exclusions and short repeats can all
// change it. Require named station facts instead of positional descriptions.
// Time expressions ("во второй половине дня") are not card references.
export const referencesStationPosition = (reply: string): boolean => {
  const text = ownText(reply);
  const ordinal = '(?:перв(?:ая|ую|ой|ый|ого|ом)|втор(?:ая|ую|ой|ый|ого|ом)|трет(?:ий|ь(?:я|ю|ей|его|ем))|четв[её]рт(?:ая|ую|ой|ый|ого|ом)|пят(?:ая|ую|ой|ый|ого|ом))';
  return new RegExp(`(?:^|[^а-яё])${ordinal}(?:\\s+(?:карточк|станци|вариант)[а-яё]*)?\\s*[—–:-]`, 'i').test(text) ||
    new RegExp(`(?:^|[^а-яё])${ordinal}\\s+(?:карточк|станци|вариант)[а-яё]*`, 'i').test(text) ||
    new RegExp(`(?:^|[^а-яё])(?:у\\s+)?${ordinal}\\s+(?:больше|более|скорее|тяготеет|уходит|звучит|плотнее|мягче|быстрее|медленнее|да[её]т|ид[её]т|будет|предлагает|лучше)(?=$|[^а-яё])`, 'i').test(text) ||
    new RegExp(`(?:^|[^а-яё])${ordinal}\\s+месте(?=$|[^а-яё])`, 'i').test(text) ||
    /(?:^|\s)(?:first|second|third|fourth|fifth)\s+(?:card|station|option)\b/i.test(text) ||
    /(?:^|\s)(?:the\s+)?(?:first|second|third|fourth|fifth)\s*[—–:-]/i.test(text) ||
    /(?:^|\s)(?:the\s+)?(?:first|second|third|fourth|fifth)\s+(?:leans|is|has|offers)\b/i.test(text) ||
    /(?:^|\n)\s*(?:[1-5][.)]|№\s*[1-5])\s+/u.test(text);
};

// No action has been executed by the composer. In particular, a recommendation
// or a repair is not permission to claim that playback has started.
export const claimsUnrequestedPlayback = (reply: string): boolean => ownText(reply)
  .split(/[.!?]/).some(sentence => {
    if (/(?:не\s+(?:буду\s+|будем\s+)?(?:включ|вруб|запуск|постав)|(?:don['’]t|do not|not)\s+(?:play|start))/i.test(sentence)) return false;
    return /(?:^|[^а-яё])(?:включаю|включила|включили|включаем|врубаю|врубила|врубаем|запускаю|запустила|запускаем|поставила|уже\s+играет)(?=$|[^а-яё])/i.test(sentence) ||
      /\b(?:I(?:'ve| have)\s+(?:started|played)|I'm\s+(?:playing|starting)|we(?:'re| are)\s+(?:playing|starting))\b/i.test(sentence);
  });

const label = (value: string, limit: number) => sanitizeSnippet(value)
  .replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ')
  .replace(/\s+/g, ' ').trim().slice(0, limit);

// Facts stay attached to the row that supplied them. Never use a slate-wide
// genre summary to describe an individual station, or infer live audio.
export const describeVerifiedStationSlate = (stations: readonly VerifiedStationRef[]): string => stations.slice(0, 5)
  .map(station => {
    const facts = sourceFacts(station);
    const tags = facts.genres.length ? facts.genres : station.tags.slice(0, 3).map(tag => label(tag, 40)).filter(Boolean);
    const country = label(facts.country, 60);
    return `«${label(facts.name, 120)}»${tags.length ? ` — ${tags.join(', ')}` : ''}${country ? ` (${country})` : ''}.`;
  }).join(' ');
