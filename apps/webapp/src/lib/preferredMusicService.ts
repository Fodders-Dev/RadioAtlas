import { MUSIC_SERVICES, type MusicServiceId } from './musicServiceLinks';

/**
 * Which music service this DEVICE opens finds in.
 *
 * ⚠ Deliberately NOT in the synced library, and the reason is product before it
 * is technical. A phone may have the Яндекс Музыка app installed while a
 * desktop has none and wants the web player; forcing one answer onto both is
 * worse than remembering each. The technical half agrees: the library syncs as
 * one whole body (recorded as an architectural debt in PLAN.md), and adding a
 * preference to it would grow that body for something no other device wants.
 *
 * So: one small key, written and read directly. It does not go through
 * `usePersistentState` because there is no React state to keep in step — the
 * value is read when a find is opened and written when the picker is answered.
 * A failure to persist is survivable: the picker simply asks again next time,
 * which is the honest behaviour when storage refused.
 */

const KEY = 'radio:finds:service:v1';

const isMusicServiceId = (value: unknown): value is MusicServiceId =>
  typeof value === 'string' && (MUSIC_SERVICES as readonly string[]).includes(value);

export const readPreferredMusicService = (): MusicServiceId | null => {
  try {
    const stored = window.localStorage.getItem(KEY);
    // Validate rather than trust: the key is a plain string in storage, and a
    // stale or hand-edited value must not reach a URL builder that would then
    // return undefined and open nothing.
    return isMusicServiceId(stored) ? stored : null;
  } catch {
    return null;
  }
};

export const writePreferredMusicService = (service: MusicServiceId) => {
  try {
    window.localStorage.setItem(KEY, service);
    return true;
  } catch {
    // A private window, a full quota. The find still opens — only the memory of
    // which service was chosen is lost, and the picker asking again is a fair
    // consequence rather than a broken feature.
    return false;
  }
};

export const clearPreferredMusicService = () => {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do: the caller is resetting a convenience, not data.
  }
};
