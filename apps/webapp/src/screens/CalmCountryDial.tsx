import type { StationLite } from '../types';
import { useLocale } from '../state/LocaleContext';
import { localizedCountry } from '../lib/countryName';
import { normalizeStationName } from '../lib/stationUtils';
import { CalmCountryDeck, nextCalmCountryDeck } from './calmHomeStations';
import './calm-country-dial.css';

type Props = {
  decks: CalmCountryDeck[];
  activeStation: StationLite;
  onPlayCountry: (deck: CalmCountryDeck) => void;
  onMap: (country: string) => void;
  onAllCountries: () => void;
};

const GlobeMark = () => <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3.5 12h17M12 3c2.4 2.4 3.4 5.4 3.4 9S14.4 18.6 12 21M12 3c-2.4 2.4-3.4 5.4-3.4 9s1 6.6 3.4 9" /></svg>;

export function CalmCountryDial({ decks, activeStation, onPlayCountry, onMap, onAllCountries }: Props) {
  const { t, locale } = useLocale();
  const next = nextCalmCountryDeck(decks, activeStation);
  const visibleDecks = decks.slice(0, 6);
  if (!decks.length) return null;

  return <section className="calm-country-dial calm-section" data-calm-world data-calm-country-deck>
    <div className="calm-country-dial-head">
      <div><h2>{t('journal.countryDialTitle')}</h2></div>
      {next && <button className="calm-country-next" data-calm-country-next onClick={() => onPlayCountry(next)}>{t('journal.countryNextAction')}</button>}
    </div>
    <div className="calm-country-rail" role="list" aria-label={t('journal.countryDialTitle')}>
      {visibleDecks.map((deck) => {
        const preview = deck.stations[0];
        const name = localizedCountry({ country: deck.country, countrycode: deck.countrycode }, locale);
        return <article key={deck.key} className="calm-country-card" data-calm-country-card={deck.key} data-calm-country={deck.country} data-calm-country-stations={deck.stations.map((item) => item.stationuuid).join(',')} role="listitem">
          <span className="calm-country-code" aria-hidden="true">{deck.countrycode || '↗'}</span>
          <div className="calm-country-card-copy"><strong>{name}</strong><small title={normalizeStationName(preview.name)}>{normalizeStationName(preview.name)}</small></div>
          <div className="calm-country-card-actions">
            <button className="calm-country-play" data-calm-country-play aria-label={t('journal.countryPlay', { country: name })} onClick={() => onPlayCountry(deck)}><span aria-hidden="true">▶</span></button>
            <button className="calm-country-map" data-calm-country-map={deck.country} aria-label={t('journal.countryMap', { country: name })} onClick={() => onMap(deck.country)}><GlobeMark /></button>
          </div>
        </article>;
      })}
    </div>
    <button className="calm-country-all" onClick={onAllCountries}>{t('calm.allCountries')} <span aria-hidden="true">↗</span></button>
  </section>;
}
