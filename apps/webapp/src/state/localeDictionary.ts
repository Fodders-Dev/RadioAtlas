import type { DictionaryTree, DictionaryValue, Locale } from './locales/types';

export type { DictionaryTree, DictionaryValue, Locale } from './locales/types';

export const defaultDictionary: DictionaryTree = {
  app: {
    title: 'RadioAtlas',
    subtitle: 'World radio in your pocket',
    liveBadge: 'Live',
    catalogCount: '{count} stations',
    queueCount: '{count} queued',
    nowPlayingLabel: 'Now playing',
    playbackIssue: 'Playback issue',
    metadataUnavailable: 'Metadata unavailable'
  },
  common: {
    loading: 'Loading',
    close: 'Close',
    play: 'Play',
    pause: 'Pause',
    next: 'Next'
  },
  nav: {
    home: 'Главная',
    search: 'Поиск',
    globe: 'Глобус',
    library: 'Библиотека',
    settings: 'Настройки'
  },
  home: {
    topbarSubtitle: 'Открой что-то новое и сразу включай',
    topbarSubtitleCompact: 'Найди новую станцию',
    topbarContext: 'Discovery'
  },
  search: {
    topbarSubtitle: 'Поиск по станциям, странам и жанрам',
    kicker: 'Search'
  },
  explore: {
    globeSubtitle: 'Путешествуй по радиоэфиру мира'
  },
  globe: {
    heroSubtitle: 'Крути карту и проваливайся в эфир'
  },
  library: {
    topbarSubtitle: 'Твоё избранное, очередь и история',
    kicker: 'Library'
  },
  account: {
    title: 'Аккаунт',
    signInAndSync: 'Войти и синхронизировать'
  },
  settings: {
    generalTitle: 'Настройки'
  },
  playlist: {
    title: 'Очередь'
  },
  dock: {
    liveNow: 'Сейчас в эфире',
    ready: 'Готово к запуску',
    volume: 'Громкость',
    queueOpen: 'Открыть очередь',
    queuePeekEmpty: 'Очередь пока пуста',
    copiedTracksOpen: 'Треки',
    currentTrackUnavailable: 'Трек пока не определён',
    emptyTitle: 'Выбери станцию',
    emptySubtitle: 'Поиск, глобус и библиотека уже готовы',
    peekLabel: 'Мини-плеер',
    peekHint: 'Подними плеер',
    queueProgress: '{current} из {total}',
    copyCurrentTrack: 'Скопировать трек'
  },
  stationTable: {
    favorite: 'В избранное',
    unfavorite: 'Убрать из избранного'
  },
  radio: {
    deepLink: 'Из ссылки',
    queueDefault: 'Очередь',
    openWinamp: 'Открыть плеер'
  }
};

export const loadDictionary = async (locale: Locale): Promise<DictionaryTree> => {
  if (locale === 'en') {
    const module = await import('./locales/en');
    return module.enDictionary;
  }
  const module = await import('./locales/ru');
  return module.ruDictionary;
};
