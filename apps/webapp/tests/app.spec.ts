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

const openFullscreenPlayer = async (page: Page) => {
  await expect(page.locator('#webamp')).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole('button', { name: 'Fullscreen' }).click();
  await expect(page.locator('.winamp-compact.expanded-host')).toBeVisible();
  await expect(page.locator('#webamp')).toHaveCount(1, { timeout: 15_000 });
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

const setWebampEqHandleOffset = async (page: Page, id: string, offset: number) => {
  await page.evaluate(
    ({ sliderId, nextOffset }) => {
      const band = document.querySelector(`#${sliderId}`) as HTMLElement | null;
      const sliderRoot = band?.firstElementChild as HTMLElement | null;
      const handle = sliderRoot?.firstElementChild as HTMLElement | null;
      if (!handle) {
        throw new Error(`EQ slider not found: ${sliderId}`);
      }
      handle.style.transform = `translateY(${nextOffset}px)`;
    },
    { sliderId: id, nextOffset: offset }
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
  await expect(page.getByRole('heading', { name: 'Explore the airwaves' })).toBeVisible();
  await expect(
    page.locator('.station-row').filter({ hasText: 'Tokyo FM' }).first()
  ).toBeVisible();
  await expect(page.locator('.winamp-compact')).toBeVisible();
  await expect(page.locator('.winamp-host.compact')).toBeVisible();
});

test('playback from table updates winamp shell and info panel', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).first().click();
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

  await expect(page.getByRole('button', { name: 'Info', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(page.locator('.details-card')).toBeVisible();
  await expect(page.locator('.details-title')).toHaveText('Tokyo FM');
});

test('clicking the active station pauses the real audio engine', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).first().click();
  await expect(page.locator('.audio-hidden')).toHaveAttribute('data-ra-state', 'playing');
  await expect(page.locator('.winamp-trackline.compact')).toContainText('Mock Song');

  const compactPause = page.locator('.winamp-actions.compact').getByRole('button', { name: 'Pause' });
  await expect(compactPause).toBeVisible();
  await page.waitForTimeout(200);
  await compactPause.click();
  await expect
    .poll(async () => page.locator('.audio-hidden').getAttribute('data-ra-state'))
    .toBe('paused');
});

test('switching between stations keeps selected station as current', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).first().click();
  const berlinRow = page
    .locator('.station-table.compact .station-row')
    .filter({ hasText: 'Berlin Pulse' })
    .first();
  await berlinRow.getByRole('button', { name: 'Play' }).click();
  await openFullscreenPlayer(page);
  await page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(page.locator('.details-title')).toHaveText('Berlin Pulse');
});

test('station starts even when it was not in the saved winamp playlist', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'radio:winamp-playlist',
      JSON.stringify([
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
      ])
    );
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByPlaceholder('Search by name, tag, country, language').fill('Tokyo');
  await page.getByRole('button', { name: 'Play' }).first().click();

  await expect(page.getByRole('button', { name: 'Fullscreen' })).toBeVisible();
  await openFullscreenPlayer(page);
  await expect(page.locator('#webamp')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Info', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Info', exact: true }).click();
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
      'radio:winamp-playlist',
      JSON.stringify([
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
      ])
    );
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Favorites' }).click();
  await expect(page.getByText('My Stations')).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).first().click();
  await openFullscreenPlayer(page);
  await expect(page.locator('#webamp')).toHaveCount(1);
  await page.getByRole('button', { name: 'Info', exact: true }).click();
  await expect(page.locator('.details-title')).toHaveText('Tokyo FM');
});

test('browse flow and full navigation still work', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Browse' }).click();
  await expect(page.getByText('Choose a continent to explore local stations.')).toBeVisible();

  await page.getByRole('button', { name: /Asia/ }).click();
  await expect(page.getByPlaceholder('Search country')).toBeVisible();

  await page.getByPlaceholder('Search country').fill('jap');
  await page.getByRole('button', { name: /Japan/ }).click();

  await expect(
    page.locator('.station-row').filter({ hasText: 'Tokyo FM' }).first()
  ).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).first().click();
  await expect(page.getByRole('button', { name: 'Fullscreen' })).toBeVisible();

  await page.getByRole('button', { name: 'Favorites' }).click();
  await expect(page.getByText('My Stations')).toBeVisible();

  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByPlaceholder('Search by name, tag, country, language')).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Player Skin')).toBeVisible();
});

test('expand and collapse winamp overlay', async ({ page }) => {
  await page.goto('/');
  await openFullscreenPlayer(page);
  await expect(page.locator('.winamp-compact.expanded-host')).toBeVisible();
  await expect(page.locator('#webamp')).toHaveCount(1);
  await expect(page.locator('#webamp .window').first()).toBeVisible();

  await page.getByRole('button', { name: 'Collapse', exact: true }).click();
  await expect(page.locator('.winamp-compact.expanded-host')).toHaveCount(0);
  await expect(page.locator('.winamp-compact')).toBeVisible();
});

test('windowshade toggle expands compact strip to main window without full overlay', async ({ page }) => {
  await page.goto('/');
  await waitForWebampReady(page);
  const shadeToggle = page.locator('[title="Toggle Windowshade Mode"]').first();
  await expect(shadeToggle).toBeVisible();
  const initialHeight = await page.evaluate(
    () => document.querySelector('#main-window')?.closest('.window')?.getBoundingClientRect().height ?? 0
  );

  await shadeToggle.click();
  await expect(page.locator('.winamp-compact.expanded-host')).toHaveCount(0);
  await expect
    .poll(async () => {
      return page.evaluate(
        () =>
          document.querySelector('#main-window')?.closest('.window')?.getBoundingClientRect().height ?? 0
      );
    })
    .not.toBe(initialHeight);

  await shadeToggle.click();
  const toggledHeight = await page.evaluate(
    () => document.querySelector('#main-window')?.closest('.window')?.getBoundingClientRect().height ?? 0
  );
  await expect
    .poll(async () => {
      return page.evaluate(
        () =>
          document.querySelector('#main-window')?.closest('.window')?.getBoundingClientRect().height ?? 0
      );
    })
    .not.toBe(toggledHeight);
});

test('expanded mode keeps station list clickable', async ({ page }) => {
  await page.goto('/');
  await openFullscreenPlayer(page);

  const targetRow = page
    .locator('.station-table.compact .station-row')
    .filter({ hasText: 'Berlin Pulse' })
    .first();
  await targetRow.getByRole('button', { name: 'Play' }).click();
  await expect(targetRow.getByRole('button', { name: 'Pause' })).toBeVisible();
});

test('fullscreen windows can be repositioned', async ({ page }) => {
  await page.goto('/');
  await openFullscreenPlayer(page);
  await page.waitForTimeout(220);

  const before = await getWebampWindowRect(page, 'main-window');
  expect(before).not.toBeNull();

  await dragWebampWindow(page, 'main-window', 120, 70);

  await expect
    .poll(async () => getWebampWindowRect(page, 'main-window'))
    .toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number)
    });

  await expect
    .poll(async () => {
      const rect = await getWebampWindowRect(page, 'main-window');
      if (!rect || !before) return { dx: 0, dy: 0 };
      return {
        dx: Math.abs(rect.x - before.x),
        dy: Math.abs(rect.y - before.y)
      };
    })
    .toEqual({ dx: expect.any(Number), dy: expect.any(Number) });

  const after = await getWebampWindowRect(page, 'main-window');
  expect(after).not.toBeNull();
  expect(Math.abs(after!.x - before!.x)).toBeGreaterThanOrEqual(80);
  expect(Math.abs(after!.y - before!.y)).toBeGreaterThanOrEqual(4);
});

test('desktop fullscreen exposes reset layout control', async ({ page }) => {
  await page.goto('/');
  await openFullscreenPlayer(page);
  await expect(page.getByRole('button', { name: 'Reset layout' })).toBeVisible();
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

  expect(compactBox).not.toBeNull();
  expect(navBox).not.toBeNull();
  expect(compactBox!.height).toBeGreaterThanOrEqual(40);
  expect(compactBox!.y + compactBox!.height).toBeLessThanOrEqual(navBox!.y - 4);
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

test('skin preset change persists in localStorage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByPlaceholder('Search skins.webamp.org').fill('bebop');
  await expect(page.getByRole('listitem')).toContainText('cowboy_bebop.wsz');
  await page.getByRole('button', { name: 'Apply' }).click();
  const stored = await page.evaluate(() => localStorage.getItem('radio:winamp-skin'));
  expect(stored).toContain('museum');
  expect(stored).toContain('f8a6e3e5c1e12f120d6c2b4cbb374b4b');
});

test('skin museum selection restores after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByPlaceholder('Search skins.webamp.org').fill('bebop');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.skin-picker-current')).toHaveText('cowboy_bebop.wsz');

  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('.skin-picker-current')).toHaveText('cowboy_bebop.wsz');
});

test('share action always displays toast', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).first().click();
  await openFullscreenPlayer(page);
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.locator('.toast')).toBeVisible();
  await expect(page.locator('.toast')).toContainText(/Share|Link/);
});

test('track line shows track title only and supports copy click', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).first().click();

  const trackLine = page.locator('.winamp-trackline.compact');
  await expect(trackLine).toBeVisible();
  await expect(trackLine).toContainText('Mock Song');
  await expect(trackLine).not.toContainText('Tokyo FM');
  await page.waitForTimeout(200);
  await trackLine.dispatchEvent('click');
  await expect(page.locator('.toast')).toContainText('Track copied');
});

test('webamp next button follows radio random navigation in fullscreen', async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.4;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).first().click();
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

test('webamp previous button follows radio history in fullscreen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).first().click();
  await page.getByRole('button', { name: 'Play' }).nth(1).click();
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
  await page.getByRole('button', { name: 'Play' }).first().click();
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

test('webamp equalizer updates the real player EQ state', async ({ page }) => {
  await page.goto('/');
  await waitForWebampReady(page);
  await page.getByRole('button', { name: 'Play' }).first().click();
  await openFullscreenPlayer(page);

  await setWebampEqHandleOffset(page, 'preamp', 0);
  await setWebampEqHandleOffset(page, 'band-600', 0);

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
  await page.goto('/');
  await waitForWebampReady(page);
  await page.getByRole('button', { name: 'Play' }).first().click();
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
});
