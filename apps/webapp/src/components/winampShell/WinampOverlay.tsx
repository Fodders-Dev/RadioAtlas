import { Suspense, lazy, type CSSProperties, type ReactNode } from 'react';
import type { StationLite } from '../../types';
import type { TrackHistoryItem } from '../../state/radio/types';
import type { ResponsiveExpandedMode } from './runtime';
import { StationArtwork } from '../StationArtwork';

const LazyMilkdropVisualizer = lazy(async () => {
  const mod = await import('../WinampMilkdropVisualizer');
  return {
    default: mod.WinampMilkdropVisualizer
  };
});

type QueuePreview = {
  items: StationLite[];
  currentIndex: number;
  sourceLabel: string | null;
};

type VisualizerState = {
  active: boolean;
  available: boolean;
  spectrum: number[];
  waveform: number[];
};

type WinampOverlayProps = {
  expandedLayoutMode: ResponsiveExpandedMode;
  t: (key: string, vars?: Record<string, string | number>) => string;
  current: StationLite | null;
  queue: QueuePreview;
  playbackHistory: StationLite[];
  trackHistory: TrackHistoryItem[];
  visualizer: VisualizerState;
  showVisualizer?: boolean;
  mainStyle?: CSSProperties;
  host: ReactNode;
  loading: ReactNode;
  trackLine: ReactNode;
  actionStrip: ReactNode;
  onClose: () => void;
  onOpenSkinLab: () => void;
  onResetLayout: () => void;
  onPlayQueueStation: (station: StationLite) => void;
  onPlayHistoryStation: (station: StationLite) => void;
  onDetails?: () => void;
  onHideStation?: () => void;
  stationHidden?: boolean;
};

const renderStationMeta = (
  station: StationLite,
  fallback: string,
  activeStationId: string | null,
  onClick: (station: StationLite) => void,
  key: string
) => (
  <button
    className={`winamp-overlay-item winamp-overlay-item-button ${
      activeStationId === station.stationuuid ? 'active' : ''
    }`}
    key={key}
    type="button"
    onClick={() => onClick(station)}
  >
    <strong>{station.name}</strong>
    <span>{station.country || station.state || fallback}</span>
  </button>
);

export default function WinampOverlay({
  actionStrip,
  current,
  expandedLayoutMode,
  host,
  loading,
  mainStyle,
  onClose,
  onDetails,
  onHideStation,
  onOpenSkinLab,
  onPlayHistoryStation,
  onPlayQueueStation,
  onResetLayout,
  playbackHistory,
  queue,
  showVisualizer = true,
  stationHidden = false,
  t,
  trackHistory,
  trackLine,
  visualizer
}: WinampOverlayProps) {
  const overlayQueuePreview = queue.items
    .slice(Math.max(queue.currentIndex, 0), Math.max(queue.currentIndex, 0) + 4)
    .filter(Boolean);
  const overlayHistoryPreview = playbackHistory.slice().reverse().slice(0, 4);
  const currentStationName = current?.name || queue.items[queue.currentIndex]?.name || t('winamp.noStation');
  const queueLabel = queue.sourceLabel || t('radio.queueDefault');
  const unknownLabel = t('common.unknown');
  const recentTrackPreview = (current
    ? trackHistory.filter((item) => item.stationId === current.stationuuid)
    : trackHistory
  )
    .filter((item) => item.track.trim())
    .slice(0, 4);

  return (
    <>
      {expandedLayoutMode === 'mobile' ? (
        <div className="winamp-overlay-backdrop" aria-hidden="true" />
      ) : null}
      <div className="winamp-overlay-header">
        <div className="winamp-overlay-header-actions">
          <button
            className="winamp-close-btn"
            type="button"
            onClick={onClose}
            aria-label={t('winamp.closeWinamp')}
            title={t('winamp.closeWinamp')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z" />
            </svg>
            <span>{t('winamp.closeWinamp')}</span>
          </button>
          <button className="chip active" type="button" onClick={onOpenSkinLab}>
            {t('skin.openLab')}
          </button>
          {expandedLayoutMode === 'desktop' ? (
            <button className="chip" type="button" onClick={onResetLayout}>
              {t('winamp.resetLayout')}
            </button>
          ) : null}
        </div>
      </div>

      <div className="winamp-compact-main" style={mainStyle}>
        {host}
        {expandedLayoutMode === 'desktop' ? (
          <aside className="winamp-overlay-sidebar">
            <div className="winamp-overlay-card winamp-overlay-now-card">
              <div className="winamp-overlay-label">{t('winamp.nowTuned')}</div>
              <div className="winamp-overlay-art-row">
                <StationArtwork station={current} size="card" className="winamp-now-artwork" />
                <div>
                  <div className="winamp-overlay-title">{currentStationName}</div>
                  <div className="winamp-overlay-copy">
                    {queueLabel} - {t('winamp.queueReady', { count: queue.items.length })}
                  </div>
                </div>
              </div>
              <div className="winamp-overlay-mini-actions">
                {onDetails ? (
                  <button className="chip" type="button" onClick={onDetails} disabled={!current}>
                    {t('winamp.stationDetails')}
                  </button>
                ) : null}
                {onHideStation ? (
                  <button className="chip" type="button" onClick={onHideStation} disabled={!current}>
                    {stationHidden ? t('winamp.showStation') : t('winamp.hideStation')}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="winamp-overlay-card">
              <div className="winamp-overlay-label">{t('winamp.upNext')}</div>
              <div className="winamp-overlay-list">
                {overlayQueuePreview.length ? (
                  overlayQueuePreview.map((station) =>
                    renderStationMeta(
                      station,
                      unknownLabel,
                      current?.stationuuid || null,
                      onPlayQueueStation,
                      station.stationuuid
                    )
                  )
                ) : (
                  <div className="winamp-overlay-empty">{t('winamp.buildQueue')}</div>
                )}
              </div>
            </div>
          </aside>
        ) : null}
        {loading}
      </div>

      <div className="winamp-overlay-footer">
        <div className="winamp-overlay-summary">
          {showVisualizer ? (
            <div
              className="winamp-overlay-card winamp-overlay-visualizer-card"
              data-active={visualizer.active ? 'true' : 'false'}
              data-available={visualizer.available ? 'true' : 'false'}
            >
              <div className="winamp-overlay-label">{t('winamp.visualizer')}</div>
              <div className="winamp-overlay-visualizer" aria-hidden="true">
                <Suspense fallback={null}>
                  <LazyMilkdropVisualizer
                    active={visualizer.active}
                    available={visualizer.available}
                    spectrum={visualizer.spectrum}
                    waveform={visualizer.waveform}
                  />
                </Suspense>
              </div>
              <div className="winamp-overlay-copy">
                {visualizer.available ? t('winamp.visualizerLive') : t('winamp.visualizerWaiting')}
              </div>
            </div>
          ) : null}
          <div className="winamp-overlay-card winamp-overlay-now-card">
            <div className="winamp-overlay-label">{t('winamp.currentStation')}</div>
            <div className="winamp-overlay-art-row">
              <StationArtwork station={current} size="card" className="winamp-now-artwork" />
              <div>
                <div className="winamp-overlay-title">{currentStationName}</div>
                <div className="winamp-overlay-copy">
                  {queueLabel} - {t('winamp.queueCount', { count: queue.items.length })}
                </div>
              </div>
            </div>
            <div className="winamp-overlay-mini-actions">
              {onDetails ? (
                <button className="chip" type="button" onClick={onDetails} disabled={!current}>
                  {t('winamp.stationDetails')}
                </button>
              ) : null}
              {onHideStation ? (
                <button className="chip" type="button" onClick={onHideStation} disabled={!current}>
                  {stationHidden ? t('winamp.showStation') : t('winamp.hideStation')}
                </button>
              ) : null}
            </div>
          </div>
          <div className="winamp-overlay-card">
            <div className="winamp-overlay-label">{t('winamp.recentTracks')}</div>
            <div className="winamp-overlay-track-list">
              {recentTrackPreview.length ? (
                recentTrackPreview.map((item) => (
                  <div className="winamp-overlay-track-item" key={item.id}>
                    <strong>{item.track}</strong>
                    <span>{item.stationName}</span>
                  </div>
                ))
              ) : (
                <div className="winamp-overlay-empty">{t('details.recentTracksEmpty')}</div>
              )}
            </div>
          </div>
          <div className="winamp-overlay-card">
            <div className="winamp-overlay-label">{t('winamp.recentSessions')}</div>
            <div className="winamp-overlay-list">
              {overlayHistoryPreview.length ? (
                overlayHistoryPreview.map((station) =>
                  renderStationMeta(
                    station,
                    unknownLabel,
                    current?.stationuuid || null,
                    onPlayHistoryStation,
                    `${station.stationuuid}-${station.name}`
                  )
                )
              ) : (
                <div className="winamp-overlay-empty">{t('winamp.historyEmpty')}</div>
              )}
            </div>
          </div>
        </div>
        {trackLine}
        {actionStrip}
      </div>
    </>
  );
}
