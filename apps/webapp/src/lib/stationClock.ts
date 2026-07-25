/**
 * "It is 21:47 in Tokyo right now" is the one thing a radio app can say that a
 * playlist cannot — but only when we actually know it.
 *
 * A station record carries a COUNTRY, never a timezone. For a country with a
 * single zone that is enough; for Russia, the USA, Brazil, Australia, Canada,
 * Mexico, Indonesia, Kazakhstan and friends it is not, and any single clock we
 * printed would be wrong for most of that country's listeners. So this returns
 * null rather than guessing, and the UI simply omits the line.
 */

const zonesByCountry = new Map<string, readonly string[] | null>();

type LocaleWithZones = { getTimeZones?: () => string[] | undefined };

const lookupZones = (countryCode: string): readonly string[] | null => {
  const cached = zonesByCountry.get(countryCode);
  if (cached !== undefined) return cached;

  let zones: readonly string[] | null = null;
  try {
    // Baseline-newly-available; on an engine without it we show no clock at all
    // rather than a wrong one.
    const locale = new Intl.Locale(`und-${countryCode}`) as Intl.Locale & LocaleWithZones;
    const resolved = typeof locale.getTimeZones === 'function' ? locale.getTimeZones() : undefined;
    zones = Array.isArray(resolved) && resolved.length > 0 ? resolved : null;
  } catch {
    zones = null;
  }

  zonesByCountry.set(countryCode, zones);
  return zones;
};

/**
 * The station's IANA zone, or null when the country spans more than one (or the
 * code is unusable). Exported for tests; the UI wants `stationLocalTime`.
 */
export const stationTimeZone = (countrycode: string | null | undefined): string | null => {
  const code = String(countrycode || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  const zones = lookupZones(code);
  // Exactly one zone, or nothing. A country with two zones has no single "local
  // time" to show.
  return zones && zones.length === 1 ? (zones[0] as string) : null;
};

/**
 * StationLite carries the country NAME, not the ISO code (the code exists only on
 * the full Station record). Rather than widen the API contract for a clock, build
 * the reverse map once from the region list Intl already ships.
 *
 * Deliberately strict: an unrecognised or ambiguous name yields null and the UI
 * shows no clock. Radio Browser emits canonical English names, and a handful of
 * long-form spellings are aliased below.
 */
let nameToCode: Map<string, string> | null = null;

const NAME_ALIASES: Record<string, string> = {
  'the netherlands': 'NL',
  holland: 'NL',
  'russian federation': 'RU',
  'republic of korea': 'KR',
  'south korea': 'KR',
  'united states of america': 'US',
  'the united states': 'US',
  'czech republic': 'CZ',
  'czechia': 'CZ',
  uk: 'GB',
  'great britain': 'GB',
  'united kingdom of great britain and northern ireland': 'GB'
};

const buildNameMap = (): Map<string, string> => {
  const map = new Map<string, string>();
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    // A-Z x A-Z covers every ISO-3166-1 alpha-2 slot; unassigned ones echo back
    // the code itself, which we skip.
    for (let first = 65; first <= 90; first += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(first, second);
        const name = display.of(code);
        if (!name || name === code) continue;
        const key = name.toLowerCase();
        // A name that resolves to two codes is not usable as evidence.
        map.set(key, map.has(key) ? '' : code);
      }
    }
  } catch {
    return map;
  }
  for (const [alias, code] of Object.entries(NAME_ALIASES)) {
    if (!map.has(alias)) map.set(alias, code);
  }
  return map;
};

export const countryCodeFromName = (country: string | null | undefined): string | null => {
  const name = String(country || '').trim().toLowerCase();
  if (!name) return null;
  if (!nameToCode) nameToCode = buildNameMap();
  const code = nameToCode.get(name);
  return code || null;
};

/**
 * Wall-clock time at the station, e.g. "21:47". Accepts either an ISO code or a
 * country name. Null whenever we cannot be sure.
 */
export const stationLocalTime = (
  countrycode: string | null | undefined,
  now: Date = new Date(),
  locale = 'ru-RU'
): string | null => {
  const raw = String(countrycode || '').trim();
  const timeZone = stationTimeZone(
    /^[A-Za-z]{2}$/.test(raw) ? raw : countryCodeFromName(raw)
  );
  if (!timeZone) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone
    }).format(now);
  } catch {
    return null;
  }
};

/** Test seam: the zone lookup is cached per country for the page's lifetime. */
export const __resetStationClockCache = () => {
  zonesByCountry.clear();
  nameToCode = null;
};
