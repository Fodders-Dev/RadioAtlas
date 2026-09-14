import { useLayoutEffect, useRef } from 'react';
import type { StationLite } from '../types';
import type { VisualizerFrame } from '../lib/useAudioPlayer';
import { formatCountryLabel, normalizeStationName, stationLocation, stationTags } from '../lib/stationUtils';
import { stationGenreFamily, type GenreFamily } from '../lib/stationGenre';
import { FeedWaveform } from '../components/FeedWaveform';
import { LiraMark } from '../components/LiraMark';
import './calmFeed.css';

// One station, one slide — the A4 «Журнал» Feed, composed exactly as the mock
// (docs/prototypes/directions, `feedScene` + `.station-slide`): a drawn scene
// behind (a big word, an orb, a ribbon or a disc, the warm palette), the tab
// label and the sleep timer at the top, the stepper under it, the rail with
// heart · Лира · more, and at the bottom the place, the station, the track
// that is REALLY on air with its bookmark, «Слушать эфир» with the live
// waveform and a separate button for volume and the rest, then the swipe hint.
//
// Nothing here is a demo: the word is the station's own genre family, the
// edition is its real position in the deck, the track is the trusted title or
// an honest line. Every control keeps its `data-feed-action` name (focus
// handoff on swipe, the #86 specs).

export type CalmFeedCardProps = {
  station: StationLite;
  active: boolean;
  isCurrent: boolean;
  isPlaying: boolean;
  status: 'idle' | 'playing' | 'paused' | 'connecting' | 'error';
  liveTrack: string | null;
  lastFind: string | null;
  favorite: boolean;
  aiEnabled: boolean;
  subscribe: (callback: (frame: VisualizerFrame) => void) => () => void;
  capture: { enabled: boolean; saved: boolean };
  // Position in the deck for the edition line («03 / RADIOATLAS»).
  index: number;
  onTogglePlayback: () => void;
  onToggleFavorite: () => void;
  onCapture: () => void;
  onAskLira: () => void;
  onOpenPlace: () => void;
  // «Ещё» (the rail) and the volume button both open the player tray.
  onOpenTools: () => void;
  onStep: (delta: -1 | 1) => void;
  canStep: { prev: boolean; next: boolean };
  // At the end of the listener's own queue: the deliberate step into the
  // discovery deck (never automatic — the queue ending changes no sound).
  onContinue?: () => void;
  timer: { label: string; active: boolean; onOpen: () => void };
  labels: {
    play: string; pause: string; like: string; unlike: string; save: string; saved: string;
    lira: string; tools: string; volume: string; place: string; nowPlaying: string; lastFind: string; noTrack: string; startToCatch: string;
    onAir: string; pausedStatus: string; idleStatus: string; connecting: string; failed: string;
    prev: string; next: string; timer: string; hint: string; tab: string; liveMusic: string; queueEnd: string; queueContinue: string;
    sceneWords: Record<GenreFamily | 'unknown', string>;
  };
};

// The mock's four scene kinds, chosen by the station's genre family.
type SceneKind = 'liquid' | 'vinyl' | 'ambient' | 'rhythm';
const sceneKindOf = (family: GenreFamily | null): SceneKind => {
  if (family === 'jazz') return 'vinyl';
  if (family === 'chill' || family === 'classical') return 'ambient';
  if (family === 'electronic' || family === 'hiphop' || family === 'rock') return 'rhythm';
  return 'liquid';
};

const Chevron = ({ up = false }: { up?: boolean }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>
);

export const CalmFeedCard = ({
  station, active, isCurrent, isPlaying, status, liveTrack, lastFind, favorite, aiEnabled, subscribe, capture, index,
  onTogglePlayback, onToggleFavorite, onCapture, onAskLira, onOpenPlace, onOpenTools, onStep, canStep, timer, labels, onContinue
}: CalmFeedCardProps) => {
  const railRef = useRef<HTMLDivElement>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // Focus handoff on swipe (see FeedCard): a control focused on the card that
  // just went inactive moves to the same control on the card that became
  // active, without scrolling — a scroll is what the pager reads as a play.
  useLayoutEffect(() => {
    if (active) return;
    const doc = railRef.current?.ownerDocument;
    const focused = doc?.activeElement;
    if (!doc || !(focused instanceof HTMLElement)) return;
    const inside = [railRef, storyRef, topRef].some((ref) => ref.current?.contains(focused));
    if (!inside) return;
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
  const family = stationGenreFamily(station);
  const kind = sceneKindOf(family);
  const word = labels.sceneWords[family ?? 'unknown'];
  const tab = active ? undefined : -1;
  const statusText =
    status === 'playing' ? labels.onAir : status === 'paused' ? labels.pausedStatus : status === 'connecting' ? labels.connecting : status === 'error' ? labels.failed : labels.idleStatus;

  return (
    <div className="station-feed-card-content calm-slide" data-focus={active ? 'true' : 'false'} data-playing={isPlaying ? 'true' : 'false'} data-status={status} data-scene={kind}>
      <div className={`calm-scene calm-scene--${kind}`} aria-hidden="true">
        <div className="calm-scene-orb" />
        <div className="calm-scene-ribbon" />
        <div className="calm-scene-disc"><i /></div>
        <span className="calm-scene-word">{word}</span>
        <span className="calm-scene-edition">{String(index + 1).padStart(2, '0')} / RADIOATLAS</span>
      </div>
      <div className="calm-scene-shade" aria-hidden="true" />

      <div ref={topRef} className="calm-slide-top" aria-hidden={active ? undefined : 'true'}>
        <span className="calm-slide-tab">{labels.tab}</span>
        <button type="button" className={`calm-slide-icon calm-slide-timer ${timer.active ? 'is-on' : ''}`.trim()} onClick={timer.onOpen} aria-label={labels.timer} data-feed-action="timer" data-minutes={timer.active ? timer.label : ''} tabIndex={tab}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6M12 7v6l3 2M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0" /></svg>
        </button>
      </div>

      <div ref={railRef} className="station-feed-card-actions calm-slide-rail" aria-hidden={active ? undefined : 'true'}>
        <div className="calm-slide-stepper">
          <button type="button" className="calm-slide-icon" onClick={() => onStep(-1)} disabled={!canStep.prev} aria-label={labels.prev} data-feed-action="prev" tabIndex={tab}><Chevron up /></button>
          <button type="button" className="calm-slide-icon" onClick={() => onStep(1)} disabled={!canStep.next} aria-label={labels.next} data-feed-action="next" tabIndex={tab}><Chevron /></button>
        </div>
        <button type="button" className={`station-feed-action calm-rail-button ${favorite ? 'is-on' : ''}`.trim()} onClick={onToggleFavorite} aria-pressed={favorite} aria-label={`${favorite ? labels.unlike : labels.like}: ${name}`} data-feed-action="favorite" tabIndex={tab}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8" fill={favorite ? 'currentColor' : 'none'} /></svg>
        </button>
        {aiEnabled ? (
          <button type="button" className="station-feed-action calm-rail-button" onClick={onAskLira} aria-label={`${labels.lira}: ${name}`} data-feed-action="lira" tabIndex={tab}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" /></svg>
            <span className="visually-hidden"><LiraMark /></span>
          </button>
        ) : null}
        <button type="button" className="station-feed-action calm-rail-button" onClick={onOpenTools} aria-label={`${labels.tools}: ${name}`} data-feed-action="expand" tabIndex={tab}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h.01M12 12h.01M20 12h.01" /></svg>
        </button>
      </div>

      <div ref={storyRef} className="calm-slide-story">
        <button type="button" className="calm-place-link" onClick={onOpenPlace} aria-label={`${labels.place}: ${country || name}`} data-feed-action="place" tabIndex={tab}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c-6 5-6 13 0 18 6-5 6-13 0-18" /></svg>
          <span>{country || place || name}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5" /></svg>
        </button>
        <div className="calm-slide-identity">
          <span className="calm-feed-status calm-air-status" data-status={status}>{statusText}</span>
          <h1 className="station-feed-card-name">{name}</h1>
          <p>{[genres, place].filter(Boolean).join(' · ') || labels.liveMusic}</p>
        </div>
        <div className="calm-feed-track calm-slide-track" data-feed-track={liveTrack ? 'live' : lastFind ? 'find' : 'none'}>
          <div>
            {liveTrack ? (
              <><span>{labels.nowPlaying}</span><strong>{liveTrack}</strong></>
            ) : lastFind ? (
              <><span>{labels.lastFind}</span><strong>{lastFind}</strong></>
            ) : (
              <small>{isCurrent ? labels.noTrack : labels.startToCatch}</small>
            )}
          </div>
          <button type="button" className="station-feed-action calm-round calm-feed-capture" onClick={onCapture} aria-label={capture.saved ? labels.saved : labels.save} aria-pressed={capture.saved} disabled={!capture.enabled} data-feed-action="capture" tabIndex={tab}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3Z" fill={capture.saved ? 'currentColor' : 'none'} /></svg>
          </button>
        </div>
        <div className="calm-slide-transport">
          <button
            type="button"
            className={`calm-listen ${isPlaying ? 'is-playing' : ''}`.trim()}
            onClick={onTogglePlayback}
            aria-label={`${isPlaying ? labels.pause : labels.play}: ${name}`}
            data-feed-action="play"
            data-feed-playback-action={active ? '' : undefined}
            tabIndex={tab}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">{isPlaying ? <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" /> : <path d="M8 5v14l11-7L8 5Z" />}</svg>
            <span>{isPlaying ? labels.pause : labels.play}</span>
            <FeedWaveform compact active={isPlaying} subscribe={subscribe} />
          </button>
          <button type="button" className="calm-slide-icon calm-volume" onClick={onOpenTools} aria-label={labels.volume} data-feed-action="volume" tabIndex={tab}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4zM17 8a6 6 0 0 1 0 8M20 5a10 10 0 0 1 0 14" /></svg>
          </button>
        </div>
      </div>
      {onContinue && !canStep.next
        ? <button type="button" className="calm-swipe-hint calm-queue-end" onClick={onContinue} data-feed-action="continue" tabIndex={tab}>{labels.queueEnd} · <b>{labels.queueContinue}</b></button>
        : <p className="calm-swipe-hint" aria-hidden="true"><Chevron up />{labels.hint}</p>}
    </div>
  );
};
