import type { StationLite } from '../types';

// Editorial entry points describe catalogue genres, never the current track.
const directions = [
  { id: 'pixels', query: 'chiptune', tags: /^(chiptune|8[- ]?bit|game music|video game music)$/i },
  { id: 'jazz', query: 'jazz', tags: /^(jazz|acid jazz|smooth jazz)$/i },
  { id: 'ambient', query: 'ambient', tags: /^(ambient|downtempo|chillout)$/i },
  { id: 'electronic', query: 'electronic', tags: /^(electronic|electronica|techno|house|dance)$/i },
  { id: 'folk', query: 'folk', tags: /^(folk|world|world music|traditional)$/i },
  { id: 'classical', query: 'classical', tags: /^(classical|baroque|opera)$/i },
  { id: 'pop', query: 'pop', tags: /^(pop|jpop|kpop|k-pop|j-pop)$/i },
  { id: 'rock', query: 'rock', tags: /^(rock|classic rock|alternative|indie|punk|pop rock)$/i },
  { id: 'hiphop', query: 'hip hop', tags: /^(hip hop|hip-hop|rap|rnb|r&b)$/i },
  { id: 'soul', query: 'soul', tags: /^(soul|funk|disco)$/i },
  { id: 'metal', query: 'metal', tags: /^(metal|heavy metal|death metal|black metal)$/i },
  { id: 'reggae', query: 'reggae', tags: /^(reggae|dub|ska|dancehall)$/i },
  { id: 'latin', query: 'latin', tags: /^(latin|salsa|samba|bossa nova|reggaeton)$/i },
  { id: 'blues', query: 'blues', tags: /^(blues|rhythm and blues)$/i },
  { id: 'synthwave', query: 'synthwave', tags: /^(synthwave|retrowave|synthpop)$/i }
];

export function calmDiscoveries(stations: StationLite[]) {
  const used = new Set<string>();
  return directions.flatMap(direction => {
    const station = stations.find(s => !used.has(s.stationuuid) && s.tags.split(',').some(tag => direction.tags.test(tag.trim())));
    if (!station) return [];
    used.add(station.stationuuid);
    return [{ id: direction.id, query: direction.query, station }];
  }).slice(0, 4);
}

export function calmGenreGroups(stations: StationLite[]) {
  return directions.map(direction => ({
    id: direction.id,
    query: direction.query,
    stations: stations.filter(s => s.tags.split(',').some(tag => direction.tags.test(tag.trim())))
  })).filter(group => group.stations.length > 0);
}
