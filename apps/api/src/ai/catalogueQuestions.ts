import type { ChatInput, ChatResult, ToolProvider, VerifiedStationRef } from './types.js';
import { hasPlayIntent } from './playbackIntent.js';
import { sourceGenres } from './currentSourceDiscovery.js';

const discovery = /(?:подб[еи]р|посовет|(?:по)?рекоменд|найд|поищ|переключ|предл[ао]г|\b(?:recommend|find|suggest|show|play)\b|(?:^|\s)(?:дай|покажи|предложи(?:те)?)(?:\s|$))/i;
const affirmative = (text:string) => text
  .replace(/(?:do\s+not|don['’]t)\s+(?:recommend|find|suggest|show|play)[^.!?;\n]*/gi, '')
  .replace(/не\s+(?:подбирай|подбери|ищи|находи|предлагай|предложи|рекомендуй|включай|показывай)[^.!?;\n]*/gi,'');
const label = (value: string, max = 110) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const tags = (station: VerifiedStationRef) => {
  const genres = sourceGenres(station.tags);
  // Alphabetical catalogue tags often start with bitrate, location or decade.
  // Musical genres are more useful than comparing "aac" and "128kbps".
  return genres.length ? genres : [...new Set(station.tags.map(tag => label(tag, 40).toLowerCase()).filter(Boolean))].slice(0, 6);
};
const answer = (reply: string, stations: VerifiedStationRef[] = []): ChatResult => ({
  reply, stations, serviceLinks: [], sources: [], actions: [{ kind: 'none' }], usage: { prompt: 0, completion: 0 }
});
const verified = async (ids: string[], tools: ToolProvider, limit: number) => {
  const rows: VerifiedStationRef[] = [];
  for (const id of [...new Set(ids.filter(Boolean))].slice(0, limit)) {
    const row = await tools.getStation(id).catch(() => null);
    if (row && row.stationuuid === id && row.url_resolved) rows.push(row);
  }
  return rows;
};

// Questions about a person's data or the cards already shown are not a new
// discovery request. Resolve their UUIDs before answering; never substitute
// search results for somebody's favourites or for the pair being compared.
export const answerCatalogueQuestion = async (input: ChatInput, tools: ToolProvider): Promise<ChatResult | undefined> => {
  const text = input.userMessage;
  if (discovery.test(affirmative(text)) || hasPlayIntent(text)) return undefined;
  const english = /^en(?:-|$)/i.test(input.locale || '');
  if (/(сохран[её]нн|мо[ийих]+).{0,24}(?:трек|песн)|(?:my|saved).{0,24}(?:tracks|songs)/i.test(text) &&
      /(вкус|говор|вид|доступ|зна|taste|see|access|tell)/i.test(text)) {
    return answer(english
      ? 'Your saved tracks are not included in this chat. Send two or three artist and track names: we can look for their common thread or use one as a starting point for radio discovery.'
      : 'Сохранённые треки в этот чат пока не передаются. Пришли 2–3 пары «исполнитель — трек»: можно найти общее между ними или взять один ориентиром для нового радио.');
  }
  if (/(?:мо[ийих]+|my).{0,22}(?:избран|любим|favou?rite)|(?:избран|favou?rite).{0,24}(?:станци|stations)/i.test(text) &&
      /(объедин|общ|вкус|вид|доступ|зна|характер|common|taste|see|access)/i.test(text)) {
    const ids = input.userTaste?.favoriteStationIds || [];
    if (!ids.length) return answer(english
      ? 'This chat has no favourite station IDs. I cannot tell whether your collection is empty or the client did not send it.'
      : 'В этом запросе нет списка избранных станций. Не могу отличить пустое избранное от клиента, который его не передал.');
    const rows = await verified(ids, tools, 3);
    if (!rows.length) return answer(english
      ? 'I received favourite station IDs, but could not verify their catalogue cards. I will not infer your taste from other stations.'
      : 'Получила идентификаторы избранных, но их карточки сейчас не нашлись в каталоге. По чужим станциям твой вкус определять не буду.');
    const counts = new Map<string, number>();
    rows.forEach(row => tags(row).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
    const shared = [...counts].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const summaries = rows.map(row => `«${label(row.name)}» — ${tags(row).join(', ') || (english ? 'no genre tags' : 'без жанровых тегов')}`);
    return answer(english
      ? `I can verify ${rows.length} of the ${new Set(ids).size} favourite IDs sent here. ${summaries.join('; ')}. ${shared.length ? `Shared catalogue tags: ${shared.map(([tag, count]) => `${tag} (${count}/${rows.length})`).join(', ')}.` : 'There are no shared genre tags in these cards.'} This describes these sources, not all the music you like.`
      : `Проверила ${rows.length} из ${new Set(ids).size} переданных избранных. ${summaries.join('; ')}. ${shared.length ? `Общие теги: ${shared.map(([tag, count]) => `${tag} (${count}/${rows.length})`).join(', ')}.` : 'Общих жанровых тегов у этих карточек нет.'} Это срез источников, а не диагноз твоего музыкального вкуса.`);
  }
  if (/(чем|как).{0,45}(?:эти|этих|они|дв[аеу]).{0,40}(?:отлич|разниц|сравн)|(?:сравни|compare).{0,30}(?:эти|дв[аеу]|these|two)|(?:difference|different).{0,35}(?:these|two)|why.{0,30}(?:these|two)|почему.{0,35}(?:эти|именно).{0,20}дв/i.test(text)) {
    const latest = input.userTaste?.lastSuggestedStationIds || [];
    if (latest.length !== 2) return answer(english
      ? 'I cannot identify an exact pair from the latest reply. Ask for two stations first, then ask me to compare them.'
      : 'В последнем ответе нет пары карточек для сравнения. Попроси два эфира — тогда сравню именно их.');
    const rows = await verified(latest, tools, 2);
    if (rows.length < 2) return answer(english
      ? 'I cannot verify two previously suggested cards here. Ask for two stations first; then I can compare their catalogue genres.'
      : 'В контексте нет двух подтверждённых предложенных карточек. Попроси два эфира — тогда сравню их жанры из каталога.');
    const first = rows[0]!, second = rows[1]!;
    const a = tags(first), b = tags(second);
    const common = a.filter(tag => b.includes(tag));
    const different = [a.filter(tag => !b.includes(tag)), b.filter(tag => !a.includes(tag))];
    const facts = rows.map((row, index) => `«${label(row.name)}» (${label(row.country, 60)}) — ${different[index]!.join(', ') || (index === 0 ? a : b).join(', ') || (english ? 'no genre tags' : 'без жанровых тегов')}`);
    return answer(english
      ? `${facts.join('; ')}. ${common.length ? `Shared tags: ${common.join(', ')}.` : 'Their catalogue genres do not overlap.'} These are format hints; I cannot hear their current programmes or guarantee which will suit your work right now.`
      : `${facts.join('; ')}. ${common.length ? `Общее: ${common.join(', ')}.` : 'Жанровые теги в каталоге не пересекаются.'} Это ориентиры по формату: текущий эфир не слышу и не могу гарантировать, какой прямо сейчас подойдёт для работы.`, rows);
  }
  if (/(гарантир|guarantee)/i.test(text) && /(реклам|ведущ|вокал|advert|commercial|host|vocal)/i.test(text)) {
    return answer(english
      ? 'I cannot guarantee a live station will stay free of adverts, presenters or vocals. Catalogue tags describe its format, not the next two hours of programming. I can find instrumental candidates if you want to try them.'
      : 'Гарантировать отсутствие рекламы, ведущих или вокала в живом эфире не могу. Теги описывают формат, а не следующие два часа программы. Могу подобрать инструментальные варианты для пробы.');
  }
  return undefined;
};
