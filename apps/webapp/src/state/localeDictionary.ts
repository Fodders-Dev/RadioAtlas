import { ruDictionary } from './locales/ru';
import type { DictionaryTree, DictionaryValue, Locale } from './locales/types';

export type { DictionaryTree, DictionaryValue, Locale } from './locales/types';

// The default locale (ru) ships EAGERLY in the main bundle, so the VERY FIRST
// paint is fully translated — no flash of raw i18n keys at startup. Previously
// defaultDictionary was a hand-curated SUBSET and the full ru dictionary was a
// lazy chunk loaded deferred (up to ~2.4s via requestIdleCallback), so the Home
// rails / personal-radio / search-placeholder strings rendered as raw keys
// («home.personalRadioTitle» etc.) until that chunk arrived. Using the full ru
// dictionary as the synchronous default removes that window entirely. EN stays
// code-split (loaded lazily on switch); ru users — the default + majority —
// never see the flash.
export const defaultDictionary: DictionaryTree = ruDictionary;

export const loadDictionary = async (locale: Locale): Promise<DictionaryTree> => {
  if (locale === 'en') {
    const module = await import('./locales/en');
    return module.enDictionary;
  }
  // ru is already in the main bundle — return it synchronously, no chunk fetch.
  return ruDictionary;
};
