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
    toggleSpin: 'Вращение'
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
    openRegion: 'Открыть глобус'
  },
  account: {
    title: 'Аккаунт',
    signInAndSync: 'Войти и синхронизировать'
  },
  settings: {
    generalTitle: 'Настройки',
    skinModeLabel: 'Режим скина Winamp',
    skinModeDesc: 'Ищи, примеряй, загружай и применяй скины Winamp в одном месте.'
  },
  skin: {
    kicker: 'Skin Lab',
    title: 'Skin Lab',
    openLab: 'Открыть Skin Lab',
    current: 'Текущий скин',
    resetClassic: 'Вернуть классику',
    preview: 'Превью',
    libraryTitle: 'Библиотека',
    libraryCopy: 'Ищи в Webamp Skin Museum или выбери встроенный пресет.',
    museum: 'Museum',
    preset: 'Пресет',
    uploadTitle: 'Загрузка',
    uploadCopy: 'Предпросмотр .wsz или .zip только на эту сессию.',
    uploadAction: 'Загрузить .wsz',
    uploading: 'Читаем скин...',
    uploadInvalid: 'Выбери .wsz или .zip файл.',
    uploadFailed: 'Не удалось прочитать скин',
    uploaded: 'Загружено',
    placeholder: 'Поиск по skins.webamp.org',
    searching: 'Ищем скины...',
    searchFailed: 'Не удалось найти скины',
    noResults: 'Совпадений не найдено.',
    resultsLabel: 'Результаты поиска скинов'
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
