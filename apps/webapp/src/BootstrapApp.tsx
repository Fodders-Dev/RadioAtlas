import { Suspense, lazy } from 'react';

const AppProvidersLazy = lazy(() =>
  import('./AppProviders').then((mod) => ({ default: mod.AppProviders }))
);

const BootstrapSplash = () => (
  <div className="boot-splash" aria-busy="true" aria-label="Loading RadioAtlas">
    <div className="boot-splash__panel">
      <div className="boot-splash__eyebrow">Telegram Mini App</div>
      <div className="boot-splash__brandline">
        <span className="boot-splash__mark">R++</span>
        <span>RadioAtlas</span>
      </div>
      <div className="boot-splash__title">Connecting the dial</div>
      <div className="boot-splash__subtitle">
        Loading the shell and stabilizing stream controls.
      </div>
      <div className="boot-splash__meter" aria-hidden="true">
        <span />
      </div>
    </div>
  </div>
);

export const BootstrapApp = () => (
  <Suspense fallback={<BootstrapSplash />}>
    <AppProvidersLazy />
  </Suspense>
);
