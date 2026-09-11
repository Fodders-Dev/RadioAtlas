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
//
// ⚠ Each dynamic import lives in its OWN arrow. Vite wraps every `import()`
// with a preload of the chunk's dependencies — its CSS included — but when two
// imports sat in one ternary the wrapper carried only the first branch's
// list, and production shipped the calm Globe with none of its styles (the
// screen rendered 4.5k px tall with the map and the panel stacked, seen on
// 11.09.2026). Dev mode never showed it: Vite serves CSS as modules there.
// `screenLoaders.test.ts` guards the shape.
const loadGlobeExplorer = () =>
  import('../screens/GlobeExplorer').then((mod) => ({ default: mod.GlobeExplorer }));
const loadReticleGlobe = () =>
  import('../screens/GlobeScreen').then((mod) => ({ default: mod.GlobeScreen }));
export const loadGlobeScreen = () => (CALM_PREVIEW ? loadGlobeExplorer() : loadReticleGlobe());

export const loadLibraryScreen = () =>
  import('../screens/Library').then((mod) => ({ default: mod.Library }));

export const loadSettingsScreen = () =>
  import('../screens/Settings').then((mod) => ({ default: mod.Settings }));

export const loadAccountSheet = () =>
  import('../components/AccountSheet').then((mod) => ({ default: mod.AccountSheet }));

export const loadStationDetails = () =>
  import('../components/StationDetails').then((mod) => ({ default: mod.StationDetails }));
