import type { Page } from '@playwright/test';

export const stations = [
  {
    stationuuid: 'uuid-tokyo',
    name: 'Tokyo FM',
    url: 'https://stream.example.com/tokyo',
    url_resolved: 'https://stream.example.com/tokyo',
    homepage: 'https://tokyofm.example.com',
    favicon: '',
    tags: 'pop,jpop',
    country: 'Japan',
    countrycode: 'JP',
    state: 'Tokyo',
    language: 'Japanese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: 35.6895,
    geo_long: 139.6917
  },
  {
    stationuuid: 'uuid-osaka',
    name: 'Osaka Nights',
    url: 'https://stream.example.com/osaka',
    url_resolved: 'https://stream.example.com/osaka',
    homepage: 'https://osakanights.example.com',
    favicon: '',
    tags: 'jpop,night',
    country: 'Japan',
    countrycode: 'JP',
    state: 'Osaka',
    language: 'Japanese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: 34.6937,
    geo_long: 135.5023
  },
  {
    stationuuid: 'uuid-kyoto',
    name: 'Kyoto Groove',
    url: 'https://stream.example.com/kyoto',
    url_resolved: 'https://stream.example.com/kyoto',
    homepage: 'https://kyotogroove.example.com',
    favicon: '',
    tags: 'jpop,groove',
    country: 'Japan',
    countrycode: 'JP',
    state: 'Kyoto',
    language: 'Japanese',
    codec: 'AAC',
    bitrate: 96,
    geo_lat: 35.0116,
    geo_long: 135.7681
  },
  {
    stationuuid: 'uuid-sapporo',
    name: 'Sapporo City Pop',
    url: 'https://stream.example.com/sapporo',
    url_resolved: 'https://stream.example.com/sapporo',
    homepage: 'https://sapporocitypop.example.com',
    favicon: '',
    tags: 'jpop,citypop',
    country: 'Japan',
    countrycode: 'JP',
    state: 'Hokkaido',
    language: 'Japanese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: 43.0618,
    geo_long: 141.3545
  },
  {
    stationuuid: 'uuid-berlin',
    name: 'Berlin Pulse',
    url: 'https://stream.example.com/berlin',
    url_resolved: 'https://stream.example.com/berlin',
    homepage: 'https://berlinpulse.example.com',
    favicon: '',
    tags: 'techno,house',
    country: 'Germany',
    countrycode: 'DE',
    state: 'Berlin',
    language: 'German',
    codec: 'AAC',
    bitrate: 96,
    geo_lat: 52.52,
    geo_long: 13.405
  },
  {
    stationuuid: 'uuid-hamburg',
    name: 'Hamburg Transit',
    url: 'https://stream.example.com/hamburg',
    url_resolved: 'https://stream.example.com/hamburg',
    homepage: 'https://hamburgtransit.example.com',
    favicon: '',
    tags: 'techno,industrial',
    country: 'Germany',
    countrycode: 'DE',
    state: 'Hamburg',
    language: 'German',
    codec: 'AAC',
    bitrate: 96,
    geo_lat: 53.5511,
    geo_long: 9.9937
  },
  {
    stationuuid: 'uuid-munich',
    name: 'Munich Drive',
    url: 'https://stream.example.com/munich',
    url_resolved: 'https://stream.example.com/munich',
    homepage: 'https://munichdrive.example.com',
    favicon: '',
    tags: 'techno,drive',
    country: 'Germany',
    countrycode: 'DE',
    state: 'Bavaria',
    language: 'German',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: 48.1351,
    geo_long: 11.582
  },
  {
    stationuuid: 'uuid-cologne',
    name: 'Cologne Wave',
    url: 'https://stream.example.com/cologne',
    url_resolved: 'https://stream.example.com/cologne',
    homepage: 'https://colognewave.example.com',
    favicon: '',
    tags: 'techno,wave',
    country: 'Germany',
    countrycode: 'DE',
    state: 'North Rhine-Westphalia',
    language: 'German',
    codec: 'AAC',
    bitrate: 96,
    geo_lat: 50.9375,
    geo_long: 6.9603
  },
  {
    stationuuid: 'uuid-rio',
    name: 'Rio Beats',
    url: 'https://stream.example.com/rio',
    url_resolved: 'https://stream.example.com/rio',
    homepage: 'https://riobeats.example.com',
    favicon: '',
    tags: 'samba,bossa',
    country: 'Brazil',
    countrycode: 'BR',
    state: 'Rio de Janeiro',
    language: 'Portuguese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: -22.9068,
    geo_long: -43.1729
  },
  {
    stationuuid: 'uuid-saopaulo',
    name: 'Sao Paulo Samba',
    url: 'https://stream.example.com/saopaulo',
    url_resolved: 'https://stream.example.com/saopaulo',
    homepage: 'https://saopaulosamba.example.com',
    favicon: '',
    tags: 'samba,latin',
    country: 'Brazil',
    countrycode: 'BR',
    state: 'Sao Paulo',
    language: 'Portuguese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: -23.5558,
    geo_long: -46.6396
  },
  {
    stationuuid: 'uuid-bahia',
    name: 'Bahia Groove',
    url: 'https://stream.example.com/bahia',
    url_resolved: 'https://stream.example.com/bahia',
    homepage: 'https://bahiagroove.example.com',
    favicon: '',
    tags: 'samba,groove',
    country: 'Brazil',
    countrycode: 'BR',
    state: 'Bahia',
    language: 'Portuguese',
    codec: 'AAC',
    bitrate: 96,
    geo_lat: -12.9714,
    geo_long: -38.5014
  },
  {
    stationuuid: 'uuid-brasilia',
    name: 'Brasilia Nights',
    url: 'https://stream.example.com/brasilia',
    url_resolved: 'https://stream.example.com/brasilia',
    homepage: 'https://brasilianights.example.com',
    favicon: '',
    tags: 'samba,night',
    country: 'Brazil',
    countrycode: 'BR',
    state: 'Federal District',
    language: 'Portuguese',
    codec: 'MP3',
    bitrate: 128,
    geo_lat: -15.7939,
    geo_long: -47.8828
  }
];

const createSilentWav = (durationMs = 200) => {
  const sampleRate = 8000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.max(1, Math.round((sampleRate * durationMs) / 1000));
  const dataSize = frameCount * channels * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
};

export const mockStreamAudio = createSilentWav();

export const installMediaMocks = async (page: Page) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      this.setAttribute('data-ra-state', 'playing');
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
      this.setAttribute('data-ra-state', 'paused');
      this.dispatchEvent(new Event('pause'));
    };
    HTMLMediaElement.prototype.load = function () {};
    // @ts-expect-error test shim
    window.ResizeObserver =
      window.ResizeObserver ||
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {},
        readText: async () => ''
      }
    });
  });
};

export const mockStations = async (page: Page) => {
  const body = JSON.stringify(stations);

  await page.route('**/catalog-fast.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body })
  );
  await page.route('**/catalog-full.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body })
  );
  await page.route('**/json/stations/search**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body })
  );
  await page.route('https://stream.example.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'audio/wav', body: mockStreamAudio })
  );
  await page.route('**/metadata?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, nowPlaying: 'Mock Song', source: 'test' })
    })
  );
  await page.route('**/status-json.xsl', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        icestats: {
          source: {
            listenurl: 'https://stream.example.com/tokyo',
            title: 'Mock Song'
          }
        }
      })
    })
  );
  await page.route('**/fetch?url=**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/plain', body: 'title=Mock Song' })
  );
  await page.route('**/extract?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        type: 'stream',
        title: 'Extracted Demo',
        audioStreams: [
          {
            url: 'https://stream.example.com/extracted',
            bitrate: 128,
            averageBitrate: 128,
            format: 'MP3',
            mimeType: 'audio/mpeg',
            delivery: 'progressive'
          }
        ]
      })
    })
  );
};

export const playHomeStation = async (page: Page, name: string) => {
  const searchInput = page.locator('.home-search-card input').first();
  await searchInput.fill(name);
  const row = page.locator('.home-search-card .station-row').filter({ hasText: name }).first();
  await row.locator('.play-btn').click();
};
