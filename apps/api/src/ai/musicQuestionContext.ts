import { sanitizeSnippet } from './untrustedData.js';
import { requestedGenreRefinement } from './genreRefinement.js';
import type { ChatTurn, WebSource } from './types.js';
import { isNonArtistName, parseTrackTitle } from '../intel/harvestPipeline.js';

export type MusicExpertiseKind = 'track_question' | 'artist_question' | 'track_suggestions';

export type MusicQuestionContext = {
  kind: MusicExpertiseKind;
  subject: string;
  subjectSource: 'explicit' | 'current_track' | 'conversation';
  suggestionCount?: number;
  sameArtist?: boolean;
};

export type MusicQuestionResolution =
  | { status: 'skip' }
  | { status: 'clarify'; reason: 'missing_subject' | 'ambiguous_reference' | 'missing_artist'; subject?: string }
  | { status: 'resolved'; context: MusicQuestionContext };

const sourceMentionsSubject = (body: string, name: string) => {
  const normalizedName = name.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (!normalizedName || normalizedName.length < 3) return false;
  const normalizedBody = body.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  return ` ${normalizedBody} `.includes(` ${normalizedName} `);
};

/** Drops obvious reusable music-generator widgets from the music fact lane only. */
export const isGeneratedMusicWidgetSource = (source: WebSource, subject: string) => {
  const body = String(source.snippet || '');
  const hasGeneratorMarker = /\b(?:music|song|track)?\s*(?:prompt\s+)?(?:generator|template)\b|\bgenerated\s+(?:music|song|track)\b|\bprompt\s+template\b/iu.test(body);
  const hasReuseCount = /used\s+\d{1,4}\s*[×x]/iu.test(body);
  const hasPromptMarker = /\bprompt\b/iu.test(body);
  if (!hasGeneratorMarker && !(hasReuseCount && hasPromptMarker)) return false;
  const [artist = '', title = ''] = subject.split(/\s+[—–-]\s+/u);
  return !sourceMentionsSubject(body, artist) && !sourceMentionsSubject(body, title);
};

const clean = (value: string) => value.trim().replace(/\s+/g, ' ').replace(/[?!.,;:]+$/g, '').slice(0, 180);

const safeSubject = (value: string) => {
  return clean(sanitizeSnippet(String(value || '')).replace(/[\u0000-\u001f\u007f\r\n]+/g, ' '));
};

/** Visible USER subject frames. The caption is evidence, never action permission.
 * Keep the existing helper name for saved-find callers; screenshot subjects
 * deliberately use a different visible label and share the same trust boundary.
 */
export const readSavedFindingQuestion = (message: string): { track: string; question: string } | undefined => {
  // Greedy matching on the single title line preserves quotation marks inside
  // real titles. The closing delimiter must be followed by a newline.
  const match = message.trim().match(/^(?:О (?:сохранённой песне|песне с картинки) «([^\r\n]*)»:|About (?:saved song|song from image) “([^\r\n]*)”:)\r?\n([\s\S]+)$/u);
  return match ? { track: match[1] ?? match[2] ?? '', question: match[3]!.trim() } : undefined;
};

const savedTrack = (value: string) => {
  if (/[\u0000-\u001f\u007f\ufffd]|https?:\/\/|<\/?[a-z][^>]*>/iu.test(value)) return null;
  const parsed = parseTrackTitle(value.replace(/\s+[—–]\s+/gu, ' - '));
  if (!parsed || isNonArtistName(parsed.artist || parsed.title)) return null;
  const placeholder = /^(?:unknown(?: (?:title|song|track))?|no (?:title|track|metadata)|loading\.*|metadata unavailable|нет (?:данных|трека)|без названия|загрузка|реклама|ad[ -]?trigger|artist\s*-\s*title|song title(?: here)?|track title|now playing info(?: goes here)?|kein titel(?: update)?|sin t[ií]tulo|sem t[ií]tulo|titre inconnu)$/iu;
  if (placeholder.test(parsed.raw) || placeholder.test(parsed.title) || placeholder.test(parsed.artist || '')) return null;
  const subject = safeSubject(parsed.artist ? `${parsed.artist} — ${parsed.title}` : parsed.title);
  return subject ? { subject, artist: parsed.artist, title: parsed.title } : null;
};

export const explicitlyRequestsLiveSong = (text: string) =>
  /(?:сейчас|текущ[а-яё]*|current(?:ly)?|now playing|playing now)/iu.test(text) &&
  /(?:песн|трек|игра|звуч|слуша|song|track|playing)/iu.test(text);

const RADIO_OR_STATION = /(?<![\p{L}\p{N}])(?:радио|станци[а-яё]*|эфир|radio|stations?)(?![\p{L}\p{N}])/iu;
const isCurrentSongReference = (value: string) => /^(?:(?:эт(?:от|а|о|ого|ой|у)|this|that|current|то,? что|сейчас играющ)|текущ[а-яё]*\s+(?:песн[а-яё]*|трек[а-яё]*|композиц[а-яё]*))/iu.test(value.trim());

const withoutNegatedRadio = (text: string) => text.replace(
  /(?:не\s+(?:надо|нужно|ищи|поищи|подбирай|подберите|предлагай|включай|включайте|хочу)\s+(?:радио|станци[а-яё]*)|(?:радио|станци[а-яё]*)\s+не\s+(?:надо|нужно|ищи|поищи|подбирай|предлагай))[^,.;!?]*/giu,
  ' '
);

const hasExplicitRadioIntent = (text: string) => {
  const affirmative = withoutNegatedRadio(text);
  return RADIO_OR_STATION.test(affirmative) &&
    /(?:подбер|посовет|найд|поищ|включ|постав|дай|хочу|ищу|recommend|find|play|suggest)/iu.test(affirmative);
};

const isTrackQuestion = (text: string) =>
  /(?:когда|в каком году|на каком альбоме|из какого альбома|с какого альбома|кто (?:это|по[её]т|исполняет)|какой (?:здесь|тут|у него|у неё|у нее)?\s*(?:стиль|жанр)|какой здесь стиль|расскажи|что за|что ты знаешь|tell me|when was|what (?:style|genre|album)|who (?:sings|performs))/iu.test(text) &&
  /(?:песн|трек|композиц|сингл|исполнител|артист|групп|(?:этот|эта|это|об этом|об этой)\s+(?:трек|песн)|\b(?:она|он|они|её|ее|его)\b|сейчас играет|now playing|song|track|artist|band|здесь|тут)/iu.test(text);

const isArtistQuestion = (text: string) =>
  /(?:расскажи|что знаешь|кто такой|кто такая|tell me about|who is)/iu.test(text) &&
  /(?:исполнител[ьяе]?|артист[аеу]?|групп[аеу]?|музыкант[ае]?|artist|band|musician)/iu.test(text);

const asksTrackFacet = (text: string) =>
  /(?:когда|в каком году|на каком альбоме|из какого альбома|с какого альбома|release|album|date|стил[ьяе]?|жанр|style|genre|instrumentation)/iu.test(text);

const isTrackSuggestion = (text: string) =>
  /(?:посовет|подбер|найди|поищи|recommend|suggest|find)/iu.test(text) &&
  /(?:похож|similar|в духе|как этот|как эта|такой же)/iu.test(text) &&
  /(?:трек[а-яё]*|песн[а-яё]*|композиц[а-яё]*|track[s]?|song[s]?)/iu.test(text) &&
  !hasExplicitRadioIntent(text);

const explicitPair = (text: string) => {
  const lines = text.split(/[\r\n]+/).map(clean).filter(Boolean);
  for (const line of lines) {
    const separator = line.search(/\s+[—–-]\s+/u);
    if (separator >= 0) {
      const leftRaw = line.slice(0, separator).trim();
      const rightRaw = line.slice(separator).replace(/^\s+[—–-]\s+/u, '').trim();
      const artist = leftRaw
        .replace(/^(?:расскажи(?:\s+мне)?\s+(?:про|о|об)|tell\s+me\s+about)\s+/iu, '')
        .replace(/^(?:нет,?\s*)?(?:(?:я\s+)?(?:про|имею\s+в\s+виду))\s+/iu, '')
        .replace(/^(?:посоветуй|подбери|найди|поищи|recommend|suggest|find)\s+(?:мне\s+)?(?:(?:\d{1,2}|один|одну|два|две|три|четыре|пять)\s+)?(?:(?:похож[а-яё]*|similar)\s+)?(?:(?:песн[а-яё]*|трек[а-яё]*|композиц[а-яё]*|songs?|tracks?)\s+)?(?:на|для|to)\s+/iu, '')
        .trim();
      const title = rightRaw
        .replace(/[.;]\s+(?:радио|станци[а-яё]*|не (?:надо|ищи|включай)).*$/iu, '')
        .replace(/\s*[:;,.]\s+(?:когда|кто|какой|какая|на каком альбоме|из какого альбома|what|when|who|which)\s.*$/iu, '');
      const subject = safeSubject(`${artist} — ${title}`);
      if (subject) return subject;
    }
  }
  return undefined;
};

const explicitSuggestionTarget = (text: string) => {
  const match = text.match(/(?:похож[а-яё]*(?:\s+(?:песн[а-яё]*|трек[а-яё]*|композиц[а-яё]*|songs?|tracks?))*\s+(?:на|от|как|to|like)|similar(?:\s+(?:songs?|tracks?))?\s+(?:to|like)|в духе|как|like)\s+(.+?)(?:[,;?.]|$)/iu);
  const target = match?.[1] ? safeSubject(match[1]) : '';
  return target && !isCurrentSongReference(target) ? target : undefined;
};

const namedArtist = (text: string) => {
  const match = text.match(/(?:исполнител[ьяе]?|артист[аеу]?|групп[аеу]?|музыкант[ае]?|artist|band|musician)\s+(.+?)(?:[?!.,;:]|$)/iu);
  const candidate = match?.[1] ? safeSubject(match[1]) : '';
  if (!candidate || isCurrentSongReference(candidate) || /^(?:эт(?:а|ой|ого|их|им)?\s+)?(?:песн|трек|композиц)|^(?:this|that|current)\s+(?:song|track)/iu.test(candidate)) return undefined;
  return candidate;
};

const barePronounQuestion = (text: string) =>
  /^(?:а\s*)?(?:когда|в каком году|на каком альбоме|из какого альбома|кто)\s+(?:она|он|они|её|ее|его|это)(?:\s|[?!.,]|$)/iu.test(text.trim());

const currentReference = (text: string) =>
  /(?:эт(?:от|а|о)\s+(?:трек|песн[яюи]?|композици[яию])|текущ[а-яё]*\s+(?:трек|песн[а-яё]*|композиц[а-яё]*)|об эт(?:ом|ой)\s+(?:треке|песне|композиции)|(?:что|ч[её])\s+за\s+(?:трек|песн[яюи]?|композици[яию])|(?:на|к|относительно)\s+эт(?:от|у|ого|ой)|то,? что (?:сейчас )?играет|сейчас играющ|current (?:song|track)|this (?:song|track)|now playing|здесь|тут)/iu.test(text);

const suggestionCount = (text: string) => {
  const match = text.match(/(?<![\p{L}\p{N}])(\d{1,2})(?![\p{L}\p{N}])/u);
  if (match) return Math.min(5, Math.max(1, Number(match[1])));
  const words: Record<string, number> = { один: 1, одну: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5 };
  const word = text.match(/(?<![\p{L}\p{N}])(один|одну|два|две|три|четыре|пять)(?![\p{L}\p{N}])/iu)?.[1]?.toLowerCase();
  return word ? words[word] : 3;
};

const userTurns = (history: readonly ChatTurn[]) => history.filter(turn => turn.role === 'user').slice(-6).map(turn => turn.text);
const artistOf = (subject: string) => safeSubject(subject.split(/\s+[—–-]\s+/u)[0] || '');
const isEllipticalMusicFollowup = (text: string) =>
  barePronounQuestion(text) ||
  /^(?:а\s*)?(?:на каком альбоме|из какого альбома|с какого альбома|когда(?: это произошло)?|в каком году|какой(?: здесь)?\s+(?:стиль|жанр)|какой\s+стиль|кто исполняет|кто по[её]т)(?:\s+е[её]|\s+его|\s+это)?\s*[?!.,]*$/iu.test(text.trim());
const isUnrelatedBarrier = (text: string) => {
  const value = text.trim();
  if (!value) return true;
  if (hasExplicitRadioIntent(value) || requestedGenreRefinement(value)) return true;
  if (/^(?:да|нет|не|yes|no|yeah|nope)(?:[.!?]|$)/iu.test(value)) return true;
  if (/^(?:а\s*)?кто\s+(?:он|она|они|это)(?:\s|[?!.,]|$)/iu.test(value)) return true;
  if (currentReference(value) && !explicitPair(value)) return true;
  if (/^(?:когда|кто|почему|где|зачем|как|what|when|who|why|where|how)(?=$|[\s!?.,])/iu.test(value) &&
      !explicitPair(value) && !isTrackSuggestion(value) && !/(?:песн|трек|музык|альбом|артист|исполнител|song|track|album|artist|band)/iu.test(value) &&
      !isEllipticalMusicFollowup(value)) return true;
  return /^(?:привет|здравствуй|спасибо|благодарю|ок(?:ей)?|понял[а]?|ясно|hi|hello|thanks|thank you)(?=$|[\s!?.,])/iu.test(value) ||
    !explicitPair(value) && /^(?:почему|объясни|расскажи|что такое|как работает|what is|why|explain)(?=$|[\s!?.,])/iu.test(value) && !/(?:песн|трек|музык|альбом|артист|исполнител|song|track|album|artist)/iu.test(value);
};

const savedShortAnalysisQuestion = (text: string) =>
  /^(?:а\s+)?(?:(?:дай|скинь|покажи|пришли|найди)\s+(?:мне\s+)?(?:текст|слова)|объясни\s+смысл|переведи(?:\s+е[её])?|(?:show|find|get)(?:\s+me)?\s+(?:the\s+)?lyrics)[?!.,]*$/iu.test(text.trim());

const savedFacetQuestion = (text: string) =>
  /^(?:and\s+)?(?:who\s+(?:(?:sings|performs|recorded|wrote)(?:\s+(?:it|this(?:\s+(?:song|track))?))?|is\s+(?:the\s+)?(?:performer|artist))|what\s+(?:genre|style)(?:\s+is\s+(?:it|this(?:\s+(?:song|track))?))?)[?!.,]*$/iu.test(text.trim());

// A named replacement without a performer must clarify that new title, never
// borrow the saved song's artist. Keep this scoped to saved-song dialogue.
const namedSavedTrack = (text: string) => {
  const match = text.trim().match(/^(?:расскажи(?:\s+мне)?\s+(?:про|о|об)|tell\s+me\s+about)\s+(?:the\s+)?(?:песн[юе]|трек(?:е)?|song|track)\s+([^\r\n]+)$/iu);
  if (!match?.[1] || explicitPair(match[1])) return undefined;
  const title = safeSubject(match[1].replace(/^([«“"'])((?:.|\n)*)[»”"']\s*[?!.,]*$/u, '$2'));
  return title && !isCurrentSongReference(title) ? title : undefined;
};

const savedMusicQuestion = (text: string) =>
  savedShortAnalysisQuestion(text) || savedFacetQuestion(text) ||
  isEllipticalMusicFollowup(text) || isTrackSuggestion(text) || isArtistQuestion(text) || continuationSuggestion(text) ||
  /^(?:расскажи|tell me more)[.!?]*$|^(?:а\s+)?(?:когда|when).{0,30}(?:выш|релиз|releas|come out)/iu.test(text) ||
  /^(?:нет,?\s*)?(?:я\s+)?(?:про|имею\s+в\s+виду)\s+/iu.test(text) ||
  /(?:песн|трек|композиц|сингл|song|track|album)/iu.test(text) &&
    /(?:расскажи|что|кто|как|почему|зачем|когда|ч[её]м|смысл|текст|слов|перев|tell|what|who|when|how|why|meaning|lyrics|translat)/iu.test(text) ||
  /^(?:а\s+)?(?:о ч[её]м|про что)(?:\s+(?:она|он|это))?\s*[?!.]*$|^(?:текст|слова|lyrics|смысл|подтекст|перевод)\s*[?!.]*$/iu.test(text);

const savedUnrelatedTopic = (text: string) =>
  /^(?:а\s+)?(?:погод[ауы]|сколько будет|удали (?:мой )?аккаунт|weather|delete (?:my )?account)(?=$|\s|[?!.,])/iu.test(text.trim());

const framedResolution = (frame: { track: string; question: string }): MusicQuestionResolution | undefined => {
  const text = frame.question;
  // The actual question can change topic. The saved caption never overrides
  // an explicit new subject or supplies permission to play a station.
  if (hasExplicitRadioIntent(text) || requestedGenreRefinement(text) || savedUnrelatedTopic(text)) return { status: 'skip' };
  const pair = explicitPair(text);
  const kind: MusicExpertiseKind = isTrackSuggestion(text) || continuationSuggestion(text) || /похож|similar/iu.test(text)
    ? 'track_suggestions' : isArtistQuestion(text) && !asksTrackFacet(text) ? 'artist_question' : 'track_question';
  if (pair) return (text.match(/\s+[—–-]\s+/gu) || []).length > 1
    ? { status: 'clarify', reason: 'ambiguous_reference' }
    : { status: 'resolved', context: { kind, subject: pair, subjectSource: 'explicit', ...(kind === 'track_suggestions' ? { suggestionCount: suggestionCount(text) } : {}) } };
  const namedTitle = namedSavedTrack(text);
  if (namedTitle) return { status: 'clarify', reason: 'missing_artist', subject: namedTitle };
  if (explicitlyRequestsLiveSong(text) ||
      (isTrackSuggestion(text) && explicitSuggestionTarget(text)) ||
      (isArtistQuestion(text) && namedArtist(text) && !/(?:this|that)\s+(?:song|track)/iu.test(text))) return undefined;
  if (!savedMusicQuestion(text)) return { status: 'skip' };
  const track = savedTrack(frame.track);
  if (!track) return { status: 'clarify', reason: 'missing_subject' };
  const correction = text.match(/^(?:нет,?\s*)?(?:я\s+)?(?:про|имею\s+в\s+виду)\s+(.+?)(?:\s*[:;,]\s*(?:когда|в каком году|на каком альбоме|из какого альбома|кто|стиль|жанр|release|album|when|what|who).*)?$/iu)?.[1];
  const title = correction ? safeSubject(correction) : track.title;
  if (!track.artist) return { status: 'clarify', reason: 'missing_artist', subject: title };
  return { status: 'resolved', context: {
    kind, subject: correction ? `${track.artist} — ${title}` : track.subject, subjectSource: 'explicit',
    ...(kind === 'track_suggestions' ? { suggestionCount: suggestionCount(text) } : {})
  } };
};

const replayUserMusicContext = (turns: readonly string[]) => {
  let subject: string | undefined;
  let kind: MusicExpertiseKind = 'track_question';
  let pendingTitle: string | undefined;
  let pendingCount = 3;
  let pendingKind: MusicExpertiseKind = 'track_suggestions';
  let saved = false;
  let savedQuestion: string | undefined;
  let ambiguous = false;
  let unknownCurrent = false;
  for (const original of turns) {
    let turn = original;
    const frame = readSavedFindingQuestion(turn);
    if (frame) {
      const resolution = framedResolution(frame);
      if (resolution) {
        subject = resolution.status === 'resolved' ? resolution.context.subject : undefined;
        pendingTitle = resolution.status === 'clarify' && resolution.reason === 'missing_artist' ? resolution.subject : undefined;
        kind = resolution.status === 'resolved' ? resolution.context.kind : 'track_question';
        pendingKind = /похож|similar/iu.test(frame.question) ? 'track_suggestions' : isArtistQuestion(frame.question) ? 'artist_question' : 'track_question';
        pendingCount = suggestionCount(frame.question) || 3;
        saved = resolution.status !== 'skip';
        savedQuestion = saved ? frame.question : undefined;
        ambiguous = false;
        unknownCurrent = false;
        continue;
      }
      turn = frame.question;
      saved = false;
      savedQuestion = undefined;
    }
    if (saved && (savedUnrelatedTopic(turn) || !pendingTitle && !savedMusicQuestion(turn) && !explicitPair(turn))) {
      subject = undefined;
      pendingTitle = undefined;
      saved = false;
      savedQuestion = undefined;
    }
    const replacementTitle = saved ? namedSavedTrack(turn) : undefined;
    if (replacementTitle) {
      subject = undefined;
      pendingTitle = replacementTitle;
      pendingKind = 'track_question';
      savedQuestion = turn;
      continue;
    }
    // Saved deictic followups refer to the captured song; explicit live wording
    // still breaks replay because old live metadata cannot be reconstructed.
    if (saved && savedMusicQuestion(turn) && !explicitlyRequestsLiveSong(turn) && !explicitPair(turn) &&
        (currentReference(turn) || savedShortAnalysisQuestion(turn) || savedFacetQuestion(turn) || /^(?:а\s+)?(?:о ч[её]м|про что|смысл|текст|lyrics|what is).*/iu.test(turn))) continue;
    if (currentReference(turn) && !explicitPair(turn)) {
      subject = undefined;
      pendingTitle = undefined;
      ambiguous = false;
      unknownCurrent = true;
      saved = false;
      continue;
    }
    if (isUnrelatedBarrier(turn)) {
      subject = undefined;
      pendingTitle = undefined;
      ambiguous = false;
      unknownCurrent = false;
      saved = false;
      continue;
    }
    if ((turn.match(/\s+[—–-]\s+/gu) || []).length > 1) {
      subject = undefined;
      pendingTitle = undefined;
      ambiguous = true;
      unknownCurrent = false;
      continue;
    }
    const pair = explicitPair(turn);
    if (pair) {
      subject = pair;
      kind = isTrackSuggestion(turn) ? 'track_suggestions' : 'track_question';
      if (kind === 'track_suggestions') pendingCount = suggestionCount(turn) || 3;
      pendingTitle = undefined;
      ambiguous = false;
      unknownCurrent = false;
      saved = false;
      continue;
    }
    const historicalArtist = isArtistQuestion(turn) ? namedArtist(turn) : undefined;
    if (historicalArtist) {
      subject = historicalArtist;
      kind = 'artist_question';
      pendingTitle = undefined;
      ambiguous = false;
      unknownCurrent = false;
      saved = false;
      continue;
    }
    const target = isTrackSuggestion(turn) ? explicitSuggestionTarget(turn) : undefined;
    if (target) {
      pendingTitle = target;
      pendingCount = suggestionCount(turn) || 3;
      pendingKind = 'track_suggestions';
      subject = undefined;
      ambiguous = false;
      unknownCurrent = false;
      saved = false;
      continue;
    }
    if (pendingTitle && bareArtistAnswer(turn)) {
      const artist = safeSubject(turn);
      if (saved && !savedTrack(`${artist} — ${pendingTitle}`)) continue;
      if (artist) {
        subject = `${artist} — ${pendingTitle}`;
        kind = pendingKind;
      }
      pendingTitle = undefined;
      ambiguous = false;
      unknownCurrent = false;
      continue;
    }
    const correction = turn.match(/^(?:нет,?\s*)?(?:я\s+)?(?:про|имею\s+в\s+виду)\s+(.+)$/iu)?.[1]
      ?.replace(/\s*[:;,]\s*(?:когда|в каком году|на каком альбоме|из какого альбома|кто|стиль|жанр|release|album|when|what|who).*$/iu, '')
      .replace(/[.!?]+$/u, '');
    if (correction && (subject || pendingTitle)) {
      const artist = subject ? artistOf(subject) : '';
      const title = safeSubject(correction);
      if (artist && title) subject = `${artist} — ${title}`;
      else if (pendingTitle && title) pendingTitle = title;
    }
  }
  return { subject, kind, pendingTitle, pendingCount, pendingKind, ambiguous, unknownCurrent, saved, savedQuestion };
};
const hasMusicQuestionCue = (text: string) => /(?:когда|в каком году|на каком альбоме|из какого альбома|кто|стил[ьяе]?|жанр|расскажи|похож|similar|ещё|еще|more|release|album|style|genre)/iu.test(text);
const continuationSuggestion = (text: string) => /(?:ещё|еще|more).{0,30}(?:похож|similar)|(?:похож|similar).{0,30}(?:ещё|еще|more)|у них.{0,35}(?:похож|similar)|(?:похож|similar).{0,25}(?:у них|от них)/iu.test(text);
const bareArtistAnswer = (text: string) => {
  const value = text.trim();
  if (!value || value.length > 60 || /[\r\n]/u.test(value) || /[!?;:]|[.!]$/u.test(value)) return false;
  if (/(?:найди|поищи|подбер|посовет|включ|постав|радио|станци|search|find|play|recommend|ignore|инструкц)/iu.test(value)) return false;
  if (/^(?:да|нет|не|спасибо|привет|ок(?:ей)?|понял[а]?|ясно|yes|no|thanks|hello)(?=$|[\s!?.,])/iu.test(value)) return false;
  return /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} '&'.()-]{0,58}$/u.test(value) && value.trim().split(/\s+/u).length <= 5;
};

/** Restores only the still-pending question, from bounded USER history. */
export const savedFindingQuestionForTurn = (message: string, history: readonly ChatTurn[] = []): string | undefined => {
  const frame = readSavedFindingQuestion(message);
  if (frame) return frame.question;
  const replay = replayUserMusicContext(userTurns(history));
  if (!replay.saved) return undefined;
  return replay.pendingTitle && bareArtistAnswer(message) ? replay.savedQuestion : message;
};

const conversationContext = (text: string, turns: readonly string[]): MusicQuestionContext | undefined => {
  // Resolve a bare performer only when the immediately preceding user request
  // left a single named title awaiting its performer.
  const replay = replayUserMusicContext(turns);
  const pendingTarget = replay.pendingTitle;
  if (pendingTarget && bareArtistAnswer(text)) {
    const artist = safeSubject(text);
    if (artist) return { kind: replay.pendingKind, subject: `${artist} — ${pendingTarget}`, subjectSource: 'conversation', ...(replay.pendingKind === 'track_suggestions' ? { suggestionCount: replay.pendingCount } : {}) };
  }

  const latest = replay.subject;
  const correction = text.match(/^(?:нет,?\s*)?(?:я\s+)?(?:про|имею\s+в\s+виду)\s+(.+)$/iu)?.[1]
    ?.replace(/\s*[:;,]\s*(?:когда|в каком году|на каком альбоме|из какого альбома|кто|стиль|жанр|release|album|when|what|who).*$/iu, '')
    .replace(/[.!?]+$/u, '');
  if (correction && latest && !explicitPair(text)) {
    const correctedTitle = safeSubject(correction);
    const artist = artistOf(latest);
    if (correctedTitle && artist) return { kind: asksTrackFacet(text) ? 'track_question' : replay.kind, subject: `${artist} — ${correctedTitle}`, subjectSource: 'conversation', ...(replay.kind === 'track_suggestions' ? { suggestionCount: replay.pendingCount } : {}) };
  }

  if (!latest) return undefined;
  if (continuationSuggestion(text)) {
    const artist = artistOf(latest);
    if (/у них|от них|their|by them/iu.test(text) && artist) return { kind: 'track_suggestions', subject: artist, subjectSource: 'conversation', suggestionCount: suggestionCount(text), sameArtist: true };
    return { kind: 'track_suggestions', subject: latest, subjectSource: 'conversation', suggestionCount: suggestionCount(text) };
  }
  if (isEllipticalMusicFollowup(text)) {
    if (/^(?:а\s*)?кто\s+(?:он|она|они|это)(?:\s|[?!.,]|$)/iu.test(text.trim())) return undefined;
    return { kind: 'track_question', subject: latest, subjectSource: 'conversation' };
  }
  return undefined;
};

/** Builds a bounded, stable English search query from the resolved music context. */
export const buildMusicFactQuery = (context: MusicQuestionContext, question: string) => {
  const subject = safeSubject(context.subject);
  let query: string;
  if (context.kind === 'track_suggestions') {
    query = context.sameArtist ? `${subject} songs by the same artist` : `songs similar to ${subject}`;
  } else if (context.kind === 'artist_question') {
    const artist = safeSubject(subject.split(/\s+[—–-]\s+/u)[0] || subject);
    query = `${artist} artist biography career history`;
  } else if (/(?:когда|в каком году|на каком альбоме|из какого альбома|с какого альбома|release|album|date)/iu.test(question)) {
    query = `${subject} song release date album`;
  } else if (/(?:стил[ьяе]?|жанр|genre|style|instrumentation)/iu.test(question)) {
    query = `${subject} song musical genre style instrumentation`;
  } else {
    query = `${subject} song background performer musical style`;
  }
  return query.slice(0, 500);
};

/** Resolves only a small set of music knowledge and specific-track suggestion requests. */
export const resolveMusicQuestionContext = (
  message: string,
  currentTrack?: string,
  history: readonly ChatTurn[] = []
): MusicQuestionResolution => {
  let text = String(message || '').trim();
  const playerSubject = safeSubject(currentTrack || '');
  const turns = userTurns(history);
  const frame = readSavedFindingQuestion(text);
  if (frame) {
    const framed = framedResolution(frame);
    if (framed) return framed;
    text = frame.question;
  }
  if (!text || hasExplicitRadioIntent(text) || requestedGenreRefinement(text)) return { status: 'skip' };
  if ((text.match(/\s+[—–-]\s+/gu) || []).length > 1 && hasMusicQuestionCue(text)) return { status: 'clarify', reason: 'ambiguous_reference' };
  const replay = replayUserMusicContext(turns);
  if (replay.saved && savedUnrelatedTopic(text)) return { status: 'skip' };
  const replacementTitle = replay.saved ? namedSavedTrack(text) : undefined;
  if (replacementTitle) return { status: 'clarify', reason: 'missing_artist', subject: replacementTitle };
  if (replay.saved && replay.pendingTitle && bareArtistAnswer(text) && !savedTrack(`${text} — ${replay.pendingTitle}`)) {
    return { status: 'clarify', reason: 'missing_artist', subject: replay.pendingTitle };
  }
  if (replay.saved && savedMusicQuestion(text) && !explicitPair(text) && !explicitlyRequestsLiveSong(text) &&
      (currentReference(text) || savedShortAnalysisQuestion(text) || savedFacetQuestion(text) || /^(?:а\s+)?(?:о ч[её]м|про что|смысл|текст|lyrics|what is).*/iu.test(text))) {
    if (replay.pendingTitle) return { status: 'clarify', reason: 'missing_artist', subject: replay.pendingTitle };
    if (!replay.subject) return { status: 'clarify', reason: 'missing_subject' };
    return { status: 'resolved', context: {
      kind: isTrackSuggestion(text) ? 'track_suggestions' : isArtistQuestion(text) && !asksTrackFacet(text) ? 'artist_question' : 'track_question',
      subject: replay.subject, subjectSource: 'conversation',
      ...(isTrackSuggestion(text) ? { suggestionCount: suggestionCount(text) } : {})
    } };
  }
  if (replay.ambiguous && hasMusicQuestionCue(text) && !explicitPair(text) && !currentReference(text)) return { status: 'clarify', reason: 'ambiguous_reference' };
  if (replay.unknownCurrent && isEllipticalMusicFollowup(text) && !explicitPair(text) && !currentReference(text)) return { status: 'clarify', reason: 'missing_subject' };
  if (replay.kind === 'artist_question' && replay.subject && !explicitPair(replay.subject) && isEllipticalMusicFollowup(text) && !explicitPair(text) && !currentReference(text)) {
    if (/(?:когда|в каком году|на каком альбоме|из какого альбома|с какого альбома|release|album|date)/iu.test(text)) {
      return { status: 'clarify', reason: 'missing_subject' };
    }
    if (/(?:стил[ьяе]?|жанр|style|genre)/iu.test(text)) {
      return { status: 'resolved', context: { kind: 'artist_question', subject: replay.subject, subjectSource: 'conversation' } };
    }
  }

  const correctionTitle = text.match(/^(?:нет,?\s*)?(?:я\s+)?(?:про|имею\s+в\s+виду)\s+(.+)$/iu)?.[1]
    ?.replace(/\s*[:;,]\s*(?:когда|в каком году|на каком альбоме|из какого альбома|кто|стиль|жанр|release|album|when|what|who).*$/iu, '')
    .replace(/[.!?]+$/u, '');
  if (correctionTitle && replay.pendingTitle && !replay.subject) {
    return { status: 'clarify', reason: 'missing_artist', subject: safeSubject(correctionTitle) };
  }

  // A bare pronoun can point to a song from an earlier turn while live metadata
  // has already advanced. Never silently retarget it to the new player title.
  if (barePronounQuestion(text)) {
    const continuation = conversationContext(text, turns);
    if (continuation) return { status: 'resolved', context: continuation };
    const priorMusicContext = turns.some(turn => explicitPair(turn) || /(?:песн|трек|композиц|сингл|исполнител|артист|групп|музык|song|track|artist|band)/iu.test(turn));
    return priorMusicContext ? { status: 'clarify', reason: 'ambiguous_reference' } : { status: 'skip' };
  }

  const pair = explicitPair(text);
  const suggestions = isTrackSuggestion(text);
  const suggestionTarget = suggestions ? explicitSuggestionTarget(text) : undefined;
  const artistQuestion = !suggestions && isArtistQuestion(text) && !asksTrackFacet(text);
  const metadataQuestion = /(?:расскажи(?:\s+мне)?\s+(?:про|о|об)|когда|в каком году|на каком альбоме|из какого альбома|с какого альбома|кто|стиль|жанр|release|album|style|genre|performer|artist)/iu.test(text);
  const trackQuestion = !suggestions && (isTrackQuestion(text) || Boolean(pair && metadataQuestion));
  if (!pair && !currentReference(text)) {
    const continued = conversationContext(text, turns);
    if (continued) return { status: 'resolved', context: continued };
  }
  if (!suggestions && !artistQuestion && !trackQuestion) return { status: 'skip' };

  const artist = artistQuestion ? namedArtist(text) : undefined;
  if (suggestions && suggestionTarget && !pair) {
    return { status: 'clarify', reason: 'missing_artist', subject: suggestionTarget };
  }
  const explicitSubject = pair || suggestionTarget || artist;
  if (explicitSubject) return { status: 'resolved', context: {
    kind: suggestions ? 'track_suggestions' : artistQuestion ? 'artist_question' : 'track_question',
    subject: safeSubject(explicitSubject),
    subjectSource: 'explicit',
    ...(suggestions ? { suggestionCount: suggestionCount(text) } : {})
  } };

  if (artistQuestion) {
    if (playerSubject && (currentReference(text) || /(?:этой песни|этого трека|this song|this track)/iu.test(text))) return {status:'resolved',context:{kind:'artist_question',subject:playerSubject,subjectSource:'current_track'}};
    return {status:'clarify',reason:'missing_subject'};
  }

  if (currentReference(text)) {
    if (playerSubject) return { status: 'resolved', context: {
      kind: suggestions ? 'track_suggestions' : 'track_question',
      subject: playerSubject,
      subjectSource: 'current_track',
      ...(suggestions ? { suggestionCount: suggestionCount(text) } : {})
    } };
    return { status: 'clarify', reason: 'missing_subject' };
  }

  return { status: 'clarify', reason: 'missing_subject' };
};
