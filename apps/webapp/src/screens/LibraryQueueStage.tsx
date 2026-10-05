import type { StationLite } from '../types';
import { StationArtwork } from '../components/StationArtwork';
import { stationGenreFamily, stationGenreSlug } from '../lib/stationGenre';
import { normalizeStationName, stationLocation } from '../lib/stationUtils';
import { useLocale } from '../state/LocaleContext';
import './LibraryQueueStage.css';

export type LibraryQueueStageStatus = 'start' | 'ready' | 'playing' | 'buffering' | 'error' | 'paused';

type LibraryQueueStageProps = {
  station: StationLite;
  status: LibraryQueueStageStatus;
  nowPlaying: string | null;
  source: string;
  position: string;
  onPlay: () => void;
  onPause: () => void;
  onFeed: () => void;
};

const STATUS_KEYS: Record<LibraryQueueStageStatus, string> = {
  start: 'library.queueStageStart',
  ready: 'library.queueStageReady',
  playing: 'library.queueStagePlaying',
  buffering: 'library.queueStageBuffering',
  error: 'library.queueStageError',
  paused: 'library.queueStagePaused'
};

export function LibraryQueueStage({ station, status, nowPlaying, source, position, onPlay, onPause, onFeed }: LibraryQueueStageProps) {
  const { t } = useLocale();
  const name = normalizeStationName(station.name);
  const genre = stationGenreSlug(station);
  const actualFamily = stationGenreFamily(station);
  const family = actualFamily ?? 'pop';
  const genreLabel = genre ? t(`genre.${genre}`) : actualFamily ? t(`mapExplorer.families.${actualFamily}`) : '';
  const isPlaying = status === 'playing';

  return (
    <section className="library-queue-stage" data-queue-current={station.stationuuid} data-stage-status={status} aria-label={t('library.queueCurrent')}>
      <div className={`library-queue-stage-print family-${family}`} aria-hidden="true">
        <span className="library-queue-stage-grooves" />
        <span className="library-queue-stage-art"><StationArtwork station={station} size="md" /></span>
        <span className="library-queue-stage-mark">RA</span>
      </div>
      <div className="library-queue-stage-copy">
        <div className="library-queue-stage-status" data-stage-status-text>
          <span className="library-queue-stage-status-dot" aria-hidden="true" />
          {t(STATUS_KEYS[status])}
        </div>
        <h2 className="library-queue-stage-name" title={name}>{name}</h2>
        <p className="library-queue-stage-meta">{[stationLocation(station), genreLabel].filter(Boolean).join(' · ')}</p>
        {nowPlaying ? <p className="library-queue-stage-track" title={nowPlaying}>{nowPlaying}</p> : null}
        <p className="library-queue-stage-context"><span>{position}</span><span aria-hidden="true">·</span><span>{source}</span></p>
      </div>
      <div className="library-queue-stage-actions">
        <button className="library-queue-stage-primary" type="button" onClick={isPlaying ? onPause : onPlay} disabled={status === 'buffering'} aria-label={`${t(isPlaying ? 'common.pause' : 'common.play')}: ${name}`}>
          {isPlaying ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm7 0h4v14h-4z" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>}
          <span>{t(isPlaying ? 'common.pause' : 'common.play')}</span>
        </button>
        <button className="library-queue-stage-feed" type="button" onClick={onFeed}>{t('library.queueStageFeed')}</button>
      </div>
    </section>
  );
}
