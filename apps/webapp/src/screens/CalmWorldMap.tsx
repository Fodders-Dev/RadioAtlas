import { geoNaturalEarth1 } from 'd3-geo';
import type { CalmCountryDeck } from './calmHomeStations';
import type { StationLite } from '../types';
import atlas from '../assets/home-atlas.json';
import { countryCodeOf, localizedCountry } from '../lib/countryName';
import { normalizeStationName } from '../lib/stationUtils';
import { canonicalHomeCountryCode, hasActualMapCoordinate, naturalEarthHomeCountryCode } from '../lib/homeAtlas';
import { useLocale } from '../state/LocaleContext';

type Props = {
  decks: CalmCountryDeck[];
  stations: StationLite[];
  selectedKey: string;
  playingStationId: string | null;
  onSelect: (key: string) => void;
  zoomToSelected: boolean;
  onReset: () => void;
};

const projection = geoNaturalEarth1().scale(atlas.scale).translate([atlas.translate[0], atlas.translate[1]]);
// Natural Earth exposes numeric UN M49 ids, while Intl uses ISO alpha-2.
const countryCodes = new Map<string, string | null>(atlas.countries.map((country) => [country.id || country.name, naturalEarthHomeCountryCode(country.id, countryCodeOf({ country: country.name }))]));
export function CalmWorldMap({ decks, stations, selectedKey, playingStationId, onSelect, zoomToSelected, onReset }: Props) {
  const { t, locale } = useLocale();
  const deckByCode = new Map(decks.map((deck) => [canonicalHomeCountryCode(deck.countrycode) ?? '', deck]));
  const selectedDeck = decks.find((deck) => deck.key === selectedKey);
  const selectedCode = selectedDeck ? canonicalHomeCountryCode(selectedDeck.countrycode) : null;
  const selectedCountry = selectedCode ? atlas.countries.find((country) => countryCodes.get(country.id || country.name) === selectedCode) : undefined;
  const [x0, y0, x1, y1] = selectedCountry?.bounds ?? [0, 0, atlas.width, atlas.height];
  const zoom = zoomToSelected && selectedCountry ? Math.max(1, Math.min(2.3, 280 / Math.max(1, x1 - x0), 150 / Math.max(1, y1 - y0))) : 1;
  const transform = zoom === 1 ? undefined : `translate(${atlas.width / 2 - zoom * (x0 + x1) / 2} ${atlas.height / 2 - zoom * (y0 + y1) / 2}) scale(${zoom})`;
  const points = stations.filter(hasActualMapCoordinate).flatMap((station) => {
    const point = projection([station.geo_long!, station.geo_lat!]);
    return point ? [{ station, x: point[0], y: point[1] }] : [];
  });

  return <div className="calm-atlas-map-scene">
    <svg className="calm-atlas-map" viewBox={`0 0 ${atlas.width} ${atlas.height}`} role="group" aria-label={t('journal.atlasMapLabel')}>
      <g className="calm-atlas-geometry" transform={transform}>
        <path className="calm-atlas-graticule" d={atlas.graticule} aria-hidden="true" />
        <path className="calm-atlas-land" d={atlas.land} aria-hidden="true" />
        {atlas.countries.map((country, index) => {
          const code = countryCodes.get(country.id || country.name)?.toUpperCase();
          const deck = code ? deckByCode.get(code) : undefined;
          const selected = deck?.key === selectedKey;
          return <path
            key={country.id || `${country.name}-${index}`}
            className={`calm-atlas-country${deck ? ' is-available' : ''}${selected ? ' is-selected' : ''}`}
            d={country.d}
            aria-label={deck ? localizedCountry(deck, locale) : undefined}
            aria-hidden={deck ? undefined : true}
            role={deck ? 'button' : undefined}
            tabIndex={deck ? 0 : undefined}
            onClick={deck ? () => onSelect(deck.key) : undefined}
            onKeyDown={deck ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(deck.key); } } : undefined}
          >{deck && <title>{localizedCountry(deck, locale)}</title>}</path>;
        })}
        {points.map(({ station, x, y }) => <circle
          key={station.stationuuid}
          className={`calm-atlas-station${station.stationuuid === playingStationId ? ' is-playing' : ''}`}
          cx={x}
          cy={y}
          r={station.stationuuid === playingStationId ? 5 : 3.2}
        ><title>{normalizeStationName(station.name)}{station.stationuuid === playingStationId ? ` · ${t('journal.atlasOnAir')}` : ''}</title></circle>)}
      </g>
    </svg>
    {zoomToSelected && selectedCountry && <button className="calm-atlas-reset" type="button" onClick={onReset} aria-label={t('journal.atlasWorldView')}>◎</button>}
  </div>;
}
