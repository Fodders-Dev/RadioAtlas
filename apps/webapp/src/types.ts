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
  stationArtwork?: string | null;
  isClaimed?: boolean;
  isVerified?: boolean;
  promoted?: boolean;
  description?: string | null;
  websiteUrl?: string | null;
  scheduleNote?: string | null;
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

export type AppSection = 'home' | 'search' | 'globe' | 'library';

export type PlayerPresentation = 'peek' | 'bar' | 'expanded';

export type LibraryTab = 'favorites' | 'tracks' | 'queue' | 'recent' | 'history' | 'collections' | 'settings';

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
  | 'homepage'
  | 'favicon'
  | 'country'
  | 'state'
  | 'tags'
  | 'geo_lat'
  | 'geo_long'
  | 'stationArtwork'
  | 'isClaimed'
  | 'isVerified'
  | 'promoted'
  | 'description'
  | 'websiteUrl'
  | 'scheduleNote'
> &
  Partial<Pick<Station, 'url'>>;

export type SkinPalette = {
  bg: string;
  panel: string;
  accent: string;
  muted: string;
  border: string;
  text: string;
};

export type WinampSkinSource = 'preset' | 'museum' | 'uploaded';

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

export type WinampUploadedSkin = WinampSkinPreset & {
  source: 'uploaded';
  objectUrl: string;
};

export type ActiveWinampSkin =
  | (WinampSkinPreset & { source: 'preset' })
  | (WinampMuseumSkin & { source: 'museum' })
  | WinampUploadedSkin;
