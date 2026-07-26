/**
 * The chips on Lira's welcome screen.
 *
 * They used to be one hard-coded four: the same «Ночное», «Лоу-фай», «Токио»,
 * «Энергия» on every open, which reads as decoration rather than an invitation
 * — owner: «хотелось бы, чтобы подсказки были разные, а не одни и те же».
 *
 * Three sources of variety, in priority order:
 *   1. WHAT IS PLAYING. If a station is on air, the most useful thing to ask is
 *      about it — and that chip cannot exist until there is something to ask
 *      about, so it is genuinely new each time the station changes.
 *   2. TIME OF DAY. «Что послушать под утро» at 07:00 and «Ночное» at 02:00.
 *   3. ROTATION over the remaining pool, so two consecutive opens differ.
 *
 * Selection is computed once per open (see the seed argument) rather than per
 * render — chips that reshuffle under the user's finger are worse than chips
 * that repeat.
 */

export type ChatPromptSpec = {
  /** Stable id — also the React key, so rotation never reuses a key. */
  id: string;
  labelKey: string;
  queryKey: string;
  /** Interpolation for the query, e.g. the station name. */
  params?: Record<string, string>;
  path: string;
};

const ICON = {
  moon: 'M12 3a9 9 0 1 0 9 9 7.2 7.2 0 0 1-9-9Z',
  headphones:
    'M6 9v7a3 3 0 0 0 3 3h1v-8H8a6 6 0 0 1 12 0h-2v8h1a3 3 0 0 0 3-3v-7a10 10 0 0 0-20 0v7a3 3 0 0 0 3 3h1V9Z',
  tower: 'M11 2h2l1 5 4 14h-2l-1.1-4H9.1L8 21H6l4-14 1-5Zm-1.35 13h4.7L12 6.55 9.65 15Z',
  bolt: 'M13.2 2 5 13h6l-.8 9L19 10h-6l.2-8Z',
  sunrise: 'M12 4l3.5 4h-7L12 4ZM3 14h18v2H3v-2Zm2 4h14v2H5v-2Z',
  focus: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9Z',
  road: 'M11 3h2v4h-2V3Zm0 6h2v6h-2V9Zm0 8h2v4h-2v-4ZM5 3h2v18H5V3Zm12 0h2v18h-2V3Z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2c1.6 0 3.4 2.4 3.9 6H8.1C8.6 6.4 10.4 4 12 4Zm-7.7 8H8c0 1.4.1 2.7.3 4H5.1A8 8 0 0 1 4.3 12Z',
  spark: 'M12 2l1.9 5.6L19.5 9l-4.4 3.2 1.6 5.6L12 14.6 7.3 17.8l1.6-5.6L4.5 9l5.6-1.4L12 2Z',
  vinyl: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
  note: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z'
} as const;

/** Asked ABOUT the thing currently on air — only offered when it exists. */
const contextPrompts = (station?: string, track?: string): ChatPromptSpec[] => {
  const out: ChatPromptSpec[] = [];
  if (track) {
    out.push({
      id: 'ctx-track',
      labelKey: 'chat.promptThisTrack',
      queryKey: 'chat.promptThisTrackQuery',
      params: { track },
      path: ICON.note
    });
  }
  if (station) {
    out.push({
      id: 'ctx-station',
      labelKey: 'chat.promptThisStation',
      queryKey: 'chat.promptThisStationQuery',
      params: { station },
      path: ICON.tower
    });
    out.push({
      id: 'ctx-similar',
      labelKey: 'chat.promptSimilar',
      queryKey: 'chat.promptSimilarQuery',
      params: { station },
      path: ICON.vinyl
    });
  }
  return out;
};

export type TimeBucket = 'night' | 'morning' | 'day' | 'evening';

export const timeBucketOf = (hour: number): TimeBucket => {
  if (hour < 6) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 18) return 'day';
  return 'evening';
};

const TIME_PROMPTS: Record<TimeBucket, ChatPromptSpec> = {
  night: { id: 'time-night', labelKey: 'chat.promptNight', queryKey: 'chat.promptNightQuery', path: ICON.moon },
  morning: { id: 'time-morning', labelKey: 'chat.promptMorning', queryKey: 'chat.promptMorningQuery', path: ICON.sunrise },
  day: { id: 'time-focus', labelKey: 'chat.promptFocus', queryKey: 'chat.promptFocusQuery', path: ICON.focus },
  evening: { id: 'time-evening', labelKey: 'chat.promptEvening', queryKey: 'chat.promptEveningQuery', path: ICON.headphones }
};

/** Everything else, rotated through so repeat visits are not identical. */
const POOL: ChatPromptSpec[] = [
  { id: 'lofi', labelKey: 'chat.promptLofi', queryKey: 'chat.promptLofiQuery', path: ICON.headphones },
  { id: 'tokyo', labelKey: 'chat.promptTokyo', queryKey: 'chat.promptTokyoQuery', path: ICON.tower },
  { id: 'energy', labelKey: 'chat.promptEnergy', queryKey: 'chat.promptEnergyQuery', path: ICON.bolt },
  { id: 'road', labelKey: 'chat.promptRoad', queryKey: 'chat.promptRoadQuery', path: ICON.road },
  { id: 'faraway', labelKey: 'chat.promptFaraway', queryKey: 'chat.promptFarawayQuery', path: ICON.globe },
  { id: 'surprise', labelKey: 'chat.promptSurprise', queryKey: 'chat.promptSurpriseQuery', path: ICON.spark },
  { id: 'retro', labelKey: 'chat.promptRetro', queryKey: 'chat.promptRetroQuery', path: ICON.vinyl }
];

export const CHAT_PROMPT_COUNT = 4;

/**
 * @param seed increments once per welcome-screen appearance, so the rotation
 *   advances between opens but is stable while one is on screen.
 */
export const pickChatPrompts = ({
  seed,
  hour,
  station,
  track
}: {
  seed: number;
  hour: number;
  station?: string;
  track?: string;
}): ChatPromptSpec[] => {
  const chosen: ChatPromptSpec[] = [];
  const seen = new Set<string>();
  const take = (prompt?: ChatPromptSpec) => {
    if (!prompt || seen.has(prompt.id) || chosen.length >= CHAT_PROMPT_COUNT) return;
    seen.add(prompt.id);
    chosen.push(prompt);
  };

  // Context first — but at most two, so the chips never become a single topic.
  const context = contextPrompts(station, track);
  const contextSlots = Math.min(2, context.length);
  for (let i = 0; i < contextSlots; i += 1) {
    take(context[(seed + i) % context.length]);
  }

  take(TIME_PROMPTS[timeBucketOf(hour)]);

  for (let i = 0; chosen.length < CHAT_PROMPT_COUNT && i < POOL.length; i += 1) {
    take(POOL[(seed * 3 + i) % POOL.length]);
  }

  return chosen;
};
