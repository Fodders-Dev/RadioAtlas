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

const mockStreamAudio = createSilentWav();

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
  const row = page.locator('.home-search-card .station-row').filter({ hasText: name }).first();
  await row.locator('.play-btn').click();
};
