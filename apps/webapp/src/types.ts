export type Station = {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  homepage: string;
  favicon: string;
  tags: string;
  country: string;
  countrycode: string;
  state: string;
  language: string;
  codec: string;
  bitrate: number;
  geo_lat: number | null;
  geo_long: number | null;
};

export type ContinentId =
  | 'Africa'
  | 'Asia'
  | 'Europe'
  | 'North America'
  | 'South America'
  | 'Oceania'
  | 'Antarctica'
  | 'Other';

export type BrowseState = 'continents' | 'countries' | 'stations';

export type CountryBucket = {
  key: string;
  country: string;
  continent: ContinentId;
  count: number;
  stations: StationLite[];
};

export type StationLite = Pick<
  Station,
  | 'stationuuid'
  | 'name'
  | 'url_resolved'
  | 'favicon'
  | 'country'
  | 'state'
  | 'tags'
  | 'geo_lat'
  | 'geo_long'
>;

export type SkinPalette = {
  bg: string;
  panel: string;
  accent: string;
  muted: string;
  border: string;
  text: string;
};

export type WinampSkinSource = 'preset' | 'museum';

export type WinampSkinPreset = {
  id: string;
  name: string;
  url: string;
  palette?: SkinPalette;
};

export type WinampMuseumSkin = WinampSkinPreset & {
  md5: string;
  museumUrl: string;
  screenshotUrl: string | null;
  nsfw: boolean;
};

export type ActiveWinampSkin =
  | (WinampSkinPreset & { source: 'preset' })
  | (WinampMuseumSkin & { source: 'museum' });
