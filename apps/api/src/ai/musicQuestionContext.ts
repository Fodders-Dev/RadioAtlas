import { sanitizeSnippet } from './untrustedData.js';
import { requestedGenreRefinement } from './genreRefinement.js';
import type { ChatTurn, WebSource } from './types.js';

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
const replayUserMusicContext = (turns: readonly string[]) => {
  let subject: string | undefined;
  let kind: MusicExpertiseKind = 'track_question';
  let pendingTitle: string | undefined;
  let pendingCount = 3;
  let ambiguous = false;
  let unknownCurrent = false;
  for (const turn of turns) {
    if (currentReference(turn) && !explicitPair(turn)) {
      subject = undefined;
      pendingTitle = undefined;
      ambiguous = false;
      unknownCurrent = true;
      continue;
    }
    if (isUnrelatedBarrier(turn)) {
      subject = undefined;
      pendingTitle = undefined;
      ambiguous = false;
      unknownCurrent = false;
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
      continue;
    }
    const historicalArtist = isArtistQuestion(turn) ? namedArtist(turn) : undefined;
    if (historicalArtist) {
      subject = historicalArtist;
      kind = 'artist_question';
      pendingTitle = undefined;
      ambiguous = false;
      unknownCurrent = false;
      continue;
    }
    const target = isTrackSuggestion(turn) ? explicitSuggestionTarget(turn) : undefined;
    if (target) {
      pendingTitle = target;
      pendingCount = suggestionCount(turn) || 3;
      subject = undefined;
      ambiguous = false;
      unknownCurrent = false;
      continue;
    }
    if (pendingTitle && bareArtistAnswer(turn)) {
      const artist = safeSubject(turn);
      if (artist) {
        subject = `${artist} — ${pendingTitle}`;
        kind = 'track_suggestions';
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
  return { subject, kind, pendingTitle, pendingCount, ambiguous, unknownCurrent };
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

const conversationContext = (text: string, turns: readonly string[]): MusicQuestionContext | undefined => {
  // Resolve a bare performer only when the immediately preceding user request
  // left a single named title awaiting its performer.
  const replay = replayUserMusicContext(turns);
  const pendingTarget = replay.pendingTitle;
  if (pendingTarget && bareArtistAnswer(text)) {
    const artist = safeSubject(text);
    if (artist) return { kind: 'track_suggestions', subject: `${artist} — ${pendingTarget}`, subjectSource: 'conversation', suggestionCount: replay.pendingCount };
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
  const text = String(message || '').trim();
  const playerSubject = safeSubject(currentTrack || '');
  const turns = userTurns(history);
  if (!text || hasExplicitRadioIntent(text) || requestedGenreRefinement(text)) return { status: 'skip' };
  if ((text.match(/\s+[—–-]\s+/gu) || []).length > 1 && hasMusicQuestionCue(text)) return { status: 'clarify', reason: 'ambiguous_reference' };
  const replay = replayUserMusicContext(turns);
  if (replay.ambiguous && hasMusicQuestionCue(text) && !explicitPair(text) && !currentReference(text)) return { status: 'clarify', reason: 'ambiguous_reference' };
  if (replay.unknownCurrent && isEllipticalMusicFollowup(text) && !explicitPair(text) && !currentReference(text)) return { status: 'clarify', reason: 'missing_subject' };
  if (replay.kind === 'artist_question' && replay.subject && isEllipticalMusicFollowup(text) && !explicitPair(text) && !currentReference(text)) {
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
