/**
 * Which language a "what is this song?" question is really about.
 *
 * THE BUG THIS FIXES: asking «Жасмин - Головоломка, че за песня?» returned five
 * stations from France, Switzerland, Türkiye, an Arabic-pop channel and the USA
 * — and on the smaller model, five CHIPTUNE stations. The answer text was fine;
 * the attached stations ignored the fact that the artist is Russian.
 *
 * The planner searches with a bare genre like `pop`, and a bare `pop` search is
 * measured at 2 Russian stations out of 50, while `language=russian` + `pop` is
 * 47 of 50 (#205). The plumbing for that filter already exists — nothing set it.
 *
 * WHY NOT "the message is in Russian": the listener writes every message in
 * Russian, including «найди джаз», which must stay jazz-from-anywhere. The
 * signal is the SUBJECT's script, not the question's. So strip the question
 * chrome and the genre words, then look at what is left:
 *
 *   «Жасмин - Головоломка. Че за песня?»   -> «Жасмин Головоломка»   Cyrillic
 *   «Robert Miles - Children что это»      -> «Robert Miles Children» Latin
 *   «найди джаз»                            -> nothing named
 */

// `\b` is ASCII-only in JavaScript, so it never fires next to Cyrillic. Using it
// here silently left the chrome in place and made every Russian-worded question
// look like a Russian SUBJECT. Explicit separators instead — and String.raw,
// because in a plain template literal `\s` collapses to the letter `s`.
const EDGE = String.raw`(?:^|[\s,.;:!?"'«»()\-–—])`;

const chrome = (body: string) => new RegExp(EDGE + body, 'gi');

/** Question chrome that wraps a named subject, in both languages. */
const QUESTION_CHROME: readonly RegExp[] = [
  chrome(String.raw`(?:а\s+)?(?:что|ч[её])\s+(?:это\s+)?за\s+(?:песн[а-яё]*|трек[а-яё]*|композици[а-яё]*|группа|исполнител[ья])`),
  chrome(String.raw`(?:что|ч[её])\s+(?:это\s+такое|это|такое)`),
  chrome(String.raw`кто\s+(?:это\s+)?(?:по[её]т|исполняет|тако[йя])`),
  chrome(String.raw`(?:расскажи|напиши|объясни|поясни)\s+(?:мне\s+)?(?:про|о|об)?`),
  chrome(String.raw`(?:о\s+ч[её]м|про\s+что)\s+(?:эта\s+)?(?:песн[яю]|трек)`),
  chrome(String.raw`(?:текст|слова|перевод|смысл|значение)(?:\s+(?:песни|трека|композиции))?`),
  chrome(String.raw`what(?:'s|\s+is)?\s+(?:this|that)\s+(?:song|track)`),
  chrome(String.raw`who\s+(?:is\s+)?(?:sings?|singing|performs?)`),
  chrome(String.raw`tell\s+me\s+about`),
  chrome(String.raw`(?:song\s+)?(?:meaning|lyrics|translation)`)
];

/**
 * Words that are filler, commands or GENRES — never a proper noun. Genres matter
 * most here: «найди джаз» must not become Russian-only jazz, which is the exact
 * opposite of what the listener asked for.
 */
const GENERIC_WORDS = new RegExp(
  '^(?:' +
    [
      // filler and commands
      'песн[а-яё]*', 'трек[а-яё]*', 'композици[а-яё]*', 'музык[а-яё]*', 'радио', 'станци[а-яё]*',
      'это', 'эта', 'этот', 'эту', 'как', 'где', 'когда', 'почему', 'зачем',
      'пожалуйста', 'спасибо', 'привет', 'давай', 'можешь', 'хочу', 'хочется',
      'найди', 'включи', 'поставь', 'скинь', 'дай', 'пришли', 'покажи', 'посоветуй',
      'что', 'ч[её]', 'кто', 'чей', 'мне', 'мой', 'моя', 'там', 'тут', 'вот',
      'очень', 'такой', 'такая', 'такое', 'такие', 'нибудь', 'хорошо', 'ладно', 'ок', 'окей',
      'теперь', 'ещ[её]', 'тоже', 'только', 'но', 'и', 'а', 'же', 'ну', 'да', 'нет',
      // genres and moods — Cyrillic spellings the listener actually uses
      'джаз[а-яё]*', 'рок[а-яё]*', 'поп[а-яё]*', 'транс[а-яё]*', 'техно',
      'хаус[а-яё]*', 'метал[а-яё]*', 'шансон[а-яё]*', 'эстрад[а-яё]*',
      'классик[а-яё]*', 'регги', 'блюз[а-яё]*', 'фанк[а-яё]*', 'диско',
      'лаундж[а-яё]*', 'лаунж[а-яё]*', 'эмбиент[а-яё]*', 'амбиент[а-яё]*',
      'р[эе]п[а-яё]*', 'хип-?хоп[а-яё]*', 'инди', 'панк[а-яё]*', 'электрон[а-яё]*',
      'спокойн[а-яё]*', 'весел[а-яё]*', 'бодр[а-яё]*', 'вечер[а-яё]*', 'утр[а-яё]*',
      'ноч[а-яё]*', 'фон[а-яё]*', 'работ[а-яё]*', 'послушать', 'поставить',
      'включить', 'слушать', 'играет', 'звучит', 'вышла', 'вышел',
      // latin filler
      'something', 'song', 'track', 'music', 'radio', 'station', 'this', 'that',
      'what', 'who', 'please', 'ok', 'okay'
    ].join('|') +
    ')$',
  'i'
);

const CYRILLIC = /[Ѐ-ӿ]/;

const stripChrome = (message: string): string => {
  let text = String(message || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const pattern of QUESTION_CHROME) {
    text = text.replace(pattern, ' ');
  }
  return text.replace(/[?!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
};

/** The words in a message that could be a proper noun — an artist or a title. */
export const namedSubjectWords = (message: string): string[] =>
  stripChrome(message)
    .split(/[\s\-—–_/|]+/)
    .filter((word) => word.length > 1 && !GENERIC_WORDS.test(word));

/**
 * `'russian'` when the named subject is written in Cyrillic, otherwise null.
 * Null means "do not constrain" — never "constrain to something else".
 */
export const subjectLanguageScope = (message: string): 'russian' | null => {
  const named = namedSubjectWords(message);
  if (named.length === 0) return null;
  // Every named word Cyrillic -> a Russian-language subject. A mixed or Latin
  // subject (Robert Miles, Radiohead) must not be narrowed to Russian stations.
  return named.every((word) => CYRILLIC.test(word)) ? 'russian' : null;
};
