import React from 'react';
import ReactDOM from 'react-dom/client';
import { BootstrapApp } from './BootstrapApp';
import { getDeviceProfile } from './lib/deviceProfile';
import './boot.css';
// styles.css (the ~150KB app shell + layout) is imported EAGERLY so Vite emits
// it as a render-blocking <link> in <head>. It used to be lazy-loaded via a
// deferred dynamic import (requestIdleCallback → import('./styles.css')), which
// on slow phone webviews left a long flash of fully-unstyled, structurally-broken
// DOM (nav as a plain button stack, dock unstyled) before the chunk arrived.
// Blocking the main CSS makes the first paint correctly laid out. boot.css stays
// first so its CSS variables are defined before styles.css consumes them.
import './styles.css';

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    const preloadEvent = event as Event & { payload?: unknown };
    const error = preloadEvent.payload;
    if (error instanceof Error && error.message.includes('Unable to preload CSS for')) {
      preloadEvent.preventDefault();
    }
  });
}

// Glass budget. backdrop-filter is the single most expensive effect in this UI
// on a mid-range Android WebView; low-power devices get a flat translucent fill
// instead. Stamped once at boot (getDeviceProfile caches), read by CSS via
// :root[data-glass='lite'].
if (typeof document !== 'undefined') {
  document.documentElement.dataset.glass = getDeviceProfile().lowPower ? 'lite' : 'full';
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element missing');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BootstrapApp />
  </React.StrictMode>
);
