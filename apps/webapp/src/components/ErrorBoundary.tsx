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
  }
}

export const ErrorProbe = () => {
  if (typeof window !== 'undefined' && window.__radioatlasForceScreenError__) {
    throw new Error('Forced screen error (test hook)');
  }
  return null;
};
