const LEGACY_COUNTRY_CODES: Record<string, string> = { UK: 'GB', FX: 'FR', SU: 'RU', YU: 'RS' };

export const canonicalHomeCountryCode = (code: string | null | undefined): string | null => {
  const normalized = code?.trim().toUpperCase();
  return normalized ? LEGACY_COUNTRY_CODES[normalized] ?? normalized : null;
};
