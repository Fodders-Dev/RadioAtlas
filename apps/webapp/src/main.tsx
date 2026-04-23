import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import './boot.css';

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    const preloadEvent = event as Event & { payload?: unknown };
    const error = preloadEvent.payload;
    if (error instanceof Error && error.message.includes('Unable to preload CSS for')) {
      preloadEvent.preventDefault();
    }
  });
}

const BootstrapApp = lazy(() =>
  import('./BootstrapApp').then((mod) => ({ default: mod.BootstrapApp }))
);

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element missing');

const BootFallback = () => (
  <div className="boot-splash" aria-busy="true" aria-label="Loading RadioAtlas">
    <div className="boot-splash__panel">
      <div className="boot-splash__eyebrow">Telegram Mini App</div>
      <div className="boot-splash__brandline">
        <span className="boot-splash__mark">R++</span>
        <span>RadioAtlas</span>
      </div>
      <div className="boot-splash__title">Warming up the world map</div>
      <div className="boot-splash__subtitle">
        Booting the shell before the heavier player modules arrive.
      </div>
      <div className="boot-splash__meter" aria-hidden="true">
        <span />
      </div>
    </div>
  </div>
);

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <Suspense fallback={<BootFallback />}>
      <BootstrapApp />
    </Suspense>
  </React.StrictMode>
);
