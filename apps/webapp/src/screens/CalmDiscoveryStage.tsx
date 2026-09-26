import type { StationLite } from '../types';
import { useLocale } from '../state/LocaleContext';
import { normalizeStationName } from '../lib/stationUtils';
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
  queueSource: string;
  hasNext: boolean;
  canDiscover: boolean;
  onPlay: () => void;
  onNext: () => void;
  onDiscover: () => void;
  onSource: () => void;
  onFeed: () => void;
  onGlobe: () => void;
  waveOnStation?: boolean;
};

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
const ARROW = 'M5 12h14M14 7l5 5-5 5';
const FEED = 'M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm3 6v6l5-3-5-3ZM12 1v2M12 21v2';
const GLOBE = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c-2.5 2.5-3.5 5.5-3.5 9s1 6.5 3.5 9c2.5-2.5 3.5-5.5 3.5-9s-1-6.5-3.5-9ZM3 12h18';

export function CalmDiscoveryStage({ station, status, statusLabel, country, details, track, hasListener, isPlaying, canRetry, nextStations, queueSource, hasNext, canDiscover, onPlay, onNext, onDiscover, onSource, onFeed, onGlobe, waveOnStation }: Props) {
  const { t } = useLocale();
  const name = normalizeStationName(station.name);
  const playLabel = canRetry ? t('journal.stageRetry') : isPlaying ? t('common.pause') : hasListener ? t('common.play') : t('journal.play');
  const nextLabel = hasNext ? t('journal.stageNext') : t('journal.stageDiscover');
  const statusText = status === 'idle' ? t('journal.stageReady') : statusLabel;

  return <div className="calm-discovery-wrap">
    <section className="calm-discovery-stage" data-calm-offer={station.stationuuid} data-calm-air={status === 'playing' ? 'on' : status} data-calm-discovery-stage data-stage-status={status} aria-label={t('journal.stageLabel')}>
      <div className="calm-stage-main">
        <div className="calm-stage-artwork" key={station.stationuuid} aria-hidden="true" data-stage-art={station.stationuuid} data-wave-arrival={waveOnStation || undefined}>
          <div className="calm-stage-cover" aria-hidden="true">
            <svg className="calm-stage-dial" viewBox="0 0 240 240" role="presentation">
              <circle className="calm-stage-dial-disc" cx="120" cy="120" r="104" />
              <circle className="calm-stage-dial-ring" cx="120" cy="120" r="91" />
              <circle className="calm-stage-dial-ring" cx="120" cy="120" r="82" />
              <circle className="calm-stage-dial-ring" cx="120" cy="120" r="71" />
              <circle className="calm-stage-dial-ring" cx="120" cy="120" r="61" />
              <circle className="calm-stage-dial-label" cx="120" cy="120" r="40" />
              <circle className="calm-stage-dial-label-ring" cx="120" cy="120" r="33" />
              <circle className="calm-stage-dial-center" cx="120" cy="120" r="3.5" />
              <path className="calm-stage-dial-arm" d="M195 43l-12 8-29 40m-4 5 4-5 6 5" />
              <circle className="calm-stage-dial-pivot" cx="195" cy="43" r="5" />
            </svg>
          </div>
        </div>
        <div className="calm-stage-identity">
          <span className="calm-stage-eyebrow">{t('journal.waveEyebrow')}</span>
          <span key={station.stationuuid} className="calm-stage-country">{country || t('journal.stageWorldRadio')}</span>
          <button className="calm-stage-station-row" onClick={onSource} aria-label={t('journal.sourceOpen', { name })}>
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
      </div>
      <aside className="calm-stage-upnext" aria-label={t('journal.stageUpNext')}>
        <strong>{t('journal.stageUpNext')}</strong>
        {nextStations.length ? <span>{nextStations.slice(0, 3).map((next) => normalizeStationName(next.name)).join(' · ')}</span> : <span>{t('journal.stageNoNext')}</span>}
        {queueSource && <small>{queueSource}</small>}
      </aside>
      <nav className="calm-stage-doors" data-calm-doors aria-label={t('journal.doorsLabel')}>
        <button className="calm-stage-door" data-calm-entry="feed" onClick={onFeed}><Icon d={FEED} /><span>{t('journal.dirFeed')}</span><Icon d={ARROW} /></button>
        <button className="calm-stage-door" data-calm-entry="globe" onClick={onGlobe}><Icon d={GLOBE} /><span>{t('journal.dirGlobe')}</span><Icon d={ARROW} /></button>
      </nav>
    </section>
  </div>;
}
