import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { StationLite } from '../types';
import type { UserCollection } from '../domain/contracts';
import { StationArtwork } from '../components/StationArtwork';
import { getApiBase } from '../lib/apiBase';
import { resolveStationsInOrder, type SharedPlaylist } from '../lib/collectionShare';
import { stationLocation } from '../lib/stationUtils';
import { useLocale } from '../state/LocaleContext';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary, usePlayback } from '../state/RadioContext';
import { CollectionSleeve } from './LibraryCollectionHome';
import './SharedPlaylistScreen.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; playlist: SharedPlaylist; stations: Array<StationLite | null> }
  | { status: 'missing' }
  | { status: 'error' };

type Props = { token: string; onClose: () => void };

export const SharedPlaylistScreen = ({ token, onClose }: Props) => {
  const { t } = useLocale();
  const { fetchStationById } = useCatalog();
  const { copySharedCollection } = useLibrary();
  const { playStation, playStationQueue } = usePlayback();
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const savedRef = useRef(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loadSequenceRef = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequenceRef.current;
    setLoadState({ status: 'loading' });
    try {
      const response = await fetch(`${getApiBase()}/share/collections/${encodeURIComponent(token)}`, {
        cache: 'no-store'
      });
      if (response.status === 404) {
        if (loadSequenceRef.current === sequence) setLoadState({ status: 'missing' });
        return;
      }
      if (!response.ok) throw new Error(`Playlist load failed (${response.status})`);
      const data = (await response.json()) as { playlist?: SharedPlaylist };
      const playlist = data.playlist;
      if (
        !playlist ||
        !Array.isArray(playlist.stationIds) ||
        playlist.stationIds.length > 128 ||
        playlist.stationIds.some((id) => typeof id !== 'string' || !id.trim())
      ) throw new Error('Invalid shared playlist');
      const stations = await resolveStationsInOrder(playlist.stationIds, fetchStationById, 4);
      if (loadSequenceRef.current === sequence) setLoadState({ status: 'ready', playlist, stations });
    } catch {
      if (loadSequenceRef.current === sequence) setLoadState({ status: 'error' });
    }
  }, [fetchStationById, token]);

  useEffect(() => {
    void load();
    return () => { loadSequenceRef.current += 1; };
  }, [load]);

  const collection = useMemo<UserCollection | null>(() => {
    if (loadState.status !== 'ready') return null;
    const now = loadState.playlist.updatedAt || Date.now();
    return {
      id: `shared-${token}`,
      name: loadState.playlist.name,
      description: loadState.playlist.description,
      stationIds: loadState.playlist.stationIds,
      isPublic: true,
      updatedAt: now,
      createdAt: now,
      pinned: false
    };
  }, [loadState, token]);

  const availableStations = useMemo(
    () => loadState.status === 'ready'
      ? loadState.stations.filter((station): station is StationLite => station !== null)
      : [],
    [loadState]
  );

  const saveCopy = () => {
    if (!collection || loadState.status !== 'ready' || savingRef.current || savedRef.current || saved) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    const added = copySharedCollection({
      name: collection.name,
      description: collection.description,
      stationIds: collection.stationIds,
      stations: availableStations
    });
    savingRef.current = false;
    setSaving(false);
    if (added) {
      savedRef.current = true;
      setSaved(true);
    }
    else setSaveError(t('collectionShare.collectionLimit'));
  };

  const listen = () => {
    if (!availableStations.length) return;
    void playStationQueue(availableStations, {
      sourceId: 'shared-playlist',
      sourceLabel: t('collectionShare.sharedPlaylist')
    });
  };

  return (
    <section className="shared-playlist-screen" aria-labelledby="shared-playlist-title">
      <header className="shared-playlist-topbar">
        <button type="button" className="shared-playlist-back" onClick={onClose}>{t('common.back')}</button>
        <span>{t('collectionShare.sharedPlaylist')}</span>
      </header>

      {loadState.status === 'loading' ? (
        <div className="shared-playlist-state" role="status">{t('collectionShare.loading')}</div>
      ) : loadState.status === 'error' ? (
        <div className="shared-playlist-state" role="alert">
          <p>{t('collectionShare.networkError')}</p>
          <button type="button" className="shared-playlist-button" onClick={() => void load()}>{t('common.retry')}</button>
        </div>
      ) : loadState.status === 'missing' ? (
        <div className="shared-playlist-state" role="status">
          <h1 id="shared-playlist-title">{t('collectionShare.unavailableTitle')}</h1>
          <p>{t('collectionShare.unavailable')}</p>
        </div>
      ) : collection ? (
        <div className="shared-playlist-content">
          <header className="shared-playlist-heading">
            <CollectionSleeve collection={collection} stations={availableStations} className="shared-playlist-sleeve" />
            <div className="shared-playlist-copy">
              <p className="shared-playlist-eyebrow">{t('collectionShare.sharedPlaylist')}</p>
              <h1 id="shared-playlist-title">{collection.name}</h1>
              {collection.description ? <p className="shared-playlist-description">{collection.description}</p> : null}
              <p className="shared-playlist-count">
                {t('collectionShare.availableCount', { available: availableStations.length, total: collection.stationIds.length })}
                {loadState.stations.filter((station) => station === null).length > 0 ? (
                  <span> · {t('collectionShare.unavailableCount', { count: loadState.stations.filter((station) => station === null).length })}</span>
                ) : null}
              </p>
            </div>
            <div className="shared-playlist-actions">
              <button type="button" className="shared-playlist-button is-primary" disabled={!availableStations.length} onClick={listen}>
                {t('library.playCollection')}
              </button>
              <button type="button" className="shared-playlist-button" disabled={saving || saved} onClick={saveCopy}>
                {saved ? t('collectionShare.saved') : saving ? t('collectionShare.working') : t('collectionShare.saveCopy')}
              </button>
            </div>
            {saveError ? <p className="shared-playlist-error" role="alert">{saveError}</p> : null}
          </header>

          <ol className="shared-playlist-rows" aria-label={t('collectionShare.stationList')}>
            {loadState.stations.map((station, index) => (
              <li className={`shared-playlist-row${station ? '' : ' is-unavailable'}`} key={`${collection.stationIds[index]}-${index}`}>
                <span className="shared-playlist-order">{String(index + 1).padStart(2, '0')}</span>
                {station ? (
                  <>
                    <StationArtwork station={station} size="sm" />
                    <span className="shared-playlist-station-copy">
                      <span className="shared-playlist-station-name">{station.name}</span>
                      <span className="shared-playlist-station-location">{stationLocation(station) || t('collectionShare.locationUnknown')}</span>
                    </span>
                    <button
                      type="button"
                      className="shared-playlist-row-play"
                      aria-label={t('collectionShare.listenStation', { station: station.name })}
                      onClick={() => playStation(station, {
                        sourceId: 'shared-playlist',
                        sourceLabel: t('collectionShare.sharedPlaylist'),
                        playlist: availableStations
                      })}
                    >
                      {t('library.playCollection')}
                    </button>
                  </>
                ) : (
                  <span className="shared-playlist-station-missing">{t('collectionShare.stationUnavailable')}</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
};
