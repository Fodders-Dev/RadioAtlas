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
    clear: 'Очистить',
    play: 'Play',
    pause: 'Pause',
    next: 'Next',
    previous: 'Previous',
    actions: 'Actions',
    back: 'Назад',
    save: 'Сохранить',
    cancel: 'Отмена',
    apply: 'Применить',
    active: 'Активно',
    view: 'Открыть'
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
    topbarContext: 'Discovery',
    catalogUnavailableTitle: 'Каталог сейчас не отвечает',
    catalogUnavailableCopy: 'Поиск и плеер всё ещё доступны. Попробуй обновить витрину.'
  },
  search: {
    topbarSubtitle: 'Поиск по станциям, странам и жанрам',
    kicker: 'Search',
    playAllResults: 'Играть выдачу',
    queueFromQuery: 'Поиск: {query}'
  },
  explore: {
    globeSubtitle: 'Путешествуй по радиоэфиру мира'
  },
  globe: {
    heroSubtitle: 'Крути карту и проваливайся в эфир',
    controlsHintDesktop: 'Тяни · колесо · точка',
    controlsHintMobile: 'Тяни · pinch · точка',
    tuneHere: 'Поймать здесь',
    nearby: 'Станции рядом',
    toggleSpin: 'Вращение',
    playRegionRadio: 'Слушать регион'
  },
  library: {
    topbarSubtitle: 'Твоё избранное, очередь и история',
    kicker: 'Library',
    collectionAdded: '{station} добавлена в {collection}',
    collectionCreated: 'Коллекция создана: {name}',
    collectionRenamed: 'Коллекция переименована: {name}',
    openCollection: 'Открыть',
    seeAllStations: 'Все станции',
    collectionOpenHint: 'Открой, чтобы слушать и убирать станции.',
    removeStationFromCollection: 'Убрать {station} из коллекции',
    playCollection: 'Слушать',
    shuffleCollection: 'Вперемешку',
    renameCollection: 'Переименовать',
    renameCollectionPrompt: 'Новое название',
    moveUp: 'Выше',
    moveDown: 'Ниже',
    moveStationUp: 'Поднять {station}',
    moveStationDown: 'Опустить {station}',
    reorderMode: 'Порядок',
    reorderDone: 'Готово',
    unfollow: 'Отписаться',
    openRegion: 'Открыть глобус',
    alertsEnabled: 'Алерты вкл.',
    alertsDisabled: 'Алерты выкл.',
    botOptIn: 'Включить бота',
    botOptedIn: 'Бот включён',
    digestPlay: 'Слушать'
  },
  retention: {
    'continue-yesterdayTitle': 'Продолжить вчерашний эфир',
    'continue-yesterdayBody': '{stations}',
    'morning-mixTitle': 'Утренний radio mix',
    'morning-mixBody': '{stations}',
    'evening-mixTitle': 'Вечерний radio mix',
    'evening-mixBody': '{stations}',
    stationBackOnlineTitle: '{station} снова доступна',
    stationBackOnlineBody: 'Можно вернуться к эфиру.',
    trackAvailableTitle: '{station}: новый трек',
    trackAvailableBody: '{track}',
    regionActivityTitle: 'Новый эфир: {region}',
    regionActivityBody: '{station}'
  },
  account: {
    title: 'Аккаунт',
    signInAndSync: 'Войти и синхронизировать'
  },
  settings: {
    generalTitle: 'Настройки',
    skinModeLabel: 'Theme Studio',
    skinModeDesc: 'Сохраняй и применяй локальные темы RadioAtlas.'
  },
  playlist: {
    title: 'Очередь'
  },
  dock: {
    liveNow: 'Сейчас в эфире',
    ready: 'Готово к запуску',
    volume: 'Громкость',
    mute: 'Выключить звук',
    unmute: 'Вернуть звук',
    queueOpen: 'Открыть очередь',
    queuePeekEmpty: 'Очередь пока пуста',
    queueEmptyCta: 'Искать станции',
    copiedTracksOpen: 'Треки',
    currentTrackUnavailable: 'Трек пока не определён',
    emptyTitle: 'Выбери станцию',
    emptySubtitle: 'Поиск, глобус и библиотека уже готовы',
    peekLabel: 'Мини-плеер',
    peekHint: 'Подними плеер',
    queueProgress: '{current} из {total}',
    copyCurrentTrack: 'Скопировать трек',
    openWinamp: 'Открыть плеер'
  },
  details: {
    close: 'Закрыть',
    streamTrust: 'Надёжность',
    trustGood: 'Хорошая',
    trustWeak: 'Нестабильная',
    trustBad: 'Сломана недавно',
    trustUnknown: 'Нет данных',
    preferredTransport: 'Лучший поток',
    recentTracks: 'Недавние треки',
    recentTracksEmpty: 'Треки этой станции пока не сохранялись.',
    reportBroken: 'Пожаловаться',
    hideFromRecommendations: 'Скрыть',
    showInRecommendations: 'Вернуть'
  },
  winamp: {
    currentStation: 'Текущая станция',
    recentTracks: 'Недавние треки',
    stationDetails: 'Детали',
    hideStation: 'Скрыть',
    showStation: 'Вернуть'
  },
  toast: {
    stationHidden: '{station} скрыта из рекомендаций',
    stationUnhidden: '{station} вернулась в рекомендации',
    stationReportedBroken: 'Спасибо, пометили {station} как проблемную'
  },
  stationTable: {
    favorite: 'В избранное',
    unfavorite: 'Убрать из избранного'
  },
  // T_mobile_1 B: the home-station tile is role="button" with this aria-label
  // — keep it in defaultDictionary so the accessible name resolves on the very
  // first paint (before the async ru/en bundle finishes loading).
  stationTile: {
    playLabel: 'Слушать: {name}'
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
