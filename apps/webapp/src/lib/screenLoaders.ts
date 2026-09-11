import { CALM_PREVIEW } from './calmPreview';

export const loadHomeScreen = () =>
  import('../screens/Home').then((mod) => ({ default: mod.Home }));

export const loadSearchScreen = () =>
  import('../screens/Search').then((mod) => ({ default: mod.Search }));

export const loadFeedScreen = () =>
  import('../screens/StationFeed').then((mod) => ({ default: mod.StationFeed }));

// The calm preview (`?calm=1`) opens the A4 «Журнал» Globe: clusters with real
// counts, a compact source card and a stable list. The reticle Globe stays the
// default until the owner accepts the composition in the product.
export const loadGlobeScreen = () =>
  CALM_PREVIEW
    ? import('../screens/GlobeExplorer').then((mod) => ({ default: mod.GlobeExplorer }))
    : import('../screens/GlobeScreen').then((mod) => ({ default: mod.GlobeScreen }));

export const loadLibraryScreen = () =>
  import('../screens/Library').then((mod) => ({ default: mod.Library }));

export const loadSettingsScreen = () =>
  import('../screens/Settings').then((mod) => ({ default: mod.Settings }));

export const loadAccountSheet = () =>
  import('../components/AccountSheet').then((mod) => ({ default: mod.AccountSheet }));

export const loadStationDetails = () =>
  import('../components/StationDetails').then((mod) => ({ default: mod.StationDetails }));
