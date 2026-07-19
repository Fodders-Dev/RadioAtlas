// Roughly approximate local time at a longitude. lon / 15° ≈ UTC
// offset hours. Inaccurate for political timezones in countries
// that span many longitudes (Russia, US, China) but good enough
// for "what time of day is it there?" — the user can look at the
// map and read "≈ 03:42" rather than guessing whether they're
// probably waking the locals up.
//
// ⚠ ITS ONE CALLER IS THE GLOBE, and it must print it behind the "≈" marker:
// this is solar time derived from a longitude, not a tz-database lookup.
//
// DO NOT reuse it on a new surface. Measured against the true IANA zones:
// Madrid out by 2h15m and on the wrong calendar day, Vladivostok 1h12m, New
// York 56m (DST), London 1h (BST), Kashgar ~3h. That is not an approximation a
// "≈" can carry, and it is why the discovery-feed card prints coordinates and
// no clock (screens/StationFeed.tsx). A real clock needs a real zone: the
// browser already ships the IANA database via Intl.DateTimeFormat({ timeZone }),
// so the missing piece is a station→zone input, not a dependency.
export const formatLocalTime = (lon: number, now: Date): string => {
  const offsetMinutes = (lon / 15) * 60;
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  const target = new Date(utcMs + offsetMinutes * 60_000);
  const hh = String(target.getHours()).padStart(2, '0');
  const mm = String(target.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

// Print a coordinate the way the datum reads, with a hemisphere letter instead
// of a sign — "34.6937° N".
//
// Capped at 4 decimals (~11m), which is far finer than a radio station's
// position is ever meaningfully known, and trailing zeros are STRIPPED. toFixed
// alone would pad as well as round: sampling the shipped catalog artifact, most
// stations store 14-16 decimals (harmlessly truncated here) but a handful store
// only 2 — and `30.76` rendered through toFixed(4) becomes "30.7600° N", which
// invents two digits of precision on the one screen whose whole premise is not
// inventing data. Never widen this past the stored precision.
export const formatCoordinate = (value: number, positive: string, negative: string): string => {
  const magnitude = String(Number(Math.abs(value).toFixed(4)));
  return `${magnitude}° ${value >= 0 ? positive : negative}`;
};

export const formatCoordinatePair = (lat: number, lon: number): string =>
  `${formatCoordinate(lat, 'N', 'S')}, ${formatCoordinate(lon, 'E', 'W')}`;
