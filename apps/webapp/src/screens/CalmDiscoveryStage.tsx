import { useEffect, useRef, useState } from 'react';
import type { StationLite } from '../types';
import { useLocale } from '../state/LocaleContext';
import { normalizeStationName } from '../lib/stationUtils';
import { stationGenreFamily, stationGenreSlug } from '../lib/stationGenre';
import { StationArtwork } from '../components/StationArtwork';
import { resolveStationStory, type StationStory } from '../lib/stationStory';
import { useDockSwipe } from '../lib/useDockSwipe';
import './calm-discovery-stage.css';

type Status = 'idle' | 'playing' | 'paused' | 'buffering' | 'error';

type Props = {
  station: StationLite;
  status: Status;
  statusLabel: string;
  country: string;
  details: string;
  track: string;
  favorite: boolean;
  isPlaying: boolean;
  canRetry: boolean;
  nextStations: StationLite[];
  hasNext: boolean;
  hasPrevious: boolean;
  canDiscover: boolean;
  onPlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleFavorite: () => void;
  onDiscover: () => void;
  onSource: () => void;
};

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const PREVIOUS = 'M18 5 7 12l11 7V5ZM5 5v14';
const NEXT = 'M6 5l11 7-11 7V5ZM19 5v14';
const INFO = 'M12 10.5v5M12 7.5h.01';
const HEART = 'M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4z';

export function CalmDiscoveryStage({ station, status, statusLabel, country, details, track, favorite, isPlaying, canRetry, nextStations, hasNext, hasPrevious, canDiscover, onPlay, onNext, onPrevious, onToggleFavorite, onDiscover, onSource }: Props) {
  const { t } = useLocale();
  const [resolvedStory, setResolvedStory] = useState<{ stationId: string; story: StationStory } | null>(null);
  useEffect(() => {
    const stationId = station.stationuuid;
    const controller = new AbortController();
    let live = true;
    setResolvedStory(null);
    void resolveStationStory(stationId, controller.signal).then((story) => {
      if (live && story) setResolvedStory({ stationId, story });
    }).catch(() => undefined);
    return () => { live = false; controller.abort(); };
  }, [station.stationuuid]);
  const name = normalizeStationName(station.name);
  const playLabel = canRetry ? t('journal.stageRetry') : isPlaying ? t('common.pause') : t('common.play');
  const nextLabel = hasNext ? t('journal.stageNext') : t('journal.stageDiscover');
  const statusText = status === 'idle' ? t('journal.stageReady') : statusLabel;
  const family = stationGenreFamily(station) ?? 'pop';
  const genreSlug = stationGenreSlug(station);
  const story = resolvedStory?.stationId === station.stationuuid ? resolvedStory.story : null;
  const description = station.description?.trim() || story?.description || '';
  const artists = story?.artists.slice(0, 3) ?? [];
  const artworkStation = story?.artworkUrl && !station.stationArtwork?.trim()
    ? { ...station, stationArtwork: story.artworkUrl }
    : station;
  const fallbackDetail = [genreSlug ? t(`genre.${genreSlug}`) : '', station.language?.split(',')[0]?.trim() || ''].filter(Boolean).join(' · ') || details;
  const stackRef = useRef<HTMLDivElement>(null);
  useDockSwipe(stackRef, (direction) => {
    if (direction === 'next') {
      if (hasNext) onNext();
      else if (canDiscover) onDiscover();
    } else if (hasPrevious) onPrevious();
  }, hasNext || hasPrevious || canDiscover);

  return <section className="calm-discovery-stage" data-calm-offer={station.stationuuid} data-calm-air={status === 'playing' ? 'on' : status} data-calm-discovery-stage data-stage-status={status} data-genre-family={family} aria-label={t('journal.stageLabel')}>
    <div ref={stackRef} className="calm-stage-deck" data-stage-cover-stack role="group" aria-label={t('journal.sourceOpen', { name })}>
      {nextStations.slice(0, 2).map((next, index) => <div key={next.stationuuid} className={`calm-stage-card-shadow calm-stage-card-shadow-${index + 1}`} aria-hidden="true">
        <span className="calm-stage-shadow-art" />
        <span className="calm-stage-shadow-name">{normalizeStationName(next.name)}</span>
      </div>)}
      <article className="calm-stage-card" data-calm-card-current>
        <div className="calm-stage-art" aria-hidden="true">
          <span className="calm-stage-art-disc" />
          <span className="calm-stage-art-orbit" />
          <span className="calm-stage-art-mark"><StationArtwork station={artworkStation} size="md" className="calm-stage-logo" priority /></span>
          <span className="calm-stage-art-label">{genreSlug ? t(`genre.${genreSlug}`) : ''}</span>
        </div>
        <button
          className="calm-stage-favorite"
          data-stage-favorite
          data-dock-swipe-ignore
          type="button"
          aria-pressed={favorite}
          aria-label={t(favorite ? 'journal.stageUnfavorite' : 'journal.stageFavorite', { name })}
          onClick={onToggleFavorite}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={HEART} fill={favorite ? 'currentColor' : 'none'} /></svg>
        </button>
        <div className="calm-stage-card-body">
          <div className="calm-stage-card-heading">
            <div className="calm-stage-card-copy">
              <span className="calm-stage-status"><i aria-hidden="true" />{statusText}</span>
              <h2 className="calm-stage-station" title={name}>{name}</h2>
              <span className="calm-stage-details">{country || fallbackDetail}</span>
            </div>
            <button className="calm-stage-info" data-dock-swipe-ignore type="button" onClick={onSource} aria-label={t('journal.sourceOpen', { name })} title={t('journal.sourceOpen', { name })}>
              <Icon d={INFO} />
            </button>
          </div>
          {(description || fallbackDetail) && <p className="calm-stage-description">{description || fallbackDetail}</p>}
          {artists.length > 0 && <p className="calm-stage-artists"><span>{t('journal.stageStoryArtists')}</span> {artists.join(' · ')}</p>}
          {track && <p className="calm-stage-track" title={track}>{track}</p>}
          {story && <a className="calm-stage-source" data-dock-swipe-ignore href={story.sourceUrl} target="_blank" rel="noreferrer">{t('journal.stageStorySource', { source: story.sourceLabel })}</a>}
          <div className="calm-stage-actions" data-dock-swipe-ignore>
            <button className="calm-stage-prev" data-stage-previous type="button" onClick={onPrevious} disabled={!hasPrevious} aria-label={t('journal.feedPrev')}><Icon d={PREVIOUS} /></button>
            <button className="calm-stage-play" data-stage-play type="button" onClick={onPlay} aria-disabled={status === 'buffering' || undefined} aria-label={`${playLabel}: ${name}`}>
              <span aria-hidden="true">{canRetry ? '↻' : isPlaying ? 'Ⅱ' : '▶'}</span><span>{playLabel}</span>
            </button>
            <button className="calm-stage-next" data-stage-next type="button" onClick={hasNext ? onNext : onDiscover} disabled={!hasNext && !canDiscover} aria-label={`${nextLabel}${hasNext && nextStations[0] ? `: ${normalizeStationName(nextStations[0].name)}` : ''}`}>
              <span>{nextLabel}</span><Icon d={NEXT} />
            </button>
          </div>
        </div>
      </article>
    </div>
  </section>;
}
