import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useLocalStorage } from '../lib/useLocalStorage';

export type Locale = 'ru' | 'en';

type DictionaryValue = string | Record<string, DictionaryValue>;

const dictionaries = {
  ru: {
    app: {
      title: 'RadioAtlas',
      subtitle: 'Музыка мира в прямом эфире.',
      liveBadge: 'Эфир',
      liveVersion: 'Сборка'
    },
    nav: {
      home: 'Главная',
      search: 'Поиск',
      globe: 'Глобус',
      library: 'Медиатека',
      settings: 'Настройки',
      Explore: 'Главная',
      Favorites: 'Моё',
      Discover: 'Поиск',
      Playlist: 'Очередь',
      Settings: 'Настройки'
    },
    common: {
      play: 'Слушать',
      pause: 'Пауза',
      resume: 'Продолжить',
      next: 'Дальше',
      clear: 'Очистить',
      close: 'Закрыть',
      copy: 'Копировать',
      share: 'Поделиться',
      info: 'Инфо',
      song: 'Трек',
      site: 'Сайт',
      stream: 'Поток',
      remove: 'Убрать',
      saveReload: 'Сохранить и перезагрузить',
      reset: 'Сбросить',
      show: 'Показать',
      hide: 'Скрыть',
      apply: 'Применить',
      active: 'Активно',
      view: 'Открыть',
      paste: 'Вставить',
      addLink: 'Добавить ссылку',
      importPlaylist: 'Импорт плейлиста',
      importing: 'Импорт...',
      extractStreams: 'Извлечь потоки',
      openApp: 'Открыть приложение',
      openBrowser: 'Открыть в браузере',
      loading: 'Загрузка...',
      unavailable: 'Недоступно',
      unknown: 'Неизвестно'
    },
    locale: {
      language: 'Язык интерфейса',
      languageDesc: 'Русский включен по умолчанию, язык можно переключить в любой момент.',
      russian: 'Русский',
      english: 'English'
    },
    stationTable: {
      empty: 'Станций пока нет.',
      playColumn: 'Эфир',
      nameColumn: 'Станция',
      locationColumn: 'Локация',
      tagsColumn: 'Жанры',
      favoriteColumn: 'Лайк',
      favorite: 'В лайки',
      unfavorite: 'Убрать лайк'
    },
    explore: {
      kicker: 'RadioAtlas x Winamp',
      title: 'Эфир без лишнего шума',
      subtitle:
        'Глобус остается главным входом, а Winamp живет в своей зоне и не съедает экран.',
      heroPill: 'Домашний экран под Winamp',
      mapped: 'На карте',
      favorites: 'Лайков',
      queue: 'В очереди',
      globeTitle: 'Живая карта',
      globeSubtitle: 'Выбирай точку на глобусе и сразу уходи в ближайшие станции.',
      globeFocused: 'Фокус на текущей станции',
      globeTap: 'Нажми на светящуюся точку',
      picksOpen: '{count} станций рядом -> список уже ниже',
      picksHint: 'Нажми на точку -> снизу откроются ближайшие станции',
      quickSearchTitle: 'Быстрый старт',
      quickSearchSubtitle: 'Поиск прямо на главной, без прыжка в другой экран.',
      quickSearchPlaceholder: 'Название, жанр, страна или язык',
      quickSearchIdle: 'Начни искать и сразу добавляй в очередь',
      quickSearchMatches: 'Мгновенных совпадений: {count}',
      resumeTitle: 'Продолжить с того места',
      resumeReady: '{station} уже ждет. Источник: {source}.',
      resumeEmpty: 'Запусти любую станцию с карты или из поиска, чтобы собрать очередь.',
      resumeCurrent: 'Текущая станция',
      resumeStation: 'Продолжить станцию',
      nextPick: 'Следующая находка',
      noQueue: 'Очередь пока пустая.',
      nearbyTitle: 'Станции рядом ({count})',
      nearbySubtitle: 'Сверху самые близкие совпадения. Нажал -> сразу слушаешь.',
      dismissNearby: 'Скрыть',
      resultTitle: 'Результаты поиска',
      trendingTitle: 'Быстрые находки',
      resultSubtitle: 'Поиск работает прямо поверх домашнего экрана.',
      trendingSubtitle: 'Подборка для быстрого старта текущей сессии.',
      favoritesTitle: 'Избранное под рукой',
      favoritesSubtitle: 'Любимые станции на расстоянии одного тапа.',
      favoritesEmpty: 'Поставь лайки станциям, и здесь появится личный быстрый доступ.',
      recentTitle: 'Недавнее',
      recentSubtitle: 'Последние сессии остаются на виду, чтобы эфир жил.',
      recentEmpty: 'Недавно прослушанные станции появятся здесь.',
      searchPicks: 'Подборка из поиска',
      trendingPicks: 'Подборка главной',
      unknownLocation: 'Локация не указана'
    },
    home: {
      kicker: 'Live radio',
      title: 'Радио мира',
      subtitle:
        'Станция, поиск, глобус и очередь в одном спокойном shell. Winamp живет отдельно.',
      openGlobe: 'Открыть глобус',
      openSearch: 'Открыть поиск',
      openLibrary: 'Открыть медиатеку',
      quickMix: 'Быстрый микс',
      quickMixCopy: 'Название, жанр, страна или язык прямо с главного экрана.',
      globeTeaser: 'География эфира',
      globeTeaserCopy: 'Вращай карту и забирай ближайшие станции, не выпадая из сессии.',
      resumeTitle: 'Сейчас и очередь',
      libraryTitle: 'Снимок медиатеки',
      libraryFavoritesCopy: 'Лайкнутые станции для быстрого возврата.',
      libraryRecentCopy: 'Последние сессии без лишнего шума.',
      libraryQueueCopy: 'Текущая очередь и ближайшие переходы.',
      globeMode: 'Geo discovery'
    },
    globe: {
      heroSubtitle: 'Сначала выбери область на сфере, потом спокойно открой станции внутри неё.',
      tapArea: 'Нажми на область с эфиром',
      controlsHint: 'Тяни, чтобы вращать, масштабируй и нажимай на область',
      status: 'Зон: {areas} / геоточек: {mapped} / всего станций: {total}',
      areaSubtitle: '{count} станций',
      mixedArea: 'Смешанная зона',
      idleTitle: 'Выбери точку на глобусе',
      idleCopy: 'Когда нажмёшь на зону с эфиром, здесь появятся ближайшие станции.',
      idleEmpty: 'Пока ничего не выбрано.',
      selectedTitle: '{place} ({count})',
      selectedCopy: 'Масштабируй дальше для более точного выбора. Сейчас открыт список для: {place}.',
      clearSelection: 'Сбросить',
      selectionArea: 'Область',
      selectionCount: 'Станций',
      selectionZoom: 'Масштаб',
      areaSummaryTitle: 'Текущая зона',
      areaSummaryCopy: '{place} · {subtitle}',
      mappedAreas: 'Зон на карте',
      liveQueue: 'Что играет рядом'
    },
    search: {
      kicker: 'Search / links / regions',
      topbarSubtitle: 'Станции и внешние потоки.',
      showFilters: 'Показать фильтры',
      hideFilters: 'Скрыть фильтры'
    },
    library: {
      kicker: 'Личное пространство',
      title: 'Медиатека',
      subtitle: 'Избранное, очередь, недавнее и история теперь собраны в одном месте.',
      topbarSubtitle: 'Избранное, очередь, история.',
      trackJournal: 'Сюда попадают скопированные названия треков.',
      stationHistory: 'История живых станций для быстрого возврата в эфир.',
      tabs: {
        favorites: 'Избранное',
        queue: 'Очередь',
        recent: 'Недавнее',
        history: 'История'
      }
    },
    dock: {
      peekLabel: 'Плеер готов',
      peekHint: 'Нажми, чтобы раскрыть',
      queueCount: 'В очереди: {count}',
      liveNow: 'Сейчас в эфире',
      ready: 'Плеер',
      emptyTitle: 'Выбери станцию',
      emptySubtitle: 'Добавь станцию с главной, поиска или глобуса.',
      openWinamp: 'Winamp'
    },
    favoritesScreen: {
      profileTitle: 'Профиль',
      profileName: 'Ты',
      profileDesc: 'Избранное хранится прямо на этом устройстве.',
      lastPlayed: 'Последняя станция: {station}',
      favorites: 'Лайков',
      recent: 'Недавних',
      journalTitle: 'Журнал треков',
      journalEmpty: 'Скопированные треки появятся здесь.',
      myStations: 'Мои станции',
      recentStations: 'Недавно слушал'
    },
    playlist: {
      title: 'Очередь',
      stationsCount: 'Станций: {count}',
      playCurrent: 'Слушать текущую',
      clearQueue: 'Очистить очередь',
      empty:
        'Запусти станцию с главной, из поиска или избранного, чтобы собрать очередь.',
      playing: 'Играет',
      historyTitle: 'История прослушивания',
      historyEmpty: 'История прослушивания пуста.'
    },
    settings: {
      backgroundTitle: 'Фоновое воспроизведение',
      openBrowserLabel: 'Открыть в системном браузере',
      openBrowserDesc: 'Рекомендуется для стабильного фонового воспроизведения.',
      skinTitle: 'Скин плеера',
      skinModeLabel: 'Режим скина Winamp',
      skinModeDesc: 'Ищи скины на skins.webamp.org и сохраняй выбранный.',
      closeFullscreen: 'Закрыть полноэкранный плеер',
      openFullscreen: 'Открыть полноэкранный плеер',
      generalTitle: 'Параметры',
      apiBaseLabel: 'API base',
      apiBaseDesc: 'Прокси для станций без VPN: trycloudflare или свой сервер.',
      apiPlaceholder: 'https://your-api.example',
      invalidApi: 'Некорректный URL API. Используй https://...',
      cacheLabel: 'Кэш',
      cacheDesc: 'Обновить каталог и данные глобуса.',
      clearCache: 'Очистить кэш',
      favoritesLabel: 'Избранное',
      favoritesDesc: 'Сбросить сохраненные станции.',
      clearFavorites: 'Очистить избранное',
      recentLabel: 'Недавнее',
      recentDesc: 'Очистить локальную историю воспроизведения.',
      clearRecent: 'Очистить недавнее',
      diagnosticsTitle: 'Диагностика',
      debugLabel: 'Режим отладки',
      debugDesc: 'Показывает логи и системную информацию.',
      noLogs: 'Логов пока нет...'
    },
    discover: {
      title: 'Поиск и ресерч',
      subtitle:
        'Один экран для поиска, жанров, регионов и ручного добавления потоков. Browse и Search теперь вместе.',
      stationsMode: 'Станции',
      linksMode: 'Ссылки',
      searchPlaceholder: 'Название, жанр, страна, язык',
      matches: 'Найдено: {count}',
      allStations: 'Всего станций: {count}',
      regionTitle: 'Быстрый заход по регионам',
      regionSubtitle: 'Выбери континент, затем быстро сузь поиск по странам.',
      countriesInRegion: 'Стран в регионе: {count}',
      regionAll: 'Весь мир',
      countrySearchPlaceholder: 'Фильтр по стране',
      tagTitle: 'Жанры, которые можно раскопать',
      tagSubtitle: 'Тап по жанру сразу сузит выдачу.',
      countryTitle: 'Страны рядом с твоим запросом',
      countrySubtitle: 'Подбираем самые плотные каталоги по текущему региону.',
      jumpToCountry: 'Открыть {country}',
      loadMore: 'Показать еще',
      linksTitle: 'Ручные потоки и плейлисты',
      linksSubtitle:
        'Добавляй прямые аудиоссылки, `.m3u` и `.pls`. Непрямые URL можно распаковать через API.',
      linksSaved: 'Сохраненные ссылки',
      linksEmpty: 'Сохраненных ссылок пока нет.',
      linksRecent: 'Недавние ссылки',
      linksRecentEmpty: 'Ссылки начнут появляться после первого запуска.',
      audioPlaceholder: 'Аудиоссылка или плейлист (.m3u/.pls)',
      titlePlaceholder: 'Необязательное название',
      extractorOffline: 'Extractor недоступен. Проверь API URL в настройках.',
      enterValidUrl: 'Введи корректный URL',
      youtubeBlocked: 'Ссылки YouTube здесь отключены',
      extractorMissing: 'Это не прямой аудиопоток. Настрой API и извлеки поток.',
      enterPlaylistUrl: 'Введи корректный URL плейлиста',
      noPlayableUrls: 'В плейлисте не найдено воспроизводимых ссылок',
      noPlayableItems: 'Не найдено воспроизводимых элементов',
      noPlayableStreams: 'Не найдено аудиопотоков',
      apiUnavailable: 'API недоступен',
      extractorNotConfigured: 'Extractor API не настроен',
      clipboardDenied: 'Нет доступа к буферу обмена',
      playLink: 'Слушать ссылку'
    },
    skin: {
      current: 'Текущий скин',
      useDefault: 'Вернуть стандартный',
      placeholder: 'Поиск по skins.webamp.org',
      helper: 'Ищи в Winamp Skin Museum и сохраняй выбранный скин между визитами.',
      searching: 'Ищем скины...',
      searchFailed: 'Не удалось найти скины',
      noResults: 'Совпадений не найдено.',
      resultsLabel: 'Результаты поиска скинов'
    },
    details: {
      closeAria: 'Закрыть карточку станции',
      close: 'Закрыть',
      copyTrack: 'Копировать трек',
      nowPlaying: 'Сейчас играет',
      streamUrl: 'URL потока',
      homepage: 'Сайт',
      country: 'Страна',
      region: 'Регион',
      codec: 'Кодек',
      bitrate: 'Битрейт',
      unknownRegion: 'Неизвестно',
      openTrackCopy: 'Скопировать трек'
    },
    winamp: {
      fullscreen: 'Открыть полноэкранный плеер',
      collapse: 'Свернуть',
      closeWinamp: 'Вернуться в приложение',
      resetLayout: 'Сбросить окна',
      nowTuned: 'Сейчас в эфире',
      upNext: 'Дальше в очереди',
      currentStation: 'Текущая станция',
      recentSessions: 'Недавние сессии',
      queueReady: 'Готово станций: {count}',
      queueCount: 'Станций в очереди: {count}',
      noStation: 'Станция не выбрана',
      buildQueue: 'Собери очередь с главной или через поиск.',
      historyEmpty: 'История прослушивания пуста.',
      loadingShell: 'Загружаем Winamp...',
      loadingFailed: 'Winamp не загрузился. Повторить',
      figmaPlaceholder: 'Заглушка Winamp для Figma capture',
      copyTrackTitle: 'Скопировать название трека',
      trackUnavailable: 'Название трека недоступно'
    },
    radio: {
      queueDefault: 'Очередь воспроизведения',
      favorites: 'Избранное',
      recent: 'Недавние станции',
      searchResults: 'Результаты поиска',
      savedLinks: 'Сохраненные ссылки',
      recentLinks: 'Недавние ссылки',
      trending: 'Быстрые находки',
      exploreSearch: 'Поиск с главной',
      nearby: 'Станции рядом',
      discoverResults: 'Результаты ресерча',
      deepLink: 'Глубокая ссылка',
      history: 'История',
      allStations: 'Весь каталог',
      resume: 'Продолжить'
    },
    toast: {
      savedSkinFallback: 'Сохраненный скин недоступен. Вернул базовый Winamp Base 2.91.',
      missingStream: 'У станции нет адреса потока',
      playbackFailed: 'Не удалось запустить поток',
      noPlayable: 'В каталоге не нашлось рабочей станции',
      shareDialog: 'Открыт диалог шаринга',
      linkCopied: 'Ссылка скопирована',
      shareOpened: 'Шаринг открыт',
      shareFailed: 'Не удалось открыть шаринг',
      cacheCleared: 'Кэш очищен',
      noTrackInfo: 'Нет данных о треке',
      trackCopied: 'Трек скопирован',
      copyFailed: 'Не удалось скопировать',
      skinApplied: 'Скин: {name}'
    }
  },
  en: {
    app: {
      title: 'RadioAtlas',
      subtitle: 'World music, live.',
      liveBadge: 'Live',
      liveVersion: 'Build'
    },
    nav: {
      home: 'Home',
      search: 'Search',
      globe: 'Globe',
      library: 'Library',
      settings: 'Settings',
      Explore: 'Home',
      Favorites: 'Library',
      Discover: 'Discover',
      Playlist: 'Queue',
      Settings: 'Settings'
    },
    common: {
      play: 'Play',
      pause: 'Pause',
      resume: 'Resume',
      next: 'Next',
      clear: 'Clear',
      close: 'Close',
      copy: 'Copy',
      share: 'Share',
      info: 'Info',
      song: 'Song',
      site: 'Site',
      stream: 'Stream',
      remove: 'Remove',
      saveReload: 'Save & reload',
      reset: 'Reset',
      show: 'Show',
      hide: 'Hide',
      apply: 'Apply',
      active: 'Active',
      view: 'View',
      paste: 'Paste',
      addLink: 'Add link',
      importPlaylist: 'Import playlist',
      importing: 'Importing...',
      extractStreams: 'Extract streams',
      openApp: 'Open app',
      openBrowser: 'Open in browser',
      loading: 'Loading...',
      unavailable: 'Unavailable',
      unknown: 'Unknown'
    },
    locale: {
      language: 'Interface language',
      languageDesc: 'Russian is the default now, but you can switch languages in Settings.',
      russian: 'Russian',
      english: 'English'
    },
    stationTable: {
      empty: 'No stations yet.',
      playColumn: 'Play',
      nameColumn: 'Name',
      locationColumn: 'Location',
      tagsColumn: 'Tags',
      favoriteColumn: 'Favorite',
      favorite: 'Favorite',
      unfavorite: 'Unfavorite'
    },
    explore: {
      kicker: 'RadioAtlas x Winamp',
      title: 'Airwaves without the clutter',
      subtitle: 'The globe stays hero, while Winamp lives in its own dock and stops fighting the layout.',
      heroPill: 'Winamp-aware home',
      mapped: 'Mapped',
      favorites: 'Favorites',
      queue: 'Queue',
      globeTitle: 'Live globe',
      globeSubtitle: 'Tap a point on the globe and drop straight into nearby stations.',
      globeFocused: 'Focused on current station',
      globeTap: 'Tap a glow point',
      picksOpen: '{count} nearby stations -> list already opened below',
      picksHint: 'Tap a point -> nearby stations open below',
      quickSearchTitle: 'Quick start',
      quickSearchSubtitle: 'Search from home without jumping into a separate screen.',
      quickSearchPlaceholder: 'Name, genre, country, or language',
      quickSearchIdle: 'Start typing and drop results into the queue',
      quickSearchMatches: 'Instant matches: {count}',
      resumeTitle: 'Continue from where you stopped',
      resumeReady: '{station} is ready. Source: {source}.',
      resumeEmpty: 'Play any station from the globe or discovery screen to build a queue.',
      resumeCurrent: 'Current station',
      resumeStation: 'Resume station',
      nextPick: 'Next pick',
      noQueue: 'No queue yet.',
      nearbyTitle: 'Nearby stations ({count})',
      nearbySubtitle: 'Closest matches first. Tap one and start listening immediately.',
      dismissNearby: 'Hide',
      resultTitle: 'Search results',
      trendingTitle: 'Fast picks',
      resultSubtitle: 'Search works directly on top of the home screen.',
      trendingSubtitle: 'Quick launch picks for the current session.',
      favoritesTitle: 'Favorites ready',
      favoritesSubtitle: 'Trusted stations, one tap away from the player.',
      favoritesEmpty: 'Favorite stations to keep a personal launchpad here.',
      recentTitle: 'Recent momentum',
      recentSubtitle: 'Your latest sessions stay visible so the home screen keeps moving.',
      recentEmpty: 'Recently played stations will appear here.',
      searchPicks: 'Search picks',
      trendingPicks: 'Home picks',
      unknownLocation: 'Unknown location'
    },
    home: {
      kicker: 'Live radio',
      title: 'World radio',
      subtitle:
        'Station, search, globe, and queue in one calmer shell. Winamp stays separate.',
      openGlobe: 'Open globe',
      openSearch: 'Open search',
      openLibrary: 'Open library',
      quickMix: 'Quick mix',
      quickMixCopy: 'Station, genre, country, or language right from home.',
      globeTeaser: 'Geography of live radio',
      globeTeaserCopy: 'Spin the map and pull nearby stations into the session.',
      resumeTitle: 'Now playing and queue',
      libraryTitle: 'Library snapshot',
      libraryFavoritesCopy: 'Liked stations for a fast jump back in.',
      libraryRecentCopy: 'Recent sessions without extra noise.',
      libraryQueueCopy: 'Current queue and the next handoffs.',
      globeMode: 'Geo discovery'
    },
    globe: {
      heroSubtitle: 'Pick an area first, then open the stations inside it.',
      tapArea: 'Tap a live area',
      controlsHint: 'Drag to spin, zoom in, then tap an area',
      status: 'Areas: {areas} / mapped points: {mapped} / total stations: {total}',
      areaSubtitle: '{count} stations',
      mixedArea: 'Mixed area',
      idleTitle: 'Pick a point on the globe',
      idleCopy: 'Once you tap an active zone, nearby stations will appear here.',
      idleEmpty: 'Nothing selected yet.',
      selectedTitle: '{place} ({count})',
      selectedCopy: 'Zoom in for a tighter split. Right now this list is focused on: {place}.',
      clearSelection: 'Clear',
      selectionArea: 'Area',
      selectionCount: 'Stations',
      selectionZoom: 'Zoom',
      areaSummaryTitle: 'Selected area',
      areaSummaryCopy: '{place} · {subtitle}',
      mappedAreas: 'Areas on map',
      liveQueue: 'Live queue nearby'
    },
    search: {
      kicker: 'Search / links / regions',
      topbarSubtitle: 'Stations and external streams.',
      showFilters: 'Show filters',
      hideFilters: 'Hide filters'
    },
    library: {
      kicker: 'Personal space',
      title: 'Library',
      subtitle: 'Favorites, queue, recents, and history now live in one place.',
      topbarSubtitle: 'Favorites, queue, history.',
      trackJournal: 'Copied track names land here for quick reuse.',
      stationHistory: 'Live station history for returning to the right mood fast.',
      tabs: {
        favorites: 'Favorites',
        queue: 'Queue',
        recent: 'Recent',
        history: 'History'
      }
    },
    dock: {
      peekLabel: 'Player ready',
      peekHint: 'Tap to expand',
      queueCount: 'Queued: {count}',
      liveNow: 'Live now',
      ready: 'Player',
      emptyTitle: 'Pick a station',
      emptySubtitle: 'Add a station from Home, Search, or Globe.',
      openWinamp: 'Winamp'
    },
    favoritesScreen: {
      profileTitle: 'Profile',
      profileName: 'You',
      profileDesc: 'Favorites are stored on this device.',
      lastPlayed: 'Last played: {station}',
      favorites: 'Favorites',
      recent: 'Recent',
      journalTitle: 'Track journal',
      journalEmpty: 'Copied tracks will appear here.',
      myStations: 'My stations',
      recentStations: 'Recently played'
    },
    playlist: {
      title: 'Queue',
      stationsCount: 'Stations: {count}',
      playCurrent: 'Play current',
      clearQueue: 'Clear queue',
      empty: 'Start any station from Home, Discover, or Favorites to build a queue.',
      playing: 'Playing',
      historyTitle: 'Playback history',
      historyEmpty: 'Playback history is empty.'
    },
    settings: {
      backgroundTitle: 'Background audio',
      openBrowserLabel: 'Open in system browser',
      openBrowserDesc: 'Recommended for reliable background playback.',
      skinTitle: 'Player skin',
      skinModeLabel: 'Winamp skin mode',
      skinModeDesc: 'Search skins.webamp.org and persist the one you choose.',
      closeFullscreen: 'Close fullscreen player',
      openFullscreen: 'Open fullscreen player',
      generalTitle: 'Settings',
      apiBaseLabel: 'API base',
      apiBaseDesc: 'Proxy for stations without VPN: trycloudflare or your own server.',
      apiPlaceholder: 'https://your-api.example',
      invalidApi: 'Invalid API URL. Use https://...',
      cacheLabel: 'Cache',
      cacheDesc: 'Refresh catalog and globe data.',
      clearCache: 'Clear cache',
      favoritesLabel: 'Favorites',
      favoritesDesc: 'Reset saved stations.',
      clearFavorites: 'Clear favorites',
      recentLabel: 'Recently played',
      recentDesc: 'Clear local playback history.',
      clearRecent: 'Clear recent',
      diagnosticsTitle: 'Diagnostics',
      debugLabel: 'Debug mode',
      debugDesc: 'Show logs and system information.',
      noLogs: 'No logs yet...'
    },
    discover: {
      title: 'Search and research',
      subtitle:
        'One screen for search, genres, regions, and manual stream imports. Browse and Search now live together.',
      stationsMode: 'Stations',
      linksMode: 'Links',
      searchPlaceholder: 'Name, genre, country, language',
      matches: 'Matches: {count}',
      allStations: 'All stations: {count}',
      regionTitle: 'Fast entry by region',
      regionSubtitle: 'Pick a continent, then narrow the catalog through countries.',
      countriesInRegion: 'Countries in region: {count}',
      regionAll: 'Whole world',
      countrySearchPlaceholder: 'Filter country',
      tagTitle: 'Genres worth digging into',
      tagSubtitle: 'Tap a genre to narrow the results immediately.',
      countryTitle: 'Countries close to your current search',
      countrySubtitle: 'Dense catalogs first so people can always find something to play.',
      jumpToCountry: 'Open {country}',
      loadMore: 'Load more',
      linksTitle: 'Manual streams and playlists',
      linksSubtitle:
        'Add direct audio links, `.m3u`, and `.pls`. Non-direct links can be expanded through the API.',
      linksSaved: 'Saved links',
      linksEmpty: 'No saved links yet.',
      linksRecent: 'Recently played links',
      linksRecentEmpty: 'Links will appear here after the first session.',
      audioPlaceholder: 'Audio URL or playlist (.m3u/.pls)',
      titlePlaceholder: 'Optional title',
      extractorOffline: 'Extractor is offline. Check the API URL in Settings.',
      enterValidUrl: 'Enter a valid URL',
      youtubeBlocked: 'YouTube links are blocked in this mode',
      extractorMissing: 'Not a direct audio URL. Configure the API and extract the stream.',
      enterPlaylistUrl: 'Enter a valid playlist URL',
      noPlayableUrls: 'No playable URLs found in the playlist',
      noPlayableItems: 'No playable items found',
      noPlayableStreams: 'No playable audio streams found',
      apiUnavailable: 'API unavailable',
      extractorNotConfigured: 'Extractor API not configured',
      clipboardDenied: 'Clipboard access denied',
      playLink: 'Play link'
    },
    skin: {
      current: 'Current skin',
      useDefault: 'Use default',
      placeholder: 'Search skins.webamp.org',
      helper: 'Search the Winamp Skin Museum and keep the selected skin between visits.',
      searching: 'Searching skins...',
      searchFailed: 'Skin search failed',
      noResults: 'No matching skins found.',
      resultsLabel: 'Skin search results'
    },
    details: {
      closeAria: 'Close station card',
      close: 'Close',
      copyTrack: 'Copy track',
      nowPlaying: 'Now playing',
      streamUrl: 'Stream URL',
      homepage: 'Homepage',
      country: 'Country',
      region: 'Region',
      codec: 'Codec',
      bitrate: 'Bitrate',
      unknownRegion: 'Unknown',
      openTrackCopy: 'Copy track'
    },
    winamp: {
      fullscreen: 'Open fullscreen player',
      collapse: 'Collapse',
      closeWinamp: 'Back to app',
      resetLayout: 'Reset layout',
      nowTuned: 'Now tuned',
      upNext: 'Up next',
      currentStation: 'Current station',
      recentSessions: 'Recent sessions',
      queueReady: 'Stations ready: {count}',
      queueCount: 'Stations in queue: {count}',
      noStation: 'No station selected',
      buildQueue: 'Build a queue from Home or Discover.',
      historyEmpty: 'Playback history is empty.',
      loadingShell: 'Loading Winamp...',
      loadingFailed: 'Winamp load failed. Retry',
      figmaPlaceholder: 'Winamp shell placeholder for Figma capture',
      copyTrackTitle: 'Copy track title',
      trackUnavailable: 'Track title unavailable'
    },
    radio: {
      queueDefault: 'Playback queue',
      favorites: 'Favorites',
      recent: 'Recently played',
      searchResults: 'Search results',
      savedLinks: 'Saved links',
      recentLinks: 'Recent links',
      trending: 'Fast picks',
      exploreSearch: 'Home search',
      nearby: 'Nearby stations',
      discoverResults: 'Discover results',
      deepLink: 'Deep link',
      history: 'History',
      allStations: 'All stations',
      resume: 'Resume'
    },
    toast: {
      savedSkinFallback: 'Saved skin unavailable. Reverted to Winamp Base 2.91.',
      missingStream: 'Missing stream URL',
      playbackFailed: 'Playback failed',
      noPlayable: 'No playable station in catalog',
      shareDialog: 'Share dialog opened',
      linkCopied: 'Link copied',
      shareOpened: 'Share opened',
      shareFailed: 'Share failed',
      cacheCleared: 'Cache cleared',
      noTrackInfo: 'No track info',
      trackCopied: 'Track copied',
      copyFailed: 'Copy failed',
      skinApplied: 'Skin: {name}'
    }
  }
} satisfies Record<Locale, Record<string, DictionaryValue>>;

const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
} | null>(null);

const resolveValue = (locale: Locale, key: string): string => {
  const path = key.split('.');
  let current: DictionaryValue | undefined = dictionaries[locale];

  for (const segment of path) {
    if (!current || typeof current === 'string') {
      return key;
    }
    current = current[segment];
  }

  return typeof current === 'string' ? current : key;
};

const sanitizeLocale = (value: Locale | string): Locale => (value === 'en' ? 'en' : 'ru');

export const LocaleProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocaleState] = useLocalStorage<Locale>('radio:locale', 'ru');
  const safeLocale = sanitizeLocale(locale);

  const value = useMemo(
    () => ({
      locale: safeLocale,
      setLocale: (nextLocale: Locale) => setLocaleState(sanitizeLocale(nextLocale)),
      t: (key: string, vars?: Record<string, string | number>) => {
        const template = resolveValue(safeLocale, key);
        if (!vars) return template;
        return template.replace(/\{(\w+)\}/g, (_, token) => String(vars[token] ?? `{${token}}`));
      }
    }),
    [safeLocale, setLocaleState]
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export const useLocale = () => {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used inside LocaleProvider');
  }
  return context;
};
