import { Suspense, lazy } from 'react';

const RuntimeProvidersLazy = lazy(() =>
  import('./RuntimeProviders').then((mod) => ({ default: mod.RuntimeProviders }))
);

const RuntimeProvidersFallback = () => (
  <div className="boot-splash" aria-busy="true" aria-label="Loading RadioAtlas">
    <div className="boot-splash__panel">
      <div className="boot-splash__eyebrow">Telegram Mini App</div>
      <div className="boot-splash__brandline">
        <span className="boot-splash__mark">R++</span>
        <span>RadioAtlas</span>
      </div>
      <div className="boot-splash__title">Preparing the live shell</div>
      <div className="boot-splash__subtitle">
        The player, library, and discovery modules are loading in the background.
      </div>
      <div className="boot-splash__meter" aria-hidden="true">
        <span />
      </div>
    </div>
  </div>
);

export const AppProviders = () => (
  <Suspense fallback={<RuntimeProvidersFallback />}>
    <RuntimeProvidersLazy />
  </Suspense>
);
