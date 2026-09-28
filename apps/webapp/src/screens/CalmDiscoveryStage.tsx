import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { StationLite } from '../types';
import { useLocale } from '../state/LocaleContext';
import { normalizeStationName } from '../lib/stationUtils';
import { localizedCountry } from '../lib/countryName';
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
  onSelectStation: (station: StationLite) => void;
  onToggleFavorite: () => void;
  onDiscover: () => void;
  onSource: () => void;
};

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const PREVIOUS = 'M18 5 7 12l11 7V5ZM5 5v14';
const NEXT = 'M6 5l11 7-11 7V5ZM19 5v14';
const INFO = 'M12 10.5v5M12 7.5h.01';
const PLAY = 'M7 4l13 8-13 8V4z';
const HEART = 'M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4z';

export function CalmDiscoveryStage({ station, status, statusLabel, country, details, track, favorite, isPlaying, canRetry, nextStations, hasNext, hasPrevious, canDiscover, onPlay, onNext, onPrevious, onSelectStation, onToggleFavorite, onDiscover, onSource }: Props) {
  const { t, locale } = useLocale();
  const [resolvedStory, setResolvedStory] = useState<{ stationId: string; story: StationStory } | null>(null);
  const [arrival, setArrival] = useState<{ stationId: string; direction: 'next' | 'previous' } | null>(null);
  const arrivalDirection = useRef<'next' | 'previous'>('next');
  const previousStationId = useRef(station.stationuuid);
  const cardRef = useRef<HTMLElement>(null);
  const arrivalAnimation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    if (previousStationId.current === station.stationuuid) return;
    previousStationId.current = station.stationuuid;
    setArrival({ stationId: station.stationuuid, direction: arrivalDirection.current });
    const card = cardRef.current;
    if (!card || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const offset = arrivalDirection.current === 'next' ? 44 : -44;
    const animation = card.animate([
      { transform: `translateX(${offset}px) rotate(${offset > 0 ? 2 : -2}deg)`, opacity: .78 },
      { transform: 'translateX(0) rotate(0)', opacity: 1 }
    ], { duration: 220, easing: 'cubic-bezier(.2,.8,.25,1)' });
    arrivalAnimation.current = animation;
    void animation.finished.then(() => {
      if (arrivalAnimation.current === animation) {
        animation.cancel();
        arrivalAnimation.current = null;
      }
    }).catch(() => undefined);
    return () => {
      if (arrivalAnimation.current === animation) {
        animation.cancel();
        arrivalAnimation.current = null;
      }
    };
  }, [station.stationuuid]);
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
  const nextLabel = t('journal.stageNext');
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
  const interruptArrival = () => { arrivalAnimation.current?.cancel(); arrivalAnimation.current = null; };
  const moveNext = () => { interruptArrival(); arrivalDirection.current = 'next'; onNext(); };
  const movePrevious = () => { interruptArrival(); arrivalDirection.current = 'previous'; onPrevious(); };
  const selectPreview = (preview: StationLite) => { interruptArrival(); arrivalDirection.current = 'next'; onSelectStation(preview); };
  useDockSwipe(stackRef, (direction) => {
    if (direction === 'next' && hasNext) moveNext();
    else if (direction === 'previous' && hasPrevious) movePrevious();
  }, hasNext || hasPrevious);

  return <section className="calm-discovery-stage" data-calm-offer={station.stationuuid} data-calm-air={status === 'playing' ? 'on' : status} data-calm-discovery-stage data-stage-status={status} data-genre-family={family} data-stage-turn={arrival?.stationId === station.stationuuid ? `${arrival.stationId}:${arrival.direction}` : undefined} aria-label={t('journal.stageLabel')}>
    <div ref={stackRef} className="calm-stage-deck" data-stage-cover-stack data-stage-preview-count={Math.min(nextStations.length, 2)} role="group" aria-label={t('journal.sourceOpen', { name })} onPointerDown={interruptArrival}>
      <article ref={cardRef} className="calm-stage-card" data-calm-card-current>
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
            <button className="calm-stage-prev" data-stage-previous type="button" onClick={movePrevious} disabled={!hasPrevious} aria-label={t('journal.feedPrev')}><Icon d={PREVIOUS} /></button>
            <button className="calm-stage-play" data-stage-play type="button" onClick={onPlay} aria-disabled={status === 'buffering' || undefined} aria-label={`${playLabel}: ${name}`}>
              <span aria-hidden="true">{canRetry ? '↻' : isPlaying ? 'Ⅱ' : '▶'}</span><span>{playLabel}</span>
            </button>
            {hasNext && <button className="calm-stage-next" data-stage-next type="button" onClick={moveNext} aria-label={`${nextLabel}: ${normalizeStationName(nextStations[0]?.name ?? '')}`}>
              <span>{nextLabel}</span><Icon d={NEXT} />
            </button>}
          </div>
          {!hasNext && <button className="calm-stage-discover" data-stage-discover type="button" onClick={onDiscover} disabled={!canDiscover}>{t('journal.stageDiscover')}<Icon d={NEXT} /></button>}
        </div>
      </article>
      {nextStations.slice(0, 2).map((next, index) => <button
        key={next.stationuuid}
        type="button"
        className={`calm-stage-preview calm-stage-preview-${index + 1}`}
        data-stage-preview={next.stationuuid}
        data-genre-family={stationGenreFamily(next) ?? 'pop'}
        data-dock-swipe-ignore
        onClick={() => selectPreview(next)}
        aria-label={t('journal.stageSelectPreview', { name: normalizeStationName(next.name) })}
      >
        <span className="calm-stage-preview-art"><StationArtwork station={next} size="md" /></span>
        <span className="calm-stage-preview-copy">
          <span className="calm-stage-preview-country">{localizedCountry(next, locale)}</span>
          <strong>{normalizeStationName(next.name)}</strong>
          <span className="calm-stage-preview-genre">{stationGenreSlug(next) ? t(`genre.${stationGenreSlug(next)}`) : t(`mapExplorer.families.${stationGenreFamily(next) ?? 'pop'}`)}</span>
          <span className="calm-stage-preview-play"><Icon d={PLAY} />{t('common.play')}</span>
        </span>
      </button>)}
    </div>
  </section>;
}
