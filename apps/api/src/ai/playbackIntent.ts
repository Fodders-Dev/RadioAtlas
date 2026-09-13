// A negative playback instruction takes precedence over a play verb elsewhere
// in the same request. Keep this check in the final action policy as well as
// the recommendation worker, so model/fallback paths cannot bypass it.
const NO_PLAYBACK_RU = /(?:^|[^\p{L}])(?:не|без)\s+(?:(?:надо|нужно|стоит|хочу|пожалуйста|пока|сейчас|ничего|мне|его|её|ее|это|сам|сама|автоматически)\s+){0,4}(?:включ\p{L}*|запуск\p{L}*|запуст\p{L}*|проигрыв\p{L}*|воспроизвод\p{L}*|вруб\p{L}*|став\p{L}*|звук\p{L}*|автозапуск\p{L}*)/iu;
const NO_PLAYBACK_EN = /\b(?:do\s+not|don['’]t|never|without|no)\s+(?:(?:please|start|any|automatic|automatically)\s+){0,3}(?:play\w*|start\w*|autoplay\w*|sound|audio)\b/i;

export const isPlaybackProhibited = (message: string): boolean =>
  NO_PLAYBACK_RU.test(message) || NO_PLAYBACK_EN.test(message);

export const hasPlayIntent = (message: string): boolean =>
  /(включ|постав|вруб|запусти|давай\s+послуша)/i.test(message) &&
  !isPlaybackProhibited(message);
