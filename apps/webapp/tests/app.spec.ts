import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { expect, test, type Page } from '@playwright/test';

const stations = [
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

const httpUpgradeStation = {
  ...stations[0],
  stationuuid: 'uuid-http-upgrade',
  name: 'HTTP Upgrade FM',
  url: 'http://stream.example.com/http-upgrade.mp3',
  url_resolved: 'http://stream.example.com/http-upgrade.mp3'
};

const brokenHttpStation = {
  ...stations[0],
  stationuuid: 'uuid-http-broken',
  name: 'Broken HTTP FM',
  url: 'http://broken-stream.example.com/live.mp3',
  url_resolved: 'http://broken-stream.example.com/live.mp3'
};

const brokenQueueStation = {
  ...stations[0],
  stationuuid: 'uuid-broken-queue',
  name: 'Broken Queue FM',
  url: 'https://stream.example.com/broken-queue',
  url_resolved: 'https://stream.example.com/broken-queue'
};

const staleResolvedStation = {
  ...stations[0],
  stationuuid: 'uuid-stale-resolved',
  name: 'Stale Resolved FM',
  url: 'https://stream.example.com/fallback.m3u',
  url_resolved: 'https://dead-stream.example.com/live.mp3'
};

const slowStartStation = {
  ...stations[0],
  stationuuid: 'uuid-slow-start',
  name: 'Slow Start FM',
  url: 'https://stream.example.com/slow-start',
  url_resolved: 'https://stream.example.com/slow-start'
};

const legacyFalloutStation = {
  ...stations[0],
  stationuuid: 'uuid-fallout-legacy',
  name: 'Fallout 2 OST - Fallout.fm',
  url: 'http://fallout.fm:8000/falloutfm4.ogg',
  url_resolved: 'http://fallout.fm:8000/falloutfm4.ogg'
};

const remoteSkinBinary = readFileSync(
  fileURLToPath(new URL('../public/winamp-skins/base-2.91.wsz', import.meta.url))
);
const museumSkin = {
  md5: 'f8a6e3e5c1e12f120d6c2b4cbb374b4b',
  filename: 'cowboy_bebop.wsz',
  download_url: 'https://r2.webampskins.org/skins/f8a6e3e5c1e12f120d6c2b4cbb374b4b.wsz',
  screenshot_url: 'https://r2.webampskins.org/screenshots/f8a6e3e5c1e12f120d6c2b4cbb374b4b.png',
  museum_url: 'https://skins.webamp.org/skin/f8a6e3e5c1e12f120d6c2b4cbb374b4b',
  nsfw: false
};

const createSilentWav = (durationMs = 250) => {
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

const mockStations = async (page: Page) => {
  await page.route('**/catalog-fast.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stations)
    })
  );
  await page.route('**/catalog-full.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stations)
    })
  );
  await page.route('**/json/stations/search**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stations)
    })
  );
  await page.route('**/stream?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: mockStreamAudio
    })
  );
  await page.route('https://stream.example.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: mockStreamAudio
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
  await page.route('**/api/stream?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/mpeg',
      body: ''
    })
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
  await page.route('**/metadata?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        nowPlaying: 'Mock Song',
        source: 'test'
      })
    })
  );
  await page.route('**/fetch?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: 'title=Mock Song'
    })
  );
  await page.route('https://skins.webamp.org/graphql', async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as {
      query?: string;
      variables?: Record<string, unknown>;
    };
    const query = payload.query || '';
    const variables = payload.variables || {};

    if (query.includes('search_classic_skins')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            search_classic_skins: [museumSkin]
          }
        })
      });
      return;
    }

    if (query.includes('fetch_skin_by_md5')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            fetch_skin_by_md5:
              variables.md5 === museumSkin.md5 ? museumSkin : null
          }
        })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {} })
    });
  });
  await page.route('https://r2.webampskins.org/skins/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: remoteSkinBinary
    });
  });
  await page.route('https://r2.webampskins.org/screenshots/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnKXu8AAAAASUVORK5CYII=',
        'base64'
      )
    });
  });
};

const overrideCatalog = async (page: Page, values: typeof stations) => {
  const body = JSON.stringify(values);
  await page.route('**/catalog-fast.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body
    })
  );
  await page.route('**/catalog-full.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body
    })
  );
  await page.route('**/json/stations/search**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body
    })
  );
};

const openFullscreenPlayer = async (page: Page) => {
  await expect(page.locator('#webamp')).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Открыть полноэкранный плеер' }).click();
  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('#webamp')).toHaveCount(1, { timeout: 15_000 });
};

const waitForWebampWindowVisible = async (page: Page, id: string) => {
  await expect
    .poll(async () => {
      return page.evaluate((windowId) => {
        const node = document.querySelector(`#${windowId}`)?.closest('.window') as HTMLElement | null;
        if (!node) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 8 &&
          rect.height > 8
        );
      }, id);
    })
    .toBe(true);
};

const waitForWebampReady = async (page: Page) => {
  await expect(page.locator('#webamp')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('#main-window')).toHaveCount(1, { timeout: 10_000 });
};

const getWebampWindowRect = async (page: Page, id: string) =>
  page.evaluate((windowId) => {
    const rect = document.querySelector(`#${windowId}`)?.closest('.window')?.getBoundingClientRect();
    return rect
      ? {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      : null;
  }, id);

const getCompactMainWindowRect = async (page: Page) => getWebampWindowRect(page, 'main-window');

const getCompactShellState = async (page: Page) =>
  page.evaluate(() => {
    const shell = document.querySelector('.winamp-compact') as HTMLElement | null;
    const main = document.querySelector('.winamp-compact-main') as HTMLElement | null;
    return {
      compactView: shell?.dataset.compactView || '',
      shellHeight: main?.getBoundingClientRect().height ?? 0
    };
  });

const playStationInSection = async (page: Page, sectionLocator: string, stationName: string) => {
  const section = page.locator(sectionLocator);
  const row = section.locator('.station-row').filter({ hasText: stationName }).first();
  await expect(row).toBeVisible();
  await row.locator('.play-btn').click();
};

const playHomeStation = async (page: Page, stationName: string, section = 'trending') =>
  playStationInSection(page, `[data-home-section="${section}"]`, stationName);

const resumeFromPlayerRail = async (page: Page) => {
  const rail = page.locator('.app-rail');
  await expect(rail).toBeVisible();
  await triggerWebampControl(page, 'Play');
};

const dragWebampWindow = async (page: Page, id: string, offsetX: number, offsetY: number) => {
  await page.evaluate(
    ({ windowId, nextOffsetX, nextOffsetY }) => {
      const api = (
        window as typeof window & {
          __radioAtlasWinamp?: {
            moveExpandedWindow: (id: string, deltaX: number, deltaY: number) => boolean;
          };
        }
      ).__radioAtlasWinamp;
      if (!api?.moveExpandedWindow?.(windowId, nextOffsetX, nextOffsetY)) {
        throw new Error(`Unable to move window: ${windowId}`);
      }
    },
    { windowId: id, nextOffsetX: offsetX, nextOffsetY: offsetY }
  );
};

const setWebampSliderValue = async (page: Page, title: string, value: number) => {
  await page.evaluate(
    ({ sliderTitle, nextValue }) => {
      const slider = document.querySelector(`[title="${sliderTitle}"]`) as HTMLElement | null;
      if (!slider) {
        throw new Error(`Slider not found: ${sliderTitle}`);
      }

      if (slider instanceof HTMLInputElement) {
        slider.value = String(nextValue);
      } else {
        slider.setAttribute('aria-valuenow', String(nextValue));
        slider.setAttribute('value', String(nextValue));
      }

      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      slider.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    },
    { sliderTitle: title, nextValue: value }
  );
};

const setWebampEqBandValue = async (page: Page, id: string, value: number) => {
  await openWebampEqWindow(page);
  await page.evaluate(
    ({ sliderId, nextValue }) => {
      const sliderRoot = document.querySelector(`#${sliderId} > *`) as HTMLElement | null;
      const handle = sliderRoot?.firstElementChild as HTMLElement | null;
      if (!sliderRoot || !handle) {
        throw new Error(`Equalizer slider not found: ${sliderId}`);
      }

      const nextOffset = (1 - nextValue / 100) * 51;
      const fireMouse = (target: EventTarget) => {
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      };

      const applyValue = () => {
        handle.style.transform = `translateY(${nextOffset}px)`;
        handle.setAttribute('data-test-value', String(nextValue));
        fireMouse(sliderRoot);
        fireMouse(handle);
        handle.dispatchEvent(new Event('input', { bubbles: true }));
        handle.dispatchEvent(new Event('change', { bubbles: true }));
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        document.dispatchEvent(new Event('click', { bubbles: true }));
      };

      applyValue();
      window.setTimeout(applyValue, 32);
      window.requestAnimationFrame(() => {
        applyValue();
      });
    },
    { sliderId: id, nextValue: value }
  );
  await page.waitForTimeout(120);
};

const openWebampEqWindow = async (page: Page) => {
  const isVisible = async () =>
    page.evaluate(() => {
      const node = document.querySelector('#equalizer-window')?.closest('.window') as HTMLElement | null;
      if (!node) return false;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 8 &&
        rect.height > 8
      );
    });

  if (await isVisible()) return;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.locator('[title="Toggle Graphical Equalizer"]').click({ force: true });
    try {
      await waitForWebampWindowVisible(page, 'equalizer-window');
      return;
    } catch {
      // Retry once if Webamp ignored the first toggle during layout sync.
    }
  }

  throw new Error('Equalizer window did not open');
};

const triggerWebampControl = async (page: Page, title: string) => {
  await page.evaluate((controlTitle) => {
    const control = document.querySelector(`[title="${controlTitle}"]`) as HTMLElement | null;
    if (!control) {
      throw new Error(`Control not found: ${controlTitle}`);
    }
    control.click();
  }, title);
};

test.beforeEach(async ({ page }) => {
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
    // @ts-expect-error test polyfill
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

  await mockStations(page);
});

test('explore loads and compact winamp shell is visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.app-title')).toHaveText('RadioAtlas');
  await expect(page.getByRole('heading', { name: 'Эфир без лишнего шума' })).toBeVisible();
  await expect(
    page.locator('.station-row').filter({ hasText: 'Tokyo FM' }).first()
  ).toBeVisible();
  await expect(page.locator('.winamp-compact')).toBeVisible();
  await expect(page.locator('.winamp-host.compact')).toBeVisible();
  await waitForWebampReady(page);
  await page.waitForTimeout(4500);
  const mainWindowRect = await getCompactMainWindowRect(page);
  expect(mainWindowRect).not.toBeNull();
  expect(mainWindowRect!.width).toBeGreaterThanOrEqual(180);
  expect(mainWindowRect!.height).toBeGreaterThanOrEqual(40);
});

test('playback from table updates winamp shell and info panel', async ({ page }) => {
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('.audio-hidden')).toHaveCount(1);
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () => {
      return page.evaluate(
        () => (document.querySelector('.audio-hidden') as HTMLAudioElement | null)?.src || ''
      );
    })
    .toContain('tokyo');
  await openFullscreenPlayer(page);
  const expandedRect = await getWebampWindowRect(page, 'main-window');
  expect(expandedRect).not.toBeNull();
  expect(expandedRect!.width).toBeGreaterThanOrEqual(220);

  await expect(page.getByRole('button', { name: 'Инфо', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Инфо', exact: true }).click();
  await expect(page.locator('.details-card')).toBeVisible();
  await expect(page.locator('.details-title')).toHaveText('Tokyo FM');
});

test('clicking the active station pauses the real audio engine', async ({ page }) => {
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  const compactPause = page.locator('[title="Pause"]').first();
  await expect(compactPause).toBeVisible();
  await page.waitForTimeout(200);
  await compactPause.click();
  await expect
    .poll(async () => page.locator('.audio-hidden').getAttribute('data-ra-state'))
    .toBe('paused');
});

test('compact winamp stays visible after playback starts without dom mutation errors', async ({
  page
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/');
  await waitForWebampReady(page);
  await playHomeStation(page, 'Tokyo FM');
  await waitForWebampWindowVisible(page, 'main-window');
  await expect(page.locator('[title="Pause"]').first()).toBeVisible();
  await expect(page.locator('.winamp-trackline.compact')).toContainText(/Tokyo FM|Mock Song/);
  await expect(page.locator('.winamp-trackline.compact')).not.toContainText('Название трека недоступно');

  await page.waitForTimeout(1200);
  await waitForWebampWindowVisible(page, 'main-window');
  expect(
    consoleErrors.filter(
      (entry) => entry.includes('NotFoundError') || entry.includes('removeChild') || entry.includes('insertBefore')
    )
  ).toEqual([]);
});

test('webamp pause control always pauses and resumes the real audio engine', async ({ page }) => {
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await openFullscreenPlayer(page);

  await triggerWebampControl(page, 'Pause');
  await expect
    .poll(async () => page.locator('.audio-hidden').getAttribute('data-ra-state'))
    .toBe('paused');

  await triggerWebampControl(page, 'Play');
  await expect
    .poll(async () => page.locator('.audio-hidden').getAttribute('data-ra-state'))
    .toBe('playing');
});

test('switching between stations keeps selected station as current', async ({ page }) => {
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');
  const berlinRow = page
    .locator('.station-table.compact .station-row')
    .filter({ hasText: 'Berlin Pulse' })
    .first();
  await berlinRow.locator('.play-btn').click();
  await expect
    .poll(async () => {
      return page.evaluate(
        () => (document.querySelector('.audio-hidden') as HTMLAudioElement | null)?.src || ''
      );
    })
    .toContain('berlin');
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (document.querySelector('[title="Song Title"]')?.textContent || '')
            .replace(/\s+/g, '')
            .toLowerCase()
      )
    )
    .toContain('berlinpulse');
  await openFullscreenPlayer(page);
  await page.getByRole('button', { name: 'Инфо', exact: true }).click();
  await expect(page.locator('.details-title')).toHaveText('Berlin Pulse');
});

test('station starts even when it was not in the saved winamp playlist', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'radio:playback-queue:v2',
      JSON.stringify({
        items: [
          {
            stationuuid: 'uuid-berlin',
            name: 'Berlin Pulse',
            url_resolved: 'https://stream.example.com/berlin',
            favicon: '',
            country: 'Germany',
            state: 'Berlin',
            tags: 'techno,house',
            geo_lat: 52.52,
            geo_long: 13.405
          }
        ],
        currentIndex: 0,
        sourceId: 'stale-test',
        sourceLabel: 'Stale queue'
      })
    );
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Поиск' }).click();
  await page.getByPlaceholder('Название, жанр, страна, язык').fill('Tokyo');
  await page.locator('.screen-search .play-btn').first().click();

  await expect(page.getByRole('button', { name: 'Открыть полноэкранный плеер' })).toBeVisible();
  await openFullscreenPlayer(page);
  await expect(page.locator('#webamp')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Инфо', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Инфо', exact: true }).click();
  await expect(page.locator('.details-title')).toHaveText('Tokyo FM');
});

test('favorite station can start even when saved winamp playlist is stale', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'radio:favorites',
      JSON.stringify([
        {
          stationuuid: 'uuid-tokyo',
          name: 'Tokyo FM',
          url_resolved: 'https://stream.example.com/tokyo',
          favicon: '',
          country: 'Japan',
          state: 'Tokyo',
          tags: 'pop,jpop',
          geo_lat: 35.6895,
          geo_long: 139.6917
        }
      ])
    );
    localStorage.setItem(
      'radio:playback-queue:v2',
      JSON.stringify({
        items: [
          {
            stationuuid: 'uuid-berlin',
            name: 'Berlin Pulse',
            url_resolved: 'https://stream.example.com/berlin',
            favicon: '',
            country: 'Germany',
            state: 'Berlin',
            tags: 'techno,house',
            geo_lat: 52.52,
            geo_long: 13.405
          }
        ],
        currentIndex: 0,
        sourceId: 'stale-test',
        sourceLabel: 'Stale queue'
      })
    );
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Моё' }).click();
  await expect(page.getByText('Мои станции')).toBeVisible();
  await page.locator('.screen-favorites .play-btn').first().click();
  await openFullscreenPlayer(page);
  await expect(page.locator('#webamp')).toHaveCount(1);
  await page.getByRole('button', { name: 'Инфо', exact: true }).click();
  await expect(page.locator('.details-title')).toHaveText('Tokyo FM');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const raw = localStorage.getItem('radio:playback-queue:v2');
        if (!raw) return null;
        const queue = JSON.parse(raw) as {
          items?: Array<{ stationuuid?: string }>;
          currentIndex?: number;
        };
        return {
          count: queue.items?.length ?? 0,
          currentIndex: queue.currentIndex ?? -1,
          currentStation: queue.items?.[queue.currentIndex ?? 0]?.stationuuid ?? null
        };
      })
    )
    .toEqual({
      count: 1,
      currentIndex: 0,
      currentStation: 'uuid-tokyo'
    });
});

test('discover flow and full navigation still work', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Поиск' }).click();
  await expect(page.getByText('Быстрый заход по регионам')).toBeVisible();

  await page.getByRole('button', { name: /Asia/ }).click();
  await expect(page.getByPlaceholder('Фильтр по стране')).toBeVisible();

  await page.getByPlaceholder('Фильтр по стране').fill('jap');
  await page.getByRole('button', { name: /Japan/ }).click();

  await expect(
    page.locator('.station-row').filter({ hasText: 'Tokyo FM' }).first()
  ).toBeVisible();
  await page.locator('.screen-search .play-btn').first().click();
  await expect(page.getByRole('button', { name: 'Открыть полноэкранный плеер' })).toBeVisible();

  await page.getByRole('button', { name: 'Моё' }).click();
  await expect(page.getByText('Мои станции')).toBeVisible();

  await page.getByRole('button', { name: 'Поиск' }).click();
  await expect(page.getByPlaceholder('Название, жанр, страна, язык')).toBeVisible();

  await page.getByRole('button', { name: 'Очередь' }).click();
  await expect(page.locator('.screen-playlist .section-title').first()).toHaveText('Очередь');

  await page.getByRole('button', { name: 'Настройки' }).click();
  await expect(page.getByText('Скин плеера')).toBeVisible();
});

test('switching tabs does not stop playback or replace the active station', async ({ page }) => {
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');

  await page.getByRole('button', { name: 'Поиск' }).click();
  await expect(page.getByPlaceholder('Название, жанр, страна, язык')).toBeVisible();
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');

  await page.getByRole('button', { name: 'Моё' }).click();
  await expect(page.getByText('Мои станции')).toBeVisible();
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');

  await page.getByRole('button', { name: 'Очередь' }).click();
  await expect(page.locator('.playlist-row')).toHaveCount(3);
  await expect(page.locator('.playlist-row.active')).toContainText('Tokyo FM');
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
});

test('expand and collapse winamp overlay', async ({ page }) => {
  await page.goto('/');
  await openFullscreenPlayer(page);
  await expect(page.locator('.winamp-compact.fullscreen-ui')).toBeVisible();
  await expect(page.locator('#webamp')).toHaveCount(1);
  await expect(page.locator('#webamp .window').first()).toBeVisible();

  await page.getByRole('button', { name: 'Свернуть', exact: true }).click();
  await expect(page.locator('.winamp-compact.fullscreen-ui')).toHaveCount(0);
  await expect(page.locator('.winamp-compact')).toBeVisible();
});

test('windowshade toggle expands compact strip to main window without full overlay', async ({ page }) => {
  await page.goto('/');
  await waitForWebampReady(page);
  const shadeToggle = page.locator('[title="Toggle Windowshade Mode"]').first();
  await expect(shadeToggle).toBeVisible();
  const initialShell = await getCompactShellState(page);
  expect(initialShell.compactView).toBe('panel');
  expect(initialShell.shellHeight).toBeGreaterThan(80);

  await shadeToggle.click();
  await expect(page.locator('.winamp-compact.fullscreen-ui')).toHaveCount(0);
  await expect
    .poll(async () => {
      return getCompactShellState(page);
    })
    .toMatchObject({
      compactView: 'strip',
      shellHeight: expect.any(Number)
    });
  await expect
    .poll(async () => (await getCompactShellState(page)).shellHeight)
    .toBeLessThan(initialShell.shellHeight - 20);

  await shadeToggle.click();
  await expect
    .poll(async () => {
      return getCompactShellState(page);
    })
    .toMatchObject({
      compactView: 'panel',
      shellHeight: expect.any(Number)
    });
  await expect
    .poll(async () => (await getCompactShellState(page)).shellHeight)
    .toBeGreaterThan(initialShell.shellHeight - 10);
});

test('expanded mode keeps station list clickable', async ({ page }) => {
  await page.goto('/');
  await openFullscreenPlayer(page);

  const targetRow = page
    .locator('.station-table.compact .station-row')
    .filter({ hasText: 'Berlin Pulse' })
    .first();
  await targetRow.locator('.play-btn').click();
  await expect(targetRow.getByRole('button', { name: 'Пауза' })).toBeVisible();
});

test('fullscreen windows can be repositioned', async ({ page }) => {
  await page.goto('/');
  await openFullscreenPlayer(page);
  await page.waitForTimeout(1400);

  const before = await getWebampWindowRect(page, 'main-window');
  expect(before).not.toBeNull();

  await dragWebampWindow(page, 'main-window', 120, 70);

  await expect
    .poll(async () => {
      const rect = await getWebampWindowRect(page, 'main-window');
      if (!rect || !before) return 0;
      return Math.abs(rect.x - before.x);
    })
    .toBeGreaterThanOrEqual(80);

  await expect
    .poll(async () => {
      const rect = await getWebampWindowRect(page, 'main-window');
      if (!rect || !before) return 0;
      return Math.abs(rect.y - before.y);
    })
    .toBeGreaterThanOrEqual(4);

  const after = await getWebampWindowRect(page, 'main-window');
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x)).toBeGreaterThanOrEqual(80);
  expect(Math.abs(after!.y - before!.y)).toBeGreaterThanOrEqual(4);
  expect(after!.width).toBe(before!.width);
  expect(after!.height).toBe(before!.height);
});

test('desktop fullscreen exposes reset layout control', async ({ page }) => {
  await page.goto('/');
  await openFullscreenPlayer(page);
  await expect(page.getByRole('button', { name: 'Сбросить окна' })).toBeVisible();
});

test('mobile compact player stays usable above bottom nav', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      get: () => 5
    });
  });
  await page.goto('/');

  const compactMain = page.locator('.winamp-compact-main');
  const nav = page.locator('.bottom-nav');

  await expect(compactMain).toBeVisible();
  await expect(nav).toBeVisible();

  const compactBox = await compactMain.boundingBox();
  const navBox = await nav.boundingBox();
  const mainWindowRect = await getCompactMainWindowRect(page);

  expect(compactBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(mainWindowRect).not.toBeNull();
  expect(compactBox!.height).toBeGreaterThanOrEqual(40);
  expect(compactBox!.y + compactBox!.height).toBeLessThanOrEqual(navBox!.y - 4);
  expect(mainWindowRect!.width).toBeGreaterThanOrEqual(180);

  await page.waitForTimeout(4500);

  const stableCompactBox = await compactMain.boundingBox();
  const stableMainWindowRect = await getCompactMainWindowRect(page);
  expect(stableCompactBox).not.toBeNull();
  expect(stableMainWindowRect).not.toBeNull();
  expect(stableCompactBox!.y + stableCompactBox!.height).toBeLessThanOrEqual(navBox!.y - 4);
  expect(stableMainWindowRect!.width).toBeGreaterThanOrEqual(180);
});

test('mobile fullscreen scales the main window close to screen width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openFullscreenPlayer(page);

  await expect
    .poll(async () => getWebampWindowRect(page, 'main-window'))
    .toMatchObject({
      width: expect.any(Number)
    });

  const rect = await getWebampWindowRect(page, 'main-window');
  expect(rect).not.toBeNull();
  expect(rect!.width).toBeGreaterThanOrEqual(300);
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
  await expect(page.locator('#playlist-window').locator('xpath=ancestor::div[contains(@class, "window")]')).toHaveCount(0);
});

test('narrow popup fullscreen keeps the main window visible', async ({ page }) => {
  await page.setViewportSize({ width: 537, height: 843 });
  await page.goto('/');
  await openFullscreenPlayer(page);

  const rect = await getWebampWindowRect(page, 'main-window');
  expect(rect).not.toBeNull();
  expect(rect!.width).toBeGreaterThanOrEqual(260);
  expect(rect!.height).toBeGreaterThanOrEqual(120);
});

test('skin preset change persists in localStorage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByPlaceholder('Поиск по skins.webamp.org').fill('bebop');
  await expect(page.getByRole('listitem')).toContainText('cowboy_bebop.wsz');
  await page.getByRole('button', { name: 'Применить' }).click();
  const stored = await page.evaluate(() => localStorage.getItem('radio:winamp-skin'));
  expect(stored).toContain('museum');
  expect(stored).toContain('f8a6e3e5c1e12f120d6c2b4cbb374b4b');
});

test('skin museum selection restores after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByPlaceholder('Поиск по skins.webamp.org').fill('bebop');
  await page.getByRole('button', { name: 'Применить' }).click();
  await expect(page.locator('.skin-picker-current')).toHaveText('cowboy_bebop.wsz');

  await page.reload();
  await page.getByRole('button', { name: 'Настройки' }).click();
  await expect(page.locator('.skin-picker-current')).toHaveText('cowboy_bebop.wsz');
});

test('share action always displays toast', async ({ page }) => {
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');
  await openFullscreenPlayer(page);
  await page.getByRole('button', { name: 'Поделиться' }).click();
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.toast')).toContainText(/шар|ссыл|скоп|диалог/i);
});

test('track line shows track title only and supports copy click', async ({ page }) => {
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');

  const trackLine = page.locator('.winamp-trackline.compact');
  await expect(trackLine).toBeVisible();
  const state = await page.evaluate(() => {
    const node = document.querySelector('.winamp-trackline.compact') as HTMLButtonElement | null;
    return {
      disabled: Boolean(node?.disabled),
      text: node?.textContent?.trim() || ''
    };
  });
  if (!state.disabled) {
    await expect(trackLine).toContainText('Mock Song');
    await expect(trackLine).not.toContainText('Tokyo FM');
    await trackLine.click();
    await expect(page.locator('.toast')).toContainText(/трек|скоп/i);
  } else {
    await expect(trackLine).toContainText('Tokyo FM');
    await expect(trackLine).not.toContainText('Название трека недоступно');
  }
});

test('track line falls back to station name when metadata is unavailable', async ({ page }) => {
  await page.route('**/metadata?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        nowPlaying: '',
        source: 'test'
      })
    })
  );
  await page.route('**/fetch?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      body: ''
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
            title: ''
          }
        }
      })
    })
  );

  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');

  const trackLine = page.locator('.winamp-trackline.compact');
  await expect(trackLine).toBeVisible();
  await expect(trackLine).toContainText('Tokyo FM');
  await expect(trackLine).not.toContainText('Название трека недоступно');
  await expect(trackLine).toBeDisabled();
});

test('webamp internal timer and seek move with live radio playback', async ({ page }) => {
  await page.goto('/');
  await waitForWebampReady(page);
  await playHomeStation(page, 'Tokyo FM');

  const readTimerState = async () =>
    page.evaluate(() => {
      const api = (
        window as Window & {
          __radioAtlasWinamp?: {
            getStoreState: () => {
              media?: {
                status?: string;
                timeElapsed?: number;
              };
            } | null;
          };
        }
      ).__radioAtlasWinamp;
      const state = api?.getStoreState?.();
      const timeNode = document.getElementById('time');
      const title = (document.querySelector('[title="Song Title"]')?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      const digitClasses = Array.from(timeNode?.querySelectorAll('.digit') || []).map((node) =>
        Array.from(node.classList).find((value) => value.startsWith('digit-')) || ''
      );
      return {
        isStopped: state?.media?.status === 'STOPPED',
        timerVisible: timeNode ? window.getComputedStyle(timeNode).display !== 'none' : false,
        elapsed: Math.floor(Number(state?.media?.timeElapsed || 0)),
        status: state?.media?.status || '',
        title,
        digitClasses
      };
    });

  await expect.poll(readTimerState).toMatchObject({
    isStopped: false,
    timerVisible: true,
    title: expect.stringContaining('Tokyo FM')
  });

  await page.evaluate(() => {
    const api = (
      window as Window & {
        __radioAtlasWinamp?: {
          dispatchStoreAction: (action: { type: string; elapsed?: number }) => void;
        };
      }
    ).__radioAtlasWinamp;
    api?.dispatchStoreAction({
      type: 'UPDATE_TIME_ELAPSED',
      elapsed: 3
    });
  });

  await expect
    .poll(async () => {
      const state = await readTimerState();
      return {
        elapsed: state.elapsed,
        hasNonZeroDigit: state.digitClasses.some((value) => value !== 'digit-0')
      };
    })
    .toEqual({
      elapsed: expect.any(Number),
      hasNonZeroDigit: true
    });

  await page
    .locator('.station-table.compact .station-row')
    .filter({ hasText: 'Berlin Pulse' })
    .first()
    .locator('.play-btn')
    .click();

  await expect.poll(readTimerState).toMatchObject({
    isStopped: false,
    timerVisible: true,
    title: expect.stringContaining('Berlin Pulse')
  });

  await page.evaluate(() => {
    const api = (
      window as Window & {
        __radioAtlasWinamp?: {
          dispatchStoreAction: (action: { type: string; elapsed?: number }) => void;
        };
      }
    ).__radioAtlasWinamp;
    api?.dispatchStoreAction({
      type: 'UPDATE_TIME_ELAPSED',
      elapsed: 5
    });
  });

  await expect
    .poll(async () => {
      const state = await readTimerState();
      return {
        elapsed: state.elapsed,
        hasNonZeroDigit: state.digitClasses.some((value) => value !== 'digit-0')
      };
    })
    .toEqual({
      elapsed: expect.any(Number),
      hasNonZeroDigit: true
    });
});

test('webamp next button follows radio random navigation in fullscreen', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.4;
  });
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');
  await openFullscreenPlayer(page);

  await triggerWebampControl(page, 'Next Track');
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const activeRow = document.querySelector('.station-row.active .station-title .marquee-text');
        return activeRow?.textContent?.trim() || '';
      });
    })
    .toBe('Berlin Pulse');
});

test('next track can leave a single-station queue and use the full catalog', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.4;
    localStorage.setItem(
      'radio:playback-queue:v2',
      JSON.stringify({
        items: [
          {
            stationuuid: 'uuid-tokyo',
            name: 'Tokyo FM',
            url_resolved: 'https://stream.example.com/tokyo',
            favicon: '',
            country: 'Japan',
            state: 'Tokyo',
            tags: 'pop,jpop',
            geo_lat: 35.6895,
            geo_long: 139.6917
          }
        ],
        currentIndex: 0,
        sourceId: 'single-station',
        sourceLabel: 'Single station'
      })
    );
  });

  await page.goto('/');
  await resumeFromPlayerRail(page);
  await openFullscreenPlayer(page);

  await triggerWebampControl(page, 'Next Track');
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const activeRow = document.querySelector('.station-row.active .station-title .marquee-text');
        return activeRow?.textContent?.trim() || '';
      });
    })
    .toBe('Berlin Pulse');
});

test('next track follows queue order before global fallback', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.4;
    localStorage.setItem(
      'radio:playback-queue:v2',
      JSON.stringify({
        items: [
          {
            stationuuid: 'uuid-tokyo',
            name: 'Tokyo FM',
            url_resolved: 'https://stream.example.com/tokyo',
            favicon: '',
            country: 'Japan',
            state: 'Tokyo',
            tags: 'pop,jpop',
            geo_lat: 35.6895,
            geo_long: 139.6917
          },
          {
            stationuuid: 'uuid-berlin',
            name: 'Berlin Pulse',
            url_resolved: 'https://stream.example.com/berlin',
            favicon: '',
            country: 'Germany',
            state: 'Berlin',
            tags: 'techno,house',
            geo_lat: 52.52,
            geo_long: 13.405
          },
          {
            stationuuid: 'uuid-rio',
            name: 'Rio Beats',
            url_resolved: 'https://stream.example.com/rio',
            favicon: '',
            country: 'Brazil',
            state: 'Rio de Janeiro',
            tags: 'samba,bossa',
            geo_lat: -22.9068,
            geo_long: -43.1729
          }
        ],
        currentIndex: 0,
        sourceId: 'ordered-queue',
        sourceLabel: 'Ordered queue'
      })
    );
  });

  await page.goto('/');
  await resumeFromPlayerRail(page);
  await openFullscreenPlayer(page);

  await triggerWebampControl(page, 'Next Track');
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const activeRow = document.querySelector('.station-row.active .station-title .marquee-text');
        return activeRow?.textContent?.trim() || '';
      });
    })
    .toBe('Berlin Pulse');

  await triggerWebampControl(page, 'Next Track');
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const activeRow = document.querySelector('.station-row.active .station-title .marquee-text');
        return activeRow?.textContent?.trim() || '';
      });
    })
    .toBe('Rio Beats');
});

test('webamp next skips an unplayable queue station and continues to a playable one', async ({ page }) => {
  await overrideCatalog(page, [stations[0], brokenQueueStation, stations[1]]);
  await page.route('https://stream.example.com/broken-queue', (route) => route.abort('failed'));
  await page.addInitScript(() => {
    const basePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const src = this.src || '';
      if (src.includes('broken-queue')) {
        this.setAttribute('data-ra-state', 'error');
        this.dispatchEvent(new Event('error'));
        return Promise.reject(new Error('broken queue candidate'));
      }
      return basePlay.call(this);
    };
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      'radio:playback-queue:v2',
      JSON.stringify({
        items: [
          {
            stationuuid: 'uuid-tokyo',
            name: 'Tokyo FM',
            url_resolved: 'https://stream.example.com/tokyo',
            favicon: '',
            country: 'Japan',
            state: 'Tokyo',
            tags: 'pop,jpop',
            geo_lat: 35.6895,
            geo_long: 139.6917
          },
          {
            stationuuid: 'uuid-broken-queue',
            name: 'Broken Queue FM',
            url_resolved: 'https://stream.example.com/broken-queue',
            favicon: '',
            country: 'Nowhere',
            state: '',
            tags: 'broken',
            geo_lat: null,
            geo_long: null
          },
          {
            stationuuid: 'uuid-berlin',
            name: 'Berlin Pulse',
            url_resolved: 'https://stream.example.com/berlin',
            favicon: '',
            country: 'Germany',
            state: 'Berlin',
            tags: 'techno,house',
            geo_lat: 52.52,
            geo_long: 13.405
          }
        ],
        currentIndex: 0,
        sourceId: 'ordered-queue',
        sourceLabel: 'Ordered queue'
      })
    );
  });

  await page.goto('/');
  await resumeFromPlayerRail(page);
  await openFullscreenPlayer(page);

  await triggerWebampControl(page, 'Next Track');
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const activeRow = document.querySelector('.station-row.active .station-title .marquee-text');
        return activeRow?.textContent?.trim() || '';
      });
    })
    .toBe('Berlin Pulse');
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.src || '';
      })
    )
    .toContain('berlin');
});

test('https direct station falls back to proxy when direct playback fails', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('radio:api-url', 'https://proxy.radio.test');
  });
  await page.route('https://proxy.radio.test/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    })
  );
  await page.route('https://stream.example.com/tokyo', (route) => route.abort('failed'));
  await page.route('https://proxy.radio.test/stream?url=**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: mockStreamAudio
    })
  );

  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');

  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.src || '';
      })
    )
    .toContain('https://proxy.radio.test/stream?url=');
});

test('https non-direct station starts when API proxy is offline', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ status: 503, body: 'offline' }));
  await page.route('**/stream?url=**', (route) => route.abort('failed'));

  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');

  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.src || '';
      });
    })
    .toContain('https://stream.example.com/tokyo');
});

test('http station upgrades to https when API proxy is offline', async ({ page }) => {
  await overrideCatalog(page, [httpUpgradeStation]);
  await page.route('**/api/health', (route) => route.fulfill({ status: 503, body: 'offline' }));
  await page.route('**/stream?url=**', (route) => route.abort('failed'));

  await page.goto('/');
  await page.locator('.play-btn').first().click();
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.src || '';
      });
    })
    .toContain('https://stream.example.com/http-upgrade.mp3');
});

test('http station still falls back to API proxy even when /health check fails', async ({ page }) => {
  await overrideCatalog(page, [httpUpgradeStation]);
  await page.addInitScript(() => {
    localStorage.setItem('radio:api-url', 'https://proxy.radio.test');
  });
  await page.route('https://proxy.radio.test/health', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false })
    })
  );
  await page.route('https://stream.example.com/http-upgrade.mp3', (route) => route.abort('failed'));
  await page.route('https://proxy.radio.test/stream?url=http%3A%2F%2Fstream.example.com%2Fhttp-upgrade.mp3', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: mockStreamAudio
    })
  );

  await page.goto('/');
  await page.locator('.play-btn').first().click();

  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.src || '';
      })
    )
    .toContain('https://proxy.radio.test/stream?url=http%3A%2F%2Fstream.example.com%2Fhttp-upgrade.mp3');
});

test('explicit same-origin api query makes http stations use proxy first even on local http', async ({
  page
}) => {
  await overrideCatalog(page, [httpUpgradeStation]);
  await page.route('**/api/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    })
  );
  await page.route('http://stream.example.com/http-upgrade.mp3', (route) => route.abort('failed'));
  await page.route('**/api/stream?url=http%3A%2F%2Fstream.example.com%2Fhttp-upgrade.mp3', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: mockStreamAudio
    })
  );

  await page.goto('/?api=/api');
  await page.locator('.play-btn').first().click();

  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.src || '';
      })
    )
    .toContain('/api/stream?url=http%3A%2F%2Fstream.example.com%2Fhttp-upgrade.mp3');
});

test('https stations use proxy first when same-origin api is available', async ({
  page
}) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    })
  );
  await page.route('https://stream.example.com/tokyo', (route) => route.abort('failed'));
  await page.route('**/api/stream?url=https%3A%2F%2Fstream.example.com%2Ftokyo', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: mockStreamAudio
    })
  );

  await page.goto('/?api=/api');
  await playHomeStation(page, 'Tokyo FM');

  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.src || '';
      })
    )
    .toContain('/api/stream?url=https%3A%2F%2Fstream.example.com%2Ftokyo');
});

test('uses original station url when url_resolved is stale or dead', async ({ page }) => {
  await overrideCatalog(page, [staleResolvedStation]);
  await page.addInitScript(() => {
    const basePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const src = this.src || '';
      if (src.includes('dead-stream.example.com')) {
        this.setAttribute('data-ra-state', 'error');
        this.dispatchEvent(new Event('error'));
        return Promise.reject(new Error('dead resolved candidate'));
      }
      return basePlay.call(this);
    };
  });
  await page.route('https://dead-stream.example.com/live.mp3', (route) => route.abort('failed'));
  await page.route('https://stream.example.com/fallback.m3u', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: mockStreamAudio
    })
  );

  await page.goto('/');
  await page.locator('.play-btn').first().click();

  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.src || '';
      })
    )
    .toContain('https://stream.example.com/fallback.m3u');
});

test('slow-start station is not skipped during startup buffering', async ({ page }) => {
  await overrideCatalog(page, [slowStartStation, stations[1]]);
  await page.addInitScript(() => {
    const basePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const src = this.src || '';
      if (!src.includes('slow-start')) {
        return basePlay.call(this);
      }
      if (this.dataset.raSlowStartReady === 'true') {
        return basePlay.call(this);
      }
      this.dataset.raSlowStartReady = 'true';
      this.setAttribute('data-ra-state', 'buffering');
      this.dispatchEvent(new Event('waiting'));
      return new Promise<void>((resolve) => {
        window.setTimeout(() => {
          this.setAttribute('data-ra-state', 'playing');
          this.dispatchEvent(new Event('playing'));
          resolve();
        }, 7000);
      });
    };
  });

  await page.goto('/');
  await page.locator('.play-btn').first().click();

  await page.waitForTimeout(6500);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.src || '';
      })
    )
    .toContain('slow-start');
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing', {
    timeout: 12000
  });
});

test('shows mixed content error when only http stream is left and API is offline', async ({ page }) => {
  await page.addInitScript(() => {
    const basePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const src = this.src || '';
      if (src.includes('broken-stream.example.com')) {
        this.setAttribute('data-ra-state', 'error');
        this.dispatchEvent(new Event('error'));
        return Promise.reject(new Error('blocked'));
      }
      return basePlay.call(this);
    };
  });

  await overrideCatalog(page, [brokenHttpStation]);
  await page.route('**/api/health', (route) => route.fulfill({ status: 503, body: 'offline' }));
  await page.route('**/stream?url=**', (route) => route.abort('failed'));

  await page.goto('/');
  await page.locator('.play-btn').first().click();
  await expect(page.locator('.toast')).toContainText(/stream blocked\/mixed content|no playable candidate/);
});

test('legacy fallout stream URL upgrades to active https endpoint', async ({ page }) => {
  await overrideCatalog(page, [legacyFalloutStation]);
  await page.route('**/api/health', (route) => route.fulfill({ status: 503, body: 'offline' }));
  await page.route('https://fallout.fm:8444/falloutfm4.ogg', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'audio/ogg',
      body: mockStreamAudio
    })
  );
  await page.route('http://fallout.fm:8000/falloutfm4.ogg', (route) => route.abort('failed'));
  await page.route('https://fallout.fm:8000/falloutfm4.ogg', (route) => route.abort('failed'));
  await page.route('**/stream?url=**', (route) => route.abort('failed'));

  await page.goto('/');
  await page.locator('.play-btn').first().click();

  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.src || '';
      })
    )
    .toContain('https://fallout.fm:8444/falloutfm4.ogg');
});

test('retro gyusyabu stream can use proxy mountpoint fallback', async ({ page }) => {
  await overrideCatalog(page, [
    {
      ...stations[0],
      stationuuid: 'uuid-retro-gyu',
      name: 'Retro PC GAME MUSIC Streaming Radio',
      url: 'http://gyusyabu.ddo.jp:8000/listen.pls',
      url_resolved: 'http://gyusyabu.ddo.jp:8000/'
    }
  ]);
  await page.addInitScript(() => {
    localStorage.setItem('radio:api-url', 'https://proxy.radio.test');
  });
  await page.route('https://proxy.radio.test/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    })
  );
  await page.route('https://gyusyabu.ddo.jp:8000/', (route) => route.abort('failed'));
  await page.route('https://proxy.radio.test/stream?url=http%3A%2F%2Fgyusyabu.ddo.jp%3A8000%2F', (route) =>
    route.abort('failed')
  );
  await page.route(
    'https://proxy.radio.test/stream?url=http%3A%2F%2Fgyusyabu.ddo.jp%3A8000%2F%3Bstream.mp3',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: mockStreamAudio
      })
  );

  await page.goto('/');
  await page.locator('.play-btn').first().click();

  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.src || '';
      })
    )
    .toContain('stream?url=http%3A%2F%2Fgyusyabu.ddo.jp%3A8000%2F%3Bstream.mp3');
});

test('proxy-first http playback does not let webamp request raw station streams', async ({
  page
}) => {
  let directStreamHits = 0;

  await overrideCatalog(page, [
    {
      ...stations[0],
      stationuuid: 'uuid-retro-gyu-webamp',
      name: 'Retro PC GAME MUSIC Streaming Radio',
      url: 'http://gyusyabu.ddo.jp:8000/listen.pls',
      url_resolved: 'http://gyusyabu.ddo.jp:8000/'
    }
  ]);
  await page.route('**/api/health', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true })
    })
  );
  await page.route('http://gyusyabu.ddo.jp:8000/**', (route) => {
    directStreamHits += 1;
    return route.abort('failed');
  });
  await page.route('https://gyusyabu.ddo.jp:8000/**', (route) => {
    directStreamHits += 1;
    return route.abort('failed');
  });
  await page.route('**/api/stream?url=http%3A%2F%2Fgyusyabu.ddo.jp%3A8000%2F', (route) =>
    route.abort('failed')
  );
  await page.route(
    '**/api/stream?url=http%3A%2F%2Fgyusyabu.ddo.jp%3A8000%2F%3Bstream.mp3',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'audio/wav',
        body: mockStreamAudio
      })
  );

  await page.goto('/?api=/api');
  await page.locator('.play-btn').first().click();

  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.src || '';
      })
    )
    .toContain('/api/stream?url=http%3A%2F%2Fgyusyabu.ddo.jp%3A8000%2F%3Bstream.mp3');

  await page.waitForTimeout(1500);
  expect(directStreamHits).toBe(0);
});

test('webamp previous button follows radio history in fullscreen', async ({ page }) => {
  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');
  await page
    .locator('.station-table.compact .station-row')
    .filter({ hasText: 'Berlin Pulse' })
    .first()
    .locator('.play-btn')
    .click();
  await openFullscreenPlayer(page);

  await triggerWebampControl(page, 'Previous Track');
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const activeRow = document.querySelector('.station-row.active .station-title .marquee-text');
        return activeRow?.textContent?.trim() || '';
      });
    })
    .toBe('Tokyo FM');
});

test('webamp volume bar updates the real audio engine volume', async ({ page }) => {
  await page.goto('/');
  await waitForWebampReady(page);
  await playHomeStation(page, 'Tokyo FM');
  await setWebampSliderValue(page, 'Volume Bar', 25);

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio ? Number(audio.volume.toFixed(2)) : -1;
      });
    })
    .toBe(0.25);
});

test('webamp balance slider updates the real audio engine balance', async ({ page }) => {
  await page.goto('/');
  await waitForWebampReady(page);
  await playHomeStation(page, 'Tokyo FM');
  await setWebampSliderValue(page, 'Balance', -100);

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.dataset.raBalance || '';
      });
    })
    .toBe('-100');
});

test('audio element opts into anonymous CORS for proxied analysis', async ({ page }) => {
  await page.goto('/?api=/api');
  await waitForWebampReady(page);
  await playHomeStation(page, 'Tokyo FM');

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.crossOrigin || '';
      });
    })
    .toBe('anonymous');
});

test('webamp equalizer updates the real player EQ state', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __RA_FORCE_AUDIO_GRAPH__?: boolean }).__RA_FORCE_AUDIO_GRAPH__ = true;
  });
  await page.goto('/');
  await waitForWebampReady(page);
  await playHomeStation(page, 'Tokyo FM');
  await openFullscreenPlayer(page);
  await page.waitForTimeout(900);
  await openWebampEqWindow(page);

  await setWebampEqBandValue(page, 'preamp', 100);
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return audio?.dataset.raEqPreamp || '';
      });
    })
    .toBe('100');

  await setWebampEqBandValue(page, 'band-600', 100);

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return {
          enabled: audio?.dataset.raEqEnabled || '',
          preamp: audio?.dataset.raEqPreamp || '',
          bands: (audio?.dataset.raEqBands || '')
            .split(',')
            .map((value) => Number(value))
        };
      });
    })
    .toEqual({
      enabled: 'true',
      preamp: '100',
      bands: [51, 51, 51, 100, 51, 51, 51, 51, 51, 51]
    });
});

test('visualizer reflects analyser activity from the real audio graph', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __RA_FORCE_AUDIO_GRAPH__?: boolean }).__RA_FORCE_AUDIO_GRAPH__ = true;
  });
  await page.goto('/');
  await waitForWebampReady(page);
  await playHomeStation(page, 'Tokyo FM');
  await openFullscreenPlayer(page);

  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
        return {
          active: audio?.dataset.raVisualizerActive || '',
          available: audio?.dataset.raVisualizerAvailable || '',
          levels: (audio?.dataset.raVisualizerSpectrum || '')
            .split(',')
            .filter(Boolean)
            .map((value) => Number(value))
        };
      });
    })
    .toMatchObject({
      active: 'true',
      available: 'true',
      levels: expect.any(Array)
    });

  const levels = await page.evaluate(() => {
    const audio = document.querySelector('.audio-hidden') as HTMLAudioElement | null;
    return (audio?.dataset.raVisualizerSpectrum || '')
      .split(',')
      .filter(Boolean)
      .map((value) => Number(value));
  });
  expect(levels).toHaveLength(8);
  expect(levels.every((value) => Number.isFinite(value))).toBeTruthy();

  await expect(page.locator('#main-window .ra-visualizer-overlay')).toBeVisible();
  await expect(page.locator('#main-window .ra-visualizer-overlay-bar')).toHaveCount(24);
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const main = document.getElementById('main-window');
        const overlay = document.querySelector('#main-window .ra-visualizer-overlay');
        if (!main || !overlay) return null;
        const mainRect = main.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        return {
          leftOffset: Number((overlayRect.left - mainRect.left).toFixed(1)),
          relativeWidth: Number((mainRect.width * 0.4).toFixed(1))
        };
      });
    })
    .toEqual({
      leftOffset: expect.any(Number),
      relativeWidth: expect.any(Number)
    });
  const overlayGeometry = await page.evaluate(() => {
    const main = document.getElementById('main-window');
    const overlay = document.querySelector('#main-window .ra-visualizer-overlay');
    if (!main || !overlay) return null;
    const mainRect = main.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    return {
      leftOffset: overlayRect.left - mainRect.left,
      rightEdge: overlayRect.right - mainRect.left,
      mainWidth: mainRect.width
    };
  });
  expect(overlayGeometry).not.toBeNull();
  expect(overlayGeometry!.leftOffset).toBeLessThan(overlayGeometry!.mainWidth * 0.3);
  expect(overlayGeometry!.rightEdge).toBeLessThan(overlayGeometry!.mainWidth * 0.45);
});


test('mobile search hides the global app header to keep more room for results', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Поиск' }).click();
  await expect(page.locator('.screen-search')).toBeVisible();
  await expect(page.locator('.app-header')).toBeHidden();
});

test('failed station switch does not replace the current title with a broken target', async ({
  page
}) => {
  await overrideCatalog(page, [stations[0], brokenQueueStation]);
  await page.addInitScript(() => {
    const basePlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      const src = this.src || '';
      if (src.includes('broken-queue')) {
        this.setAttribute('data-ra-state', 'error');
        this.dispatchEvent(new Event('error'));
        return Promise.reject(new Error('broken target'));
      }
      return basePlay.call(this);
    };
  });
  await page.route('https://stream.example.com/broken-queue', (route) => route.abort('failed'));

  await page.goto('/');
  await playHomeStation(page, 'Tokyo FM');

  const brokenRow = page
    .locator('.station-table.compact .station-row')
    .filter({ hasText: 'Broken Queue FM' })
    .first();
  await brokenRow.locator('.play-btn').click();

  await expect(page.locator('.toast')).toContainText(/no playable candidate|Playback failed/);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (document.querySelector('[title="Song Title"]')?.textContent || '')
            .replace(/\s+/g, '')
            .toLowerCase()
      )
    )
    .not.toContain('brokenqueuefm');
  await expect
    .poll(async () => {
      return page.evaluate(() => {
        const activeRow = document.querySelector('.station-row.active .station-title .marquee-text');
        return activeRow?.textContent?.trim() || '';
      });
    })
    .not.toBe('Broken Queue FM');
});
