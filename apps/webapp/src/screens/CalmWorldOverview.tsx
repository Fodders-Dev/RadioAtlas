import { lazy, Suspense, useState } from 'react';
import type { StationLite } from '../types';
import { useLocale } from '../state/LocaleContext';
import { localizedCountry } from '../lib/countryName';
import { normalizeStationName } from '../lib/stationUtils';
import { stationGenreFamily } from '../lib/stationGenre';
import { CalmCountryDeck, nextCalmCountryDeck } from './calmHomeStations';
import './calm-world-overview.css';

const CalmWorldMap = lazy(() => import('./CalmWorldMap').then((module) => ({ default: module.CalmWorldMap })));

type Props = {
  decks: CalmCountryDeck[];
  activeStation: StationLite;
  playingStationId: string | null;
  onPlay: (deck: CalmCountryDeck, station?: StationLite) => void;
  onMap: (country: string) => void;
  onAllCountries: () => void;
};

export function CalmWorldOverview({ decks, activeStation, playingStationId, onPlay, onMap, onAllCountries }: Props) {
  const { t, locale } = useLocale();
  const [selectedKey, setSelectedKey] = useState(decks[0]?.key ?? '');
  const [zoomedKey, setZoomedKey] = useState(decks[0]?.key ?? '');
  const [showAll, setShowAll] = useState(false);
  const selectCountry = (key: string) => { setSelectedKey(key); setZoomedKey(key); setShowAll(false); };
  const selected = decks.find((deck) => deck.key === selectedKey) ?? decks[0];
  const next = nextCalmCountryDeck(decks, activeStation);
  const preview = showAll ? selected?.stations ?? [] : selected?.stations.slice(0, 2) ?? [];
  const selectedName = selected ? localizedCountry({ country: selected.country, countrycode: selected.countrycode }, locale) : '';

  if (!decks.length) return null;
  return <section className="calm-atlas" data-calm-country-deck data-calm-world-overview aria-label={t('journal.atlasTitle')}>
    <div className="calm-atlas-head">
      <h2>{t('journal.atlasTitle')}</h2>
      <div className="calm-atlas-head-actions">
        <button className="calm-atlas-all" data-calm-country-all onClick={onAllCountries}>{t('journal.atlasAllCountries')}</button>
      </div>
    </div>

    <div className="calm-atlas-content">
      <div className="calm-atlas-map-column">
        <div className="calm-atlas-map-frame" data-calm-atlas-map>
          <Suspense fallback={<div className="calm-atlas-map-loading" aria-label={t('journal.atlasMapLoading')} />}>
            <CalmWorldMap
              decks={decks}
              stations={decks.flatMap((deck) => deck.stations)}
              selectedKey={selected.key}
              playingStationId={playingStationId}
              onSelect={selectCountry}
              zoomToSelected={zoomedKey === selected.key}
              onReset={() => setZoomedKey('')}
            />
          </Suspense>
        </div>
        <div className="calm-atlas-rail" role="group" aria-label={t('journal.atlasAvailable')}>
          {decks.map((deck) => <button
            key={deck.key}
            type="button"
            className="calm-atlas-country"
            data-calm-country-rail={deck.country}
            aria-pressed={deck.key === selected.key}
            onClick={() => selectCountry(deck.key)}
          >{localizedCountry({ country: deck.country, countrycode: deck.countrycode }, locale)}</button>)}
        </div>
      </div>

      <div className="calm-atlas-picks" data-calm-atlas-country={selected.country}>
        <div className="calm-atlas-selection">
          <div><h3>{selectedName}</h3><small>{t('journal.atlasCount', { count: String(selected.stations.length) })}</small></div>
          <button className="calm-atlas-globe" aria-label={t('journal.countryMap', { country: selectedName })} data-calm-country-map={selected.country} onClick={() => onMap(selected.country)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.5 12h17M12 3c2.4 2.4 3.4 5.4 3.4 9S14.4 18.6 12 21M12 3c-2.4 2.4-3.4 5.4-3.4 9s1 6.6 3.4 9"/></svg>
          </button>
        </div>
        <div className="calm-atlas-stations" role="list" aria-label={selectedName}>
          {preview.map((station, index) => {
            const family = stationGenreFamily(station);
            const detail = [station.state.trim(), family ? t(`mapExplorer.families.${family}`) : ''].filter(Boolean).join(' · ');
            const name = normalizeStationName(station.name);
            return <article className="calm-atlas-station-row" key={station.stationuuid} data-calm-country-card={selected.key} data-calm-country={selected.country} data-calm-country-stations={selected.stations.map((item) => item.stationuuid).join(',')} role="listitem">
              <div className="calm-atlas-station-copy"><strong>{name}</strong>{detail && <small>{detail}</small>}</div>
              <button className="calm-atlas-listen" data-calm-country-play aria-label={t('journal.atlasListen', { name })} onClick={() => onPlay(selected, station)}>{t('journal.atlasListenShort')}</button>
            </article>;
          })}
        </div>
        {(selected.stations.length > 2 || next) && <div className="calm-atlas-footer">
          {selected.stations.length > 2
            ? <button className="calm-atlas-more" data-calm-atlas-more onClick={() => setShowAll((value) => !value)}>{t(showAll ? 'journal.atlasLess' : 'journal.atlasMore', { count: String(selected.stations.length) })}</button>
            : <span />}
          {next && <button className="calm-atlas-next" data-calm-country-next aria-label={t('journal.countryNextAction')} onClick={() => onPlay(next)}><span aria-hidden="true">▶</span>{t('journal.atlasNextLabel')}</button>}
        </div>}
      </div>
    </div>
  </section>;
}
