import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { UserCollection } from '../domain/contracts';
import { normalizeStationName, stationLocation } from '../lib/stationUtils';
import { useDialog } from '../lib/useDialog';
import { useLocale } from '../state/LocaleContext';
import type { StationLite } from '../types';
import { StationArtwork } from './StationArtwork';

export type StationPlaylistDialogProps = {
  station: StationLite;
  collections: UserCollection[];
  draft: string;
  onDraftChange: (value: string) => void;
  onClose: () => void;
  onAddToCollection: (collection: UserCollection) => void;
  onCreateCollection: () => void;
};

export function StationPlaylistDialog({
  station,
  collections,
  draft,
  onDraftChange,
  onClose,
  onAddToCollection,
  onCreateCollection
}: StationPlaylistDialogProps) {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useDialog(rootRef, { isOpen: true, onClose });

  if (typeof document === 'undefined') return null;

  const normalizedName = normalizeStationName(station.name);
  const createDisabled = !draft.trim();

  return createPortal(
    <div
      ref={rootRef}
      className="station-playlist-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <button
        className="station-playlist-dialog-scrim"
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        data-dialog-backdrop
      />
      <div className="station-playlist-dialog-card">
        <div className="station-playlist-dialog-head">
          <div>
            <div className="bottom-sheet-kicker">{t('library.tabs.collections')}</div>
            <div className="bottom-sheet-title" id={titleId}>
              {t('library.addToPlaylistTitle')}
            </div>
          </div>
          <button
            className="bottom-sheet-close"
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6 6.4 5Z" />
            </svg>
          </button>
        </div>

        <div className="station-playlist-target">
          <StationArtwork station={station} size="sm" />
          <div>
            <div className="station-playlist-target-name">{normalizedName}</div>
            <div className="station-playlist-target-meta">{stationLocation(station)}</div>
          </div>
        </div>

        <div className="station-playlist-options">
          {collections.length ? (
            collections.map((collection) => {
              const alreadyAdded = collection.stationIds.includes(station.stationuuid);
              const isFull = collection.stationIds.length >= 128;
              return (
                <button
                  key={collection.id}
                  className={`station-playlist-option ${alreadyAdded ? 'active' : isFull ? 'full' : ''}`}
                  type="button"
                  onClick={() => onAddToCollection(collection)}
                  disabled={alreadyAdded || isFull}
                >
                  <span>{collection.name}</span>
                  <em>
                    {alreadyAdded
                      ? t('library.collectionAlreadyHasStation')
                      : isFull
                        ? t('library.collectionFull')
                        : t('library.collectionCount', { count: collection.stationIds.length })}
                  </em>
                </button>
              );
            })
          ) : (
            <div className="station-playlist-empty">{t('library.noPlaylistsYet')}</div>
          )}
        </div>

        <form
          className="station-playlist-create"
          onSubmit={(event) => {
            event.preventDefault();
            if (!createDisabled) onCreateCollection();
          }}
        >
          <input
            value={draft}
            maxLength={48}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={t('library.createCollectionPrompt')}
            aria-label={t('library.createCollectionPrompt')}
          />
          <button className="chip active" type="submit" disabled={createDisabled}>
            {t('library.createAndAddToPlaylist')}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}
