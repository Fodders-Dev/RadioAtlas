import { AppProviders } from './AppProviders';
import { AppCrashFallback, ErrorBoundary } from './components/ErrorBoundary';
import { reportError } from './lib/observability';

// Top-level boundary: a render crash anywhere in the provider tree (incl.
// the i18n provider) lands here with a static, reload-only fallback. (T1.7)
export const BootstrapApp = () => (
  <ErrorBoundary
    onError={(error, info) => reportError(error, info, { boundary: 'top' })}
    fallback={() => <AppCrashFallback />}
  >
    <AppProviders />
  </ErrorBoundary>
);
