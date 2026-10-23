export type PwaPlaybackCategoryStatus =
  | 'not-requested' | 'ineligible' | 'unavailable' | 'original-unknown' | 'skipped-type'
  | 'already-playback' | 'write-failed' | 'write-ignored' | 'readback-unknown' | 'acquired'
  | 'restored' | 'external-change' | 'restore-unknown' | 'restore-failed';
export type PwaPlaybackCategoryEvent = 'pwa_playback_category_acquire' | 'pwa_playback_category_release';
type AudioSessionLike = { type?: unknown };
type SessionOptions = {
  isEligible: () => boolean;
  getAudioSession: () => AudioSessionLike | null;
  record: (event: PwaPlaybackCategoryEvent, status: PwaPlaybackCategoryStatus) => void;
};

/** Owns at most one auto -> playback override for an explicit listening interval. */
export const createPwaPlaybackSession = ({ isEligible, getAudioSession, record }: SessionOptions) => {
  let attempted = false;
  let owned = false;
  let status: PwaPlaybackCategoryStatus = 'not-requested';
  const safeRead = (session: AudioSessionLike): { known: true; value: unknown } | { known: false } => {
    try { return { known: true, value: session.type }; } catch { return { known: false }; }
  };
  const report = (event: PwaPlaybackCategoryEvent, next: PwaPlaybackCategoryStatus) => {
    status = next;
    try { record(event, next); } catch { /* diagnostics never gate media */ }
  };

  const acquire = () => {
    if (attempted) return;
    attempted = true;
    try {
      if (!isEligible()) { report('pwa_playback_category_acquire', 'ineligible'); return; }
      const session = getAudioSession();
      if (!session) { report('pwa_playback_category_acquire', 'unavailable'); return; }
      const current = safeRead(session);
      if (!current.known || typeof current.value !== 'string') {
        report('pwa_playback_category_acquire', 'original-unknown'); return;
      }
      if (current.value === 'playback') { report('pwa_playback_category_acquire', 'already-playback'); return; }
      if (current.value !== 'auto') { report('pwa_playback_category_acquire', 'skipped-type'); return; }
      try { session.type = 'playback'; } catch { report('pwa_playback_category_acquire', 'write-failed'); return; }
      const readback = safeRead(session);
      if (!readback.known || typeof readback.value !== 'string') {
        report('pwa_playback_category_acquire', 'readback-unknown'); return;
      }
      if (readback.value === 'playback') {
        owned = true;
        report('pwa_playback_category_acquire', 'acquired');
      } else if (readback.value === 'auto') report('pwa_playback_category_acquire', 'write-ignored');
      else report('pwa_playback_category_acquire', 'readback-unknown');
    } catch { report('pwa_playback_category_acquire', 'unavailable'); }
  };

  const release = () => {
    if (!attempted && !owned) return;
    let result: PwaPlaybackCategoryStatus = status;
    if (owned) {
      try {
        const session = getAudioSession();
        if (!session) result = 'restore-unknown';
        else {
          const current = safeRead(session);
          if (!current.known || typeof current.value !== 'string') result = 'restore-unknown';
          else if (current.value !== 'playback') result = 'external-change';
          else {
            try { session.type = 'auto'; } catch { result = 'restore-failed'; }
            if (result !== 'restore-failed') {
              const restored = safeRead(session);
              if (!restored.known || typeof restored.value !== 'string') result = 'restore-unknown';
              else result = restored.value === 'auto' ? 'restored' : 'restore-failed';
            }
          }
        }
      } catch { result = 'restore-failed'; }
    }
    owned = false;
    attempted = false;
    report('pwa_playback_category_release', result);
  };

  return { acquire, release, getStatus: () => status };
};

export const isInstalledStandalone = () => {
  try {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
    const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return legacy || window.matchMedia('(display-mode: standalone)').matches;
  } catch { return false; }
};
