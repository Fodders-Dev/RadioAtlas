import { useLayoutEffect, useRef } from 'react';
import type { StationLite } from '../types';
import type { VisualizerFrame } from '../lib/useAudioPlayer';
import { formatCountryLabel, normalizeStationName, stationLocation, stationTags } from '../lib/stationUtils';
import { FeedWaveform } from '../components/FeedWaveform';
import { StationBackdrop } from '../components/StationBackdrop';
import { LiraMark } from '../components/LiraMark';

// One station, one screen — the A4 «Журнал» Feed card. The rail keeps the
// source (heart), Лира and «ещё»; the story block names the place (→ Globe),
// the station, the track that is REALLY on air with its bookmark, and one
// «Слушать эфир» whose waveform is the real analyser. Every control keeps the
// `data-feed-action` name the pager's focus handoff and the #86 specs rely on.

export type CalmFeedCardProps = {
  station: StationLite;
  active: boolean;
  isCurrent: boolean;
  isPlaying: boolean;
  status: 'idle' | 'playing' | 'paused' | 'connecting' | 'error';
  // The trusted title on air (this station only) — never a cached or invented one.
  liveTrack: string | null;
  // The last find the listener caught on this station, when there is no live title.
  lastFind: string | null;
  favorite: boolean;
  aiEnabled: boolean;
  subscribe: (callback: (frame: VisualizerFrame) => void) => () => void;
  capture: { enabled: boolean; saved: boolean };
  onTogglePlayback: () => void;
  onToggleFavorite: () => void;
  onCapture: () => void;
  onAskLira: () => void;
  onOpenPlace: () => void;
  onOpenTools: () => void;
  labels: {
    play: string; pause: string; like: string; unlike: string; save: string; saved: string;
    lira: string; tools: string; place: string; nowPlaying: string; lastFind: string; noTrack: string; startToCatch: string;
    onAir: string; pausedStatus: string; idleStatus: string; connecting: string; failed: string;
  };
};

export const CalmFeedCard = ({
  station, active, isCurrent, isPlaying, status, liveTrack, lastFind, favorite, aiEnabled, subscribe, capture,
  onTogglePlayback, onToggleFavorite, onCapture, onAskLira, onOpenPlace, onOpenTools, labels
}: CalmFeedCardProps) => {
  const railRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLDivElement>(null);

  // Focus handoff on swipe (see FeedCard): a control focused on the card that
  // just went inactive moves to the same control on the card that became
  // active, without scrolling — a scroll is what the pager reads as a play.
  useLayoutEffect(() => {
    if (active) return;
    const doc = railRef.current?.ownerDocument;
    const focused = doc?.activeElement;
    if (!doc || !(focused instanceof HTMLElement)) return;
    if (!railRef.current?.contains(focused) && !storyRef.current?.contains(focused)) return;
    const name = focused.dataset.feedAction;
    const activeCard = doc.querySelector<HTMLElement>('.station-feed-card-content[data-focus="true"]');
    const replacement =
      (name ? activeCard?.querySelector<HTMLElement>(`[data-feed-action="${name}"]`) : null) ??
      activeCard?.querySelector<HTMLElement>('[data-feed-action="play"]') ??
      null;
    if (replacement) replacement.focus({ preventScroll: true });
    else focused.blur();
  }, [active]);

  const name = normalizeStationName(station.name);
  const genres = stationTags(station, '');
  const place = stationLocation(station, '');
  const country = formatCountryLabel(station.country);
  const tab = active ? undefined : -1;
  const statusText =
    status === 'playing' ? labels.onAir : status === 'paused' ? labels.pausedStatus : status === 'connecting' ? labels.connecting : status === 'error' ? labels.failed : labels.idleStatus;

  return (
    <div className="station-feed-card-content calm-feed-card" data-focus={active ? 'true' : 'false'} data-playing={isPlaying ? 'true' : 'false'} data-status={status}>
      <StationBackdrop station={station} active={active} subscribe={subscribe} />
      <div className="station-feed-card-veil" aria-hidden="true" />

      <div ref={railRef} className="station-feed-card-actions calm-feed-rail" aria-hidden={active ? undefined : 'true'}>
        <button type="button" className={`station-feed-action ${favorite ? 'is-on' : ''}`.trim()} onClick={onToggleFavorite} aria-pressed={favorite} aria-label={`${favorite ? labels.unlike : labels.like}: ${name}`} data-feed-action="favorite" tabIndex={tab}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.4 4.9 13.3a4.2 4.2 0 0 1 6-6l1.1 1.1 1.1-1.1a4.2 4.2 0 0 1 6 6L12 20.4Z" fill={favorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
        </button>
        {aiEnabled ? (
          <button type="button" className="station-feed-action" onClick={onAskLira} aria-label={`${labels.lira}: ${name}`} data-feed-action="lira" tabIndex={tab}>
            <LiraMark />
          </button>
        ) : null}
        <button type="button" className="station-feed-action" onClick={onOpenTools} aria-label={`${labels.tools}: ${name}`} data-feed-action="expand" tabIndex={tab}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" /></svg>
        </button>
      </div>

      <div ref={storyRef} className="calm-feed-story">
        <button type="button" className="calm-feed-place" onClick={onOpenPlace} aria-label={`${labels.place}: ${country || name}`} data-feed-action="place" tabIndex={tab}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c-6 5-6 13 0 18 6-5 6-13 0-18" /></svg>
          <span>{country || place || name}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" /></svg>
        </button>
        <div className="calm-feed-identity">
          <span className="calm-feed-status" data-status={status}>{statusText}</span>
          <h2 className="station-feed-card-name">{name}</h2>
          {genres || place ? <p>{[genres, place].filter(Boolean).join(' · ')}</p> : null}
        </div>
        <div className="calm-feed-track" data-feed-track={liveTrack ? 'live' : lastFind ? 'find' : 'none'}>
          <div>
            {liveTrack ? (
              <><span>{labels.nowPlaying}</span><strong>{liveTrack}</strong></>
            ) : lastFind ? (
              <><span>{labels.lastFind}</span><strong>{lastFind}</strong></>
            ) : (
              <small>{isCurrent ? labels.noTrack : labels.startToCatch}</small>
            )}
          </div>
          <button type="button" className="station-feed-action calm-feed-capture" onClick={onCapture} aria-label={capture.saved ? labels.saved : labels.save} aria-pressed={capture.saved} disabled={!capture.enabled} data-feed-action="capture" tabIndex={tab}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z" fill={capture.saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
          </button>
        </div>
        <div className="calm-feed-transport">
          <button
            type="button"
            className={`calm-feed-listen ${isPlaying ? 'is-playing' : ''}`.trim()}
            onClick={onTogglePlayback}
            aria-label={`${isPlaying ? labels.pause : labels.play}: ${name}`}
            data-feed-action="play"
            data-feed-playback-action={active ? '' : undefined}
            tabIndex={tab}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">{isPlaying ? <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" /> : <path d="M8 5v14l11-7L8 5Z" />}</svg>
            <span>{isPlaying ? labels.pause : labels.play}</span>
            <FeedWaveform active={isPlaying} subscribe={subscribe} />
          </button>
        </div>
      </div>
    </div>
  );
};
