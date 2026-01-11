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
