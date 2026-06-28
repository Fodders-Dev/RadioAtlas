export const loadHomeScreen = () =>
  import('../screens/Home').then((mod) => ({ default: mod.Home }));

export const loadSearchScreen = () =>
  import('../screens/Search').then((mod) => ({ default: mod.Search }));

export const loadFeedScreen = () =>
  import('../screens/StationFeed').then((mod) => ({ default: mod.StationFeed }));

export const loadGlobeScreen = () =>
  import('../screens/GlobeScreen').then((mod) => ({ default: mod.GlobeScreen }));

export const loadLibraryScreen = () =>
  import('../screens/Library').then((mod) => ({ default: mod.Library }));

export const loadSettingsScreen = () =>
  import('../screens/Settings').then((mod) => ({ default: mod.Settings }));

export const loadAccountSheet = () =>
  import('../components/AccountSheet').then((mod) => ({ default: mod.AccountSheet }));

export const loadStationDetails = () =>
  import('../components/StationDetails').then((mod) => ({ default: mod.StationDetails }));
