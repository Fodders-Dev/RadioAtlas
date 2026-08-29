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
// `?glass=off` is a DIAGNOSTIC, not a feature: it stamps 'off', which styles.css
// turns into `backdrop-filter: none` everywhere, so the cost of every blur in the
// app can be measured by loading the same page twice.
//
// It exists because the obvious inference was wrong once already — and then the
// correction was wrong too, which is the part worth remembering. Scrolling Home
// on a Galaxy S20 FE burned ~164% CPU, the nav and dock were made opaque, the
// number did not move (~178%), and blur was written off. Both halves of that
// were broken: `top`'s process total, read once per variant, could not resolve
// the difference, and the switch itself lost the cascade and left half the
// blurs running (see the specificity note in styles.css).
//
// Measured properly — the browser's own trace, interleaved repeats agreeing
// within 1% — blur is the dominant cost: -64% on the GPU compositor thread and
// scroll input p99 from 311ms to 102ms. 'lite' is the tier that acts on it.
//
// The lesson for the next person: when a switch reports "no effect", check that
// the switch is on before believing it. Both probes now assert what they turned
// off, because a diagnostic that silently does nothing is worse than no
// diagnostic at all — it produces a confident wrong answer.
if (typeof document !== 'undefined') {
  const forced =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('glass')
      : null;
  document.documentElement.dataset.glass =
    forced === 'off' || forced === 'lite' || forced === 'full'
      ? forced
      : getDeviceProfile().lowPower
        ? 'lite'
        : 'full';
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element missing');

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BootstrapApp />
  </React.StrictMode>
);

// Registered on `load`, never before it. The cold start is a contract here: the
// first paint must not compete with anything, and a service worker registration
// is work the listener does not need in order to hear a station. It caches only
// the content-hashed /assets/ directory — see public/sw.js for the list of
// things it deliberately refuses to touch, audio first among them.
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // An unregistered worker costs installability, nothing else: every byte it
      // would have cached is still fetched normally. Failing loudly here would
      // put a console error in front of a listener for a feature they did not
      // ask for.
    });
  });
}
