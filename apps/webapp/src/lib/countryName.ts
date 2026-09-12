// A country for a card, in the listener's language. Radio Browser ships the
// long official English form («The United Kingdom Of Great Britain And
// Northern Ireland», «The Philippines»), which wraps or clips on a phone; Intl
// knows the short localized one for the same code. The raw name stays the
// fallback — a station with no code and no recognisable name, or a runtime
// without the region data, still shows what it has.
const names = new Map<string, Intl.DisplayNames | null>();

const display = (locale: string): Intl.DisplayNames | null => {
  if (!names.has(locale)) {
    try {
      names.set(locale, typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames([locale], { type: 'region' }) : null);
    } catch {
      names.set(locale, null);
    }
  }
  return names.get(locale) ?? null;
};

const fold = (value: string): string =>
  value
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-zÀ-ɏ]+/g, ' ')
    .trim();

// ISO 3166 official long forms Radio Browser uses that Intl's English short
// names do not spell the same way. Names only — no country is guessed.
const OFFICIAL_FORMS: Record<string, string> = {
  'united kingdom of great britain and northern ireland': 'GB',
  'united states of america': 'US',
  'russian federation': 'RU',
  'republic of korea': 'KR',
  'iran islamic republic of': 'IR',
  'viet nam': 'VN',
  'republic of moldova': 'MD',
  'bolivia plurinational state of': 'BO',
  'venezuela bolivarian republic of': 'VE',
  'tanzania united republic of': 'TZ',
  'syrian arab republic': 'SY',
  'lao people s democratic republic': 'LA',
  'türkiye': 'TR',
  turkiye: 'TR'
};

// Every code Intl's English names know, keyed by the folded name — built once,
// on first use, from the 26×26 space of two-letter codes.
let byEnglishName: Map<string, string> | null = null;
const codeForName = (country: string): string | null => {
  const key = fold(country);
  if (!key) return null;
  if (OFFICIAL_FORMS[key]) return OFFICIAL_FORMS[key];
  if (!byEnglishName) {
    byEnglishName = new Map();
    const english = display('en');
    if (english) {
      for (let a = 65; a <= 90; a += 1) {
        for (let b = 65; b <= 90; b += 1) {
          const code = String.fromCharCode(a, b);
          try {
            const name = english.of(code);
            if (name && name !== code) byEnglishName.set(fold(name), code);
          } catch {
            /* an unassigned code throws in some engines */
          }
        }
      }
    }
  }
  return byEnglishName.get(key) ?? null;
};

export const countryCodeOf = (station: { country: string; countrycode?: string | null }): string | null => {
  const code = (station.countrycode || '').trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) return code;
  return codeForName(station.country || '');
};

export const localizedCountry = (station: { country: string; countrycode?: string | null }, locale: string): string => {
  const code = countryCodeOf(station);
  if (!code) return station.country;
  try {
    const name = display(locale)?.of(code);
    // Intl returns the code itself when it has no name for it.
    return name && name !== code ? name : station.country;
  } catch {
    return station.country;
  }
};
