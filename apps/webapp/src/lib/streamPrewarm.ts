import { getApiBase } from './apiBase';
import { buildCandidates } from './playbackTransport';
import { buildStationStreamTargets } from './stationStreams';
import type { StationLite } from '../types';

// Pre-warm the connection to the NEXT likely station so a switch skips the cold
// DNS + TLS + TCP handshake. Live audio itself CANNOT be pre-buffered (it's live —
// there's nothing ahead to download), and a hidden second <audio preload> would
// burn continuous mobile data, fight the single decode pipeline, and re-sync to the
// live edge anyway. So the honest, cheap win is a <link rel=preconnect> to the next
// stream's origin — and ONLY for DIRECT streams: a proxied stream (every http:// on
// the https app, forced-proxy https) plays through the SAME app origin, which is
// already warm, so there's nothing for the client to pre-warm there.

// Pure core: given the first playback candidate's URL and the page origin, return
// the foreign origin worth preconnecting, or null when it's same-origin (proxy) /
// unparseable. Kept pure so it's unit-testable without a DOM.
export const prewarmOriginFromCandidateUrl = (
  candidateUrl: string | null | undefined,
  pageOrigin: string
): string | null => {
  if (!candidateUrl) return null;
  try {
    const origin = new URL(candidateUrl, pageOrigin).origin;
    return origin === pageOrigin ? null : origin;
  } catch {
    return null;
  }
};

// Resolve the origin the browser will actually connect to for a station's FIRST
// candidate — mirrors the real play path (buildStationStreamTargets → buildCandidates
// with an optimistic apiAvailable so there's no health round-trip). null ⇒ nothing
// to warm (same-origin proxy or unresolvable).
export const resolvePrewarmOrigin = (station: StationLite): string | null => {
  if (typeof window === 'undefined') return null;
  const targets = buildStationStreamTargets(station);
  const url = targets[0] || station.url_resolved;
  const plan = buildCandidates({ url, apiBase: getApiBase(), apiAvailable: true });
  return prewarmOriginFromCandidateUrl(plan.candidates[0]?.url, window.location.origin);
};

const PREWARM_ATTR = 'data-stream-prewarm';

const clearPrewarmLinks = (head: HTMLHeadElement) => {
  head.querySelectorAll(`link[${PREWARM_ATTR}]`).forEach((element) => element.remove());
};

// Idempotently preconnect to the next station's DIRECT stream origin. Keeps ONE
// active prewarm target at a time (replaced as the "next" changes); a no-op when the
// next station is proxied/same-origin.
export const prewarmStation = (station: StationLite | null | undefined): void => {
  if (typeof document === 'undefined') return;
  const head = document.head;
  if (!head) return;
  const origin = station ? resolvePrewarmOrigin(station) : null;
  const current = head.querySelector<HTMLLinkElement>(`link[rel="preconnect"][${PREWARM_ATTR}]`);
  if (!origin) {
    clearPrewarmLinks(head);
    return;
  }
  if (current) {
    try {
      if (new URL(current.href).origin === origin) return; // already warming this origin
    } catch {
      // fall through and refresh
    }
  }
  clearPrewarmLinks(head);
  const preconnect = document.createElement('link');
  preconnect.rel = 'preconnect';
  preconnect.href = origin;
  preconnect.crossOrigin = 'anonymous';
  preconnect.setAttribute(PREWARM_ATTR, '1');
  head.appendChild(preconnect);
  // dns-prefetch fallback for engines that ignore preconnect.
  const dnsPrefetch = document.createElement('link');
  dnsPrefetch.rel = 'dns-prefetch';
  dnsPrefetch.href = origin;
  dnsPrefetch.setAttribute(PREWARM_ATTR, '1');
  head.appendChild(dnsPrefetch);
};
