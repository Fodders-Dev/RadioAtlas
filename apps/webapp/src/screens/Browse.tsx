import { useMemo, useState } from 'react';
import { StationTable } from '../components/StationTable';
import { useRadio } from '../state/RadioContext';
import { toLite } from '../lib/stationUtils';
import type { Station } from '../types';

const VIBES = [
  { id: 'all', label: 'All', keywords: [] },
  { id: 'chill', label: 'Chill', keywords: ['chill', 'ambient', 'lofi', 'downtempo'] },
  { id: 'electro', label: 'Electronic', keywords: ['electronic', 'house', 'techno', 'edm'] },
  { id: 'rock', label: 'Rock', keywords: ['rock', 'metal', 'indie', 'alternative'] },
  { id: 'jazz', label: 'Jazz', keywords: ['jazz', 'blues', 'swing', 'soul'] },
  { id: 'classical', label: 'Classical', keywords: ['classical', 'orchestra', 'piano'] },
  { id: 'news', label: 'News', keywords: ['news', 'talk', 'public', 'politics'] },
  { id: 'world', label: 'World', keywords: ['world', 'latin', 'reggae', 'afro'] }
];

const makeRng = (seed: number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const sampleStations = (stations: Station[], count: number, seed: number) => {
  if (stations.length <= count) return stations.slice();
  const rng = makeRng(seed);
  const copy = stations.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count);
};

const stationText = (station: Station) =>
  `${station.name} ${station.tags} ${station.language} ${station.country}`.toLowerCase();

export const Browse = () => {
  const { stations, playStation } = useRadio();
  const [vibe, setVibe] = useState('all');
  const [seed, setSeed] = useState(() => Date.now());

  const vibeConfig = useMemo(
    () => VIBES.find((item) => item.id === vibe) ?? VIBES[0],
    [vibe]
  );

  const filtered = useMemo(() => {
    if (!vibeConfig.keywords.length) return stations;
    return stations.filter((station) =>
      vibeConfig.keywords.some((keyword) => stationText(station).includes(keyword))
    );
  }, [stations, vibeConfig]);

  const picks = useMemo(() => sampleStations(filtered, 24, seed), [filtered, seed]);

  const handleSurprise = () => {
    if (!filtered.length) return;
    const next = sampleStations(filtered, 1, Date.now())[0];
    if (next) playStation(next);
  };

  return (
    <section className="screen">
      <div className="section">
        <div className="section-title">Random</div>
        <div className="section-subtitle">
          Discover something new. Shuffle the airwaves and jump in.
        </div>
        <div className="chip-row">
          <button className="chip active" onClick={handleSurprise} type="button">
            Surprise me
          </button>
          <button className="chip" onClick={() => setSeed(Date.now())} type="button">
            New picks
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-subtitle">Vibes</div>
        <div className="chip-row">
          {VIBES.map((item) => (
            <button
              key={item.id}
              className={`chip ${item.id === vibe ? 'active' : ''}`}
              onClick={() => setVibe(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-subtitle">
          {vibeConfig.label} picks ({filtered.length})
        </div>
      </div>

      <StationTable stations={picks.map(toLite)} compact />
    </section>
  );
};
