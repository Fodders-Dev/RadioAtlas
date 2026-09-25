import type { StationLite } from '../types';
import { StationArtwork } from '../components/StationArtwork';
import { useLocale } from '../state/LocaleContext';
import { normalizeStationName } from '../lib/stationUtils';
import { stationGenreFamily } from '../lib/stationGenre';
import { localizedCountry } from '../lib/countryName';
import './calm-discovery-stage.css';

type Status = 'idle' | 'playing' | 'paused' | 'buffering' | 'error';

type Props = {
  station: StationLite;
  status: Status;
  statusLabel: string;
  country: string;
  details: string;
  track: string;
  hasListener: boolean;
  isPlaying: boolean;
  canRetry: boolean;
  nextStations: StationLite[];
  nextPosition: number;
  queueSource: string;
  hasNext: boolean;
  canDiscover: boolean;
  onPlay: () => void;
  onNext: () => void;
  onSelectNext: (station: StationLite) => void;
  onDiscover: () => void;
  onSource: () => void;
  onFeed: () => void;
  onGlobe: () => void;
};

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const ARROW = 'M5 12h14M14 7l5 5-5 5';
const FEED = 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 6v6l5-3-5-3ZM12 1v2M12 21v2';
const GLOBE = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c-2.5 2.5-3.5 5.5-3.5 9s1 6.5 3.5 9c2.5-2.5 3.5-5.5 3.5-9s-1-6.5-3.5-9ZM3 12h18';

export function CalmDiscoveryStage({ station, status, statusLabel, country, details, track, hasListener, isPlaying, canRetry, nextStations, nextPosition, queueSource, hasNext, canDiscover, onPlay, onNext, onSelectNext, onDiscover, onSource, onFeed, onGlobe }: Props) {
  const { t, locale } = useLocale();
  const name = normalizeStationName(station.name);
  const playLabel = canRetry ? t('journal.stageRetry') : isPlaying ? t('common.pause') : hasListener ? t('common.play') : t('journal.play');
  const nextLabel = hasNext ? t('journal.stageNext') : t('journal.stageDiscover');
  const statusText = status === 'idle' ? t('journal.stageReady') : statusLabel;

  return <div className="calm-discovery-wrap">
    <section className="calm-discovery-stage" data-calm-offer={station.stationuuid} data-calm-air={status === 'playing' ? 'on' : status} data-calm-discovery-stage data-stage-status={status} aria-label={t('journal.stageLabel')}>
      <div className="calm-stage-main">
        <div className="calm-stage-identity">
          <span key={station.stationuuid} className="calm-stage-country">{country || t('journal.stageWorldRadio')}</span>
          <button className="calm-stage-station-row" onClick={onSource} aria-label={t('journal.sourceOpen', { name })}>
            <span className="calm-stage-art-button">
              <StationArtwork station={station} size="card" className="calm-stage-art" />
            </span>
            <span className="calm-stage-copy">
              <span className="calm-stage-status"><i aria-hidden="true" />{statusText}</span>
              <span className="calm-stage-station" title={name}>{name}</span>
              {track ? <span className="calm-stage-track">{track}</span> : details && <span className="calm-stage-details">{details}</span>}
            </span>
          </button>
        </div>
        <div className="calm-stage-actions">
          <button className="calm-stage-play" data-stage-play onClick={onPlay} aria-disabled={status === 'buffering' || undefined} aria-label={`${playLabel}: ${name}`}>
            <span aria-hidden="true">{canRetry ? '↻' : isPlaying ? 'Ⅱ' : '▶'}</span>{playLabel}
          </button>
          <button className="calm-stage-next" data-stage-next disabled={!hasNext && !canDiscover} onClick={hasNext ? onNext : onDiscover} aria-label={`${nextLabel}${hasNext && nextStations[0] ? `: ${normalizeStationName(nextStations[0].name)}` : ''}`}>
            <span>{nextLabel}</span><Icon d={ARROW} />
          </button>
        </div>
        <div className="calm-stage-illustration" aria-hidden="true"><i /><i /><i /><b /></div>
      </div>
      <aside className="calm-stage-upnext" aria-label={t('journal.stageUpNext')}>
        <div className="calm-stage-upnext-head"><strong>{t('journal.stageUpNext')}</strong>{queueSource && <small>{queueSource}</small>}</div>
        {nextStations.length ? <ol>
          {nextStations.map((next, index) => <li key={next.stationuuid}>
            <button data-stage-choice={next.stationuuid} onClick={() => onSelectNext(next)}>
              <span className="calm-stage-number">{String(nextPosition + index + 1).padStart(2, '0')}</span>
              <span className="calm-stage-choice-copy"><strong>{normalizeStationName(next.name)}</strong><small>{[localizedCountry(next, locale), (stationGenreFamily(next) ? t(`mapExplorer.families.${stationGenreFamily(next)}`) : '')].filter(Boolean).join(' · ')}</small></span>
              <span className="calm-stage-choice-play" aria-hidden="true">▶</span>
            </button>
          </li>)}
        </ol> : <p>{t('journal.stageNoNext')}</p>}
      </aside>
      <nav className="calm-stage-doors" data-calm-doors aria-label={t('journal.doorsLabel')}>
        <button className="calm-stage-door" data-calm-entry="feed" onClick={onFeed}><Icon d={FEED} /><span>{t('journal.dirFeed')}</span><Icon d={ARROW} /></button>
        <button className="calm-stage-door" data-calm-entry="globe" onClick={onGlobe}><Icon d={GLOBE} /><span>{t('journal.dirGlobe')}</span><Icon d={ARROW} /></button>
      </nav>
    </section>
  </div>;
}
