import { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../lib/useDialog';
import { normalizeStationName } from '../lib/stationUtils';
import { localizedCountry } from '../lib/countryName';
import { useLocale } from '../state/LocaleContext';
import type { StationLite } from '../types';
import { StationArtwork } from '../components/StationArtwork';
import './feedQueuePeek.css';

type FeedQueuePeekProps = {
  stations: StationLite[];
  activeIndex: number;
  currentStationId: string | null;
  playbackStatus: 'playing' | 'paused' | 'connecting' | 'error' | 'idle';
  sourceLabel: string;
  queueMode: boolean;
  canEditQueue: boolean;
  onClose: () => void;
  onSelect: (station: StationLite, index: number) => void;
  onEditQueue: () => void;
  restoreFocusTo: () => HTMLElement | null;
};

export function FeedQueuePeek({
  stations,
  activeIndex,
  currentStationId,
  playbackStatus,
  sourceLabel,
  queueMode,
  canEditQueue,
  onClose,
  onSelect,
  onEditQueue,
  restoreFocusTo
}: FeedQueuePeekProps) {
  const { t, locale } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [previousOpen, setPreviousOpen] = useState(false);
  useDialog(rootRef, { isOpen: true, onClose, restoreFocusTo });

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={rootRef}
      className="bottom-sheet feed-queue-peek"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-feed-queue-peek
    >
      <button
        className="bottom-sheet-scrim feed-queue-peek-scrim"
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        data-dialog-backdrop
      />
      <section className="bottom-sheet-card feed-queue-peek-panel" aria-labelledby={titleId}>
        <span className="bottom-sheet-handle feed-queue-peek-handle" aria-hidden="true" />
        <header className="bottom-sheet-head feed-queue-peek-head">
          <div className="feed-queue-peek-heading">
            <span className="bottom-sheet-kicker feed-queue-peek-kicker">{sourceLabel}</span>
            <h2 id={titleId} className="bottom-sheet-title feed-queue-peek-title">
              {queueMode ? t('journal.queueContext') : t('journal.feedDeck')}
            </h2>
            <p className="feed-queue-peek-position">
              {stations.length
                ? t('journal.queuePeekPosition', {
                    index: String(Math.min(activeIndex + 1, stations.length)),
                    total: String(stations.length)
                  })
                : t('journal.queuePeekEmpty')}
            </p>
          </div>
          <button
            className="bottom-sheet-close feed-queue-peek-close"
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            data-dialog-initial-focus
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m7.4 8.6 1.4-1.4 3.2 3.2 3.2-3.2 1.4 1.4-3.2 3.2 3.2 3.2-1.4 1.4-3.2-3.2-3.2 3.2-1.4-1.4 3.2-3.2-3.2-3.2Z" />
            </svg>
          </button>
        </header>

        <div className="feed-queue-peek-body" data-feed-queue-peek-body>
          {stations.length ? (
            <>
            <ol className="feed-queue-peek-list" aria-label={t('journal.queuePeekList')}>
            {stations.slice(Math.min(activeIndex, stations.length - 1)).map((station, offset) => {
              const index = Math.min(activeIndex, stations.length - 1) + offset;
              const current = index === activeIndex;
              const onAir = station.stationuuid === currentStationId;
              const name = normalizeStationName(station.name);
              const place = localizedCountry(station, locale);
              const statusLabel = onAir
                ? playbackStatus === 'playing'
                  ? t('journal.queuePeekPlaying')
                  : playbackStatus === 'connecting'
                    ? t('journal.queuePeekConnecting')
                    : playbackStatus === 'error'
                      ? t('journal.queuePeekError')
                      : t('journal.queuePeekPaused')
                : current
                  ? t('journal.queuePeekSelected')
                  : place;
              const actionLabel = onAir && playbackStatus === 'playing'
                ? t('journal.queuePeekReveal', { name })
                : onAir && playbackStatus === 'paused'
                  ? t('journal.queuePeekResume', { name })
                  : onAir && playbackStatus === 'error'
                    ? t('journal.queuePeekRetry', { name })
                    : onAir && playbackStatus === 'connecting'
                      ? t('journal.queuePeekReveal', { name })
                      : t('journal.queuePeekPlay', { name });
              const actionIntent = onAir && (playbackStatus === 'playing' || playbackStatus === 'connecting')
                ? 'reveal'
                : onAir && playbackStatus === 'paused'
                  ? 'resume'
                  : onAir && playbackStatus === 'error'
                    ? 'retry'
                    : 'play';
              return (
                <li key={`${station.stationuuid}-${index}`} aria-posinset={index + 1} aria-setsize={stations.length} data-feed-queue-index={index + 1}>
                  <button
                    className={`feed-queue-peek-row${current ? ' is-current' : ''}`}
                    type="button"
                    onClick={() => onSelect(station, index)}
                    aria-current={current ? 'true' : undefined}
                    aria-label={actionLabel}
                    data-feed-queue-row={station.stationuuid}
                    data-feed-queue-index={index + 1}
                  >
                    <span className="feed-queue-peek-index" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <StationArtwork station={station} size="sm" className="feed-queue-peek-art" />
                    <span className="feed-queue-peek-copy">
                      <strong>{name}</strong>
                      {statusLabel ? <small>{statusLabel}</small> : null}
                    </span>
                    <span className="feed-queue-peek-action" aria-hidden="true" data-feed-queue-intent={actionIntent}>
                      {onAir && playbackStatus === 'playing'
                        ? t('journal.queuePeekRevealLabel')
                        : onAir && playbackStatus === 'connecting'
                          ? t('journal.queuePeekRevealLabel')
                          : onAir && playbackStatus === 'error'
                            ? t('journal.queuePeekRetryLabel')
                            : onAir && playbackStatus === 'paused'
                          ? t('journal.queuePeekResumeLabel')
                          : t('journal.queuePeekPlayLabel')}
                    </span>
                  </button>
                </li>
              );
            })}
            </ol>
            {activeIndex > 0 ? (
              <div className={`feed-queue-peek-previous${previousOpen ? ' is-open' : ''}`}>
              <button
                className="feed-queue-peek-previous-toggle"
                type="button"
                onClick={() => setPreviousOpen((open) => !open)}
                aria-expanded={previousOpen}
              >
                {t('journal.queuePeekPrevious')}
              </button>
                {previousOpen ? (
                  <ol className="feed-queue-peek-list" aria-label={t('journal.queuePeekPrevious')}>
                  {stations.slice(0, activeIndex).map((station, index) => (
                    <li key={`${station.stationuuid}-${index}`} aria-posinset={index + 1} aria-setsize={stations.length} data-feed-queue-index={index + 1}>
                      <button
                        className="feed-queue-peek-row"
                        type="button"
                        onClick={() => onSelect(station, index)}
                        aria-label={t('journal.queuePeekPlay', { name: normalizeStationName(station.name) })}
                        data-feed-queue-row={station.stationuuid}
                        data-feed-queue-index={index + 1}
                      >
                        <span className="feed-queue-peek-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                        <StationArtwork station={station} size="sm" className="feed-queue-peek-art" />
                        <span className="feed-queue-peek-copy">
                          <strong>{normalizeStationName(station.name)}</strong>
                          {localizedCountry(station, locale) ? <small>{localizedCountry(station, locale)}</small> : null}
                        </span>
                        <span className="feed-queue-peek-action" aria-hidden="true" data-feed-queue-intent="play">{t('journal.queuePeekPlayLabel')}</span>
                      </button>
                    </li>
                  ))}
                  </ol>
                ) : null}
              </div>
            ) : null}
            </>
          ) : (
            <p className="feed-queue-peek-empty">{t('journal.queuePeekEmpty')}</p>
          )}
        </div>

        {canEditQueue ? (
          <button className="feed-queue-peek-edit" type="button" onClick={onEditQueue}>
            {t('journal.queuePeekEdit')}
          </button>
        ) : null}
      </section>
    </div>,
    document.body
  );
}
