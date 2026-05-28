import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';
import { useLocale } from '../state/LocaleContext';

type ErrorBoundaryProps = {
  children: ReactNode;
  // Rendered when a descendant throws. Receives a `retry` that clears the
  // error and remounts the subtree (fresh render attempt).
  fallback: (retry: () => void) => ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
};

type ErrorBoundaryState = {
  error: Error | null;
  resetCount: number;
};

// T_audit_6: a lazy-route chunk that the new deploy deleted (Vite content-hash
// renamed it on rebuild) throws a recognisable error on the next nav. Treat it
// as a stale-cache miss and reload once — the new index references the new
// hashes. Message strings come from Chrome/Firefox + Safari respectively.
const CHUNK_ERROR_SIGNATURES = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module'
];
const isChunkLoadError = (error: Error): boolean => {
  const message = error.message || '';
  return CHUNK_ERROR_SIGNATURES.some((signature) => message.includes(signature));
};

// Timestamp-guarded reload. If the LAST reload was <10s ago, assume it didn't
// help (genuinely broken build, not a stale cache) and show the error UI
// instead — that's the loop-safety guarantee. A later chunk error in the same
// session (e.g., a SECOND deploy minutes later) lies outside the window and is
// allowed to recover. Stored in sessionStorage so it survives the reload.
const CHUNK_RELOAD_KEY = 'radioatlas:chunkReloadAt';
const CHUNK_RELOAD_COOLDOWN_MS = 10_000;
const tryReloadForChunkError = (error: Error): boolean => {
  if (typeof window === 'undefined' || !isChunkLoadError(error)) return false;
  try {
    const last = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0;
    if (Date.now() - last < CHUNK_RELOAD_COOLDOWN_MS) return false;
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage blocked (private mode, quota): fall through to the UI
    // rather than risk a loop without the safeguard.
    return false;
  }
  window.location.reload();
  return true;
};

// Class component because only class lifecycles (getDerivedStateFromError /
// componentDidCatch) can catch render errors — there is no hook equivalent.
// Kept dependency-free (no react-error-boundary): a single ~40-line class
// covers the project's two boundary sites. (T1.7)
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, resetCount: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
    // T_audit_6: graceful recovery for stale-chunk errors after a deploy.
    // Reload starts asynchronously — the fallback UI may flash briefly, then
    // the new build picks up. tryReloadForChunkError is loop-safe (cooldown).
    tryReloadForChunkError(error);
  }

  private retry = () => {
    this.setState((prev) => ({ error: null, resetCount: prev.resetCount + 1 }));
  };

  render() {
    if (this.state.error) {
      return this.props.fallback(this.retry);
    }
    // Keying the subtree by resetCount forces a full remount on retry, so a
    // transient failure (e.g. a chunk that failed to load once) gets a clean
    // attempt rather than re-rendering the same broken state.
    return <Fragment key={this.state.resetCount}>{this.props.children}</Fragment>;
  }
}

// Inline fallback for a single failed screen — the app shell (topbar, nav,
// dock, player) stays alive, so the user can retry or switch tabs.
// role="alert" announces it to assistive tech (accessibility guide §6/§9).
export const ScreenErrorFallback = ({
  onRetry,
  onHome
}: {
  onRetry: () => void;
  onHome: () => void;
}) => {
  const { t } = useLocale();
  return (
    <div className="empty-state error-boundary-fallback" role="alert">
      <strong>{t('errorBoundary.screenTitle')}</strong>
      <span>{t('errorBoundary.screenBody')}</span>
      <div className="chip-row error-boundary-actions">
        <button className="chip" type="button" onClick={onRetry}>
          {t('errorBoundary.retry')}
        </button>
        <button className="chip" type="button" onClick={onHome}>
          {t('errorBoundary.home')}
        </button>
      </div>
    </div>
  );
};

// Full-page fallback for a top-level (provider) crash. Rendered OUTSIDE the
// providers (including LocaleProvider), so the copy is static — it must work
// even when the i18n provider is the thing that broke. Recovery is a full
// reload (a local remount can't fix a broken provider tree).
export const AppCrashFallback = () => (
  <div className="app-crash-fallback" role="alert">
    <div className="empty-state error-boundary-fallback">
      <strong>Что-то пошло не так</strong>
      <span>Приложение нужно перезагрузить.</span>
      <div className="chip-row error-boundary-actions">
        <button className="chip" type="button" onClick={() => window.location.reload()}>
          Перезагрузить
        </button>
      </div>
    </div>
  </div>
);

// Test-only seam: throws during render when the global flag is set, so the
// screen-level boundary can be exercised end-to-end. Production never sets
// the flag (mirrors the existing __radioatlas* test hooks). (T1.7)
declare global {
  interface Window {
    __radioatlasForceScreenError__?: boolean;
    __radioatlasForceErrorMessage__?: string;
  }
}

export const ErrorProbe = () => {
  if (typeof window !== 'undefined' && window.__radioatlasForceScreenError__) {
    // T_audit_6: a custom message lets e2e tests trigger the chunk-error
    // recovery path (the same probe was already used for T1.7's boundary spec).
    throw new Error(window.__radioatlasForceErrorMessage__ || 'Forced screen error (test hook)');
  }
  return null;
};
