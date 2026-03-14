import { useEffect, useMemo, useState } from 'react';
import { StationTable } from '../components/StationTable';
import { resolveContinent } from '../lib/geoResolver';
import { toLite } from '../lib/stationUtils';
import { useRadio } from '../state/RadioContext';
import type { BrowseState, ContinentId, CountryBucket } from '../types';

const CONTINENT_ORDER: ContinentId[] = [
  'Europe',
  'Asia',
  'North America',
  'South America',
  'Africa',
  'Oceania',
  'Antarctica',
  'Other'
];

const CONTINENT_HINTS: Record<ContinentId, string> = {
  Europe: 'Public broadcasters, dance, indie and talk.',
  Asia: 'Regional pop, talk and large city FM networks.',
  'North America': 'News, classic hits, college and local stations.',
  'South America': 'Latin formats, regional and cultural streams.',
  Africa: 'Urban, news and community-driven stations.',
  Oceania: 'Island and metro radio scenes.',
  Antarctica: 'Very few remote streams.',
  Other: 'Stations without enough location metadata.'
};

const normalizeCountryKey = (value: string) =>
  value.toLowerCase().replace(/\s+/g, ' ').trim();

const sortStations = (left: { name: string }, right: { name: string }) =>
  left.name.localeCompare(right.name);

export const Browse = () => {
  const { stations, playStation } = useRadio();
  const [step, setStep] = useState<BrowseState>('continents');
  const [selectedContinent, setSelectedContinent] = useState<ContinentId | null>(null);
  const [selectedCountryKey, setSelectedCountryKey] = useState<string | null>(null);
  const [countryQuery, setCountryQuery] = useState('');

  const countryBuckets = useMemo(() => {
    const map = new Map<string, CountryBucket>();
    stations.forEach((station) => {
      const country = station.country?.trim() || 'Unknown';
      const key = normalizeCountryKey(country);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.stations.push(toLite(station));
        return;
      }
      map.set(key, {
        key,
        country,
        continent: resolveContinent(station.country),
        count: 1,
        stations: [toLite(station)]
      });
    });

    return Array.from(map.values())
      .map((bucket) => ({
        ...bucket,
        stations: bucket.stations.sort(sortStations)
      }))
      .sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count;
        return a.country.localeCompare(b.country);
      });
  }, [stations]);

  const continentBuckets = useMemo(
    () =>
      CONTINENT_ORDER.map((continent) => {
        const countries = countryBuckets.filter((bucket) => bucket.continent === continent);
        const stationCount = countries.reduce((sum, item) => sum + item.count, 0);
        return {
          id: continent,
          countries,
          countryCount: countries.length,
          stationCount
        };
      }).filter((item) => item.countryCount > 0),
    [countryBuckets]
  );

  const filteredCountries = useMemo(() => {
    if (!selectedContinent) return [];
    const source = countryBuckets.filter((bucket) => bucket.continent === selectedContinent);
    const q = countryQuery.trim().toLowerCase();
    if (!q) return source;
    return source.filter((bucket) => bucket.country.toLowerCase().includes(q));
  }, [countryBuckets, selectedContinent, countryQuery]);

  const selectedCountry = useMemo(
    () => countryBuckets.find((bucket) => bucket.key === selectedCountryKey) ?? null,
    [countryBuckets, selectedCountryKey]
  );

  useEffect(() => {
    if (!selectedContinent && step !== 'continents') {
      setStep('continents');
    }
  }, [selectedContinent, step]);

  useEffect(() => {
    if (step === 'stations' && !selectedCountry) {
      setStep(selectedContinent ? 'countries' : 'continents');
    }
  }, [selectedCountry, selectedContinent, step]);

  const openContinent = (continent: ContinentId) => {
    setSelectedContinent(continent);
    setSelectedCountryKey(null);
    setCountryQuery('');
    setStep('countries');
  };

  const openCountry = (countryKey: string) => {
    setSelectedCountryKey(countryKey);
    setStep('stations');
  };

  const backToContinents = () => {
    setStep('continents');
    setSelectedContinent(null);
    setSelectedCountryKey(null);
    setCountryQuery('');
  };

  const backToCountries = () => {
    setStep('countries');
    setSelectedCountryKey(null);
  };

  if (!stations.length) {
    return (
      <section className="screen screen-browse">
        <div className="section">
          <div className="section-title">Browse</div>
          <div className="empty-state">Loading stations...</div>
        </div>
      </section>
    );
  }

  return (
    <section className="screen screen-browse">
      <div className="section browse-heading">
        <div className="section-title">Browse</div>
        <div className="section-subtitle">
          {step === 'continents' && 'Choose a continent to explore local stations.'}
          {step === 'countries' &&
            `Pick a country in ${selectedContinent}. ${filteredCountries.length} found.`}
          {step === 'stations' &&
            `${selectedCountry?.country || 'Country'} - ${selectedCountry?.count || 0} stations.`}
        </div>
      </div>

      {step === 'continents' && (
        <div className="browse-grid">
          {continentBuckets.map((continent) => (
            <button
              key={continent.id}
              className="browse-card"
              type="button"
              onClick={() => openContinent(continent.id)}
            >
              <div className="browse-title">{continent.id}</div>
              <div className="browse-meta">
                {continent.countryCount} countries - {continent.stationCount} stations
              </div>
              <div className="browse-hint">{CONTINENT_HINTS[continent.id]}</div>
            </button>
          ))}
        </div>
      )}

      {step === 'countries' && (
        <>
          <div className="section">
            <div className="chip-row">
              <button className="chip" type="button" onClick={backToContinents}>
                Back to continents
              </button>
            </div>
            <div className="search-bar">
              <input
                placeholder="Search country"
                value={countryQuery}
                onChange={(event) => setCountryQuery(event.target.value)}
              />
              {countryQuery && (
                <button className="clear-btn" type="button" onClick={() => setCountryQuery('')}>
                  Clear
                </button>
              )}
            </div>
          </div>

          {filteredCountries.length ? (
            <div className="browse-list">
              {filteredCountries.map((bucket) => (
                <button
                  key={bucket.key}
                  className="browse-list-item"
                  type="button"
                  onClick={() => openCountry(bucket.key)}
                >
                  <div className="browse-title">{bucket.country}</div>
                  <div className="browse-meta">{bucket.count} stations</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">No countries found for this query.</div>
          )}
        </>
      )}

      {step === 'stations' && selectedCountry && (
        <>
          <div className="section">
            <div className="chip-row">
              <button className="chip" type="button" onClick={backToCountries}>
                Back to countries
              </button>
              <button
                className="chip active"
                type="button"
                onClick={() => {
                  const random =
                    selectedCountry.stations[
                      Math.floor(Math.random() * selectedCountry.stations.length)
                    ];
                  if (random) {
                    playStation(random, {
                      playlist: selectedCountry.stations,
                      sourceId: `browse-${selectedCountry.key}`
                    });
                  }
                }}
              >
                Play random in {selectedCountry.country}
              </button>
            </div>
          </div>
          {selectedCountry.stations.length ? (
            <StationTable
              stations={selectedCountry.stations}
              sourceId={`browse-${selectedCountry.key}`}
            />
          ) : (
            <div className="empty-state">No stations in this country yet.</div>
          )}
        </>
      )}
    </section>
  );
};


