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
  // Radio Browser uptime signal: 1 if the station passed its last
  // upstream stream check, 0 if it failed. Carried through unchanged
  // from Radio Browser so we can demote stations everyone else also
  // sees as broken without waiting for our user to click them.
  lastcheckok?: 0 | 1;
  // Unix milliseconds. ISO string from Radio Browser is converted
  // at the API edge (normalizeStation) so the webapp can do simple
  // arithmetic without parsing dates again.
  lastcheckok_at?: number | null;
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
  Partial<
    Pick<Station, 'url' | 'language' | 'codec' | 'bitrate' | 'lastcheckok' | 'lastcheckok_at'>
  >;
