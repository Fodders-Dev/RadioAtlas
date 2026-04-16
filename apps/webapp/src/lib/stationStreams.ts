import type { StationLite } from '../types';

const normalizeUrl = (value?: string | null) => value?.trim() || '';

const tryParseUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

export const canonicalizeStationStreamUrl = (value?: string | null) => {
  const normalized = normalizeUrl(value);
  if (!normalized) return '';

  const parsed = tryParseUrl(normalized);
  if (!parsed) return normalized;

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();

  if (host === '31.13.223.148' && path === '/city.mp3') {
    return 'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIO_CITYAAC_L.aac?dist=WEBSITEBG';
  }

  if (host === 'internetradio.salue.de' && (path === '/salue.mp3' || path === '/salue.aac')) {
    return 'https://internetradio.salue.de:8443/salue5';
  }

  return normalized;
};

const matchesHomepageHost = (homepage: string | undefined, host: string) => {
  const parsed = tryParseUrl(normalizeUrl(homepage));
  return parsed?.hostname.toLowerCase().includes(host) || false;
};

const matchesAnyHost = (value: string, hosts: string[]) => {
  const parsed = tryParseUrl(normalizeUrl(value));
  if (!parsed) return false;
  const hostname = parsed.hostname.toLowerCase();
  return hosts.some((host) => hostname.includes(host));
};

const pushUniqueUrl = (items: string[], value?: string | null) => {
  const normalized = normalizeUrl(value);
  if (!normalized) return;
  if (items.includes(normalized)) return;
  items.push(normalized);
};

export const buildStationStreamTargets = (
  station: Pick<StationLite, 'name' | 'url_resolved'> &
    Partial<Pick<StationLite, 'url' | 'homepage'>>
) => {
  const targets: string[] = [];
  const resolved = normalizeUrl(station.url_resolved);
  const original = normalizeUrl(station.url);
  const name = station.name.toLowerCase().replace(/\s+/g, ' ').trim();
  const homepage = normalizeUrl(station.homepage);
  const isSalueMainName = /^radio sal[üu]\s*$/.test(name);
  const isSalueMainStream =
    resolved.includes('/salue.mp3') ||
    resolved.includes('/salue.aac') ||
    /(?:^|[^a-z0-9])salue5(?:\?|$)/.test(resolved) ||
    original.includes('/salue.mp3') ||
    original.includes('/salue.aac') ||
    /(?:^|[^a-z0-9])salue5(?:\?|$)/.test(original);
  const isCityMainName =
    /^radio city$/.test(name) ||
    /^city bulgaria$/.test(name) ||
    /^радио city$/.test(name);
  const isCityMainStream =
    resolved.includes('/city.mp3') ||
    original.includes('/city.mp3') ||
    resolved.toLowerCase().includes('radio_city') ||
    original.toLowerCase().includes('radio_city');

  if (homepage && matchesHomepageHost(homepage, 'salue.de') && (isSalueMainName || isSalueMainStream)) {
    pushUniqueUrl(targets, 'https://internetradio.salue.de:8443/salue5');
    if (
      !matchesAnyHost(resolved, ['internetradio.salue.de']) &&
      !matchesAnyHost(original, ['internetradio.salue.de'])
    ) {
      return targets;
    }
  }
  if (homepage && matchesHomepageHost(homepage, 'city.bg') && (isCityMainName || isCityMainStream)) {
    pushUniqueUrl(
      targets,
      'https://playerservices.streamtheworld.com/api/livestream-redirect/RADIO_CITYAAC_L.aac?dist=WEBSITEBG'
    );
    if (
      !matchesAnyHost(resolved, ['31.13.223.148', 'playerservices.streamtheworld.com', 'play.global.audio']) &&
      !matchesAnyHost(original, ['31.13.223.148', 'playerservices.streamtheworld.com', 'play.global.audio'])
    ) {
      return targets;
    }
  }

  pushUniqueUrl(targets, canonicalizeStationStreamUrl(resolved));
  pushUniqueUrl(targets, resolved);

  if (original && original !== resolved) {
    pushUniqueUrl(targets, canonicalizeStationStreamUrl(original));
    pushUniqueUrl(targets, original);
  }

  return targets;
};
