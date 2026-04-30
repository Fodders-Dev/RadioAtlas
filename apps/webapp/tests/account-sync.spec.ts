import { expect, test } from '@playwright/test';
import { ACCOUNT_FIXTURE_API_BASE, installGoogleAuthFixture } from './authFixture';
import { applyConflictSession, seedConflictFixture } from './accountConflictFixture';
import { createSharedGoogleCredential, prepareSharedGooglePage, signInThroughOnboarding } from './accountSessionFixture';
import { installMediaMocks, mockStations } from './helpers';

test('favorites sync to another logged-in device right after like', async ({ page, browser }) => {
  const credential = createSharedGoogleCredential(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const stationName = 'Tokyo FM';

  await installMediaMocks(page);
  await installGoogleAuthFixture(page);
  await mockStations(page, {
    authProviders: {
      google: true
    }
  });
  await prepareSharedGooglePage(page, credential);

  await signInThroughOnboarding(page, ACCOUNT_FIXTURE_API_BASE);
  await expect(page.locator('.app-topbar-primary-cta')).toContainText('Аккаунт');

  const cloudSyncResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/me/library') &&
      response.request().method() === 'PUT' &&
      response.status() === 200
  );

  await page.getByRole('button', { name: 'Поиск' }).first().click();
  await expect(page.locator('.search-command-card')).toBeVisible();
  await page.locator('.search-bar input').first().fill(stationName);
  const stationRow = page.locator('.station-row').filter({ hasText: stationName }).first();
  await expect(stationRow).toBeVisible();
  await stationRow.getByRole('button', { name: 'В лайки' }).click();
  await cloudSyncResponse;

  await page.getByRole('button', { name: 'Медиатека' }).first().click();
  await expect(page.locator('.screen-library-v2')).toContainText(stationName);

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();

  await installMediaMocks(secondPage);
  await installGoogleAuthFixture(secondPage);
  await mockStations(secondPage, {
    authProviders: {
      google: true
    }
  });
  await prepareSharedGooglePage(secondPage, credential);

  await signInThroughOnboarding(secondPage, ACCOUNT_FIXTURE_API_BASE);
  await expect(secondPage.locator('.app-topbar-primary-cta')).toContainText('Аккаунт');

  await secondPage.getByRole('button', { name: 'Медиатека' }).first().click();
  await expect(secondPage.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'library');
  await expect(secondPage.locator('.screen-library-v2')).toContainText(stationName);

  await secondContext.close();
});

test('logged-in playback bursts coalesce cloud library sync writes', async ({ page, request }) => {
  const syncBodies: string[] = [];

  await installMediaMocks(page);
  await installGoogleAuthFixture(page);
  await mockStations(page, {
    authProviders: {
      google: true
    }
  });
  const seeded = await seedConflictFixture(request, ACCOUNT_FIXTURE_API_BASE, 'combine');
  await applyConflictSession(page, seeded, ACCOUNT_FIXTURE_API_BASE);

  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/me/library')) {
      syncBodies.push(request.postData() || '');
    }
  });

  await page.goto(`/?api=${encodeURIComponent(ACCOUNT_FIXTURE_API_BASE)}`);
  await expect(page.locator('.app-topbar-primary-cta')).toContainText('Аккаунт');

  await page.getByRole('button', { name: 'Поиск' }).first().click();
  await expect(page.locator('.search-command-card')).toBeVisible();
  await page.locator('.search-bar input').first().fill('o');

  const playStation = async (name: string) => {
    const stationRow = page.locator('.station-row').filter({ hasText: name }).first();
    await expect(stationRow).toBeVisible();
    await stationRow.locator('.play-btn').click();
    await page.waitForTimeout(150);
  };

  await playStation('Tokyo FM');
  await playStation('Osaka Nights');
  await playStation('Kyoto Groove');

  await expect.poll(() => syncBodies.length, { timeout: 5000 }).toBe(1);
  await page.waitForTimeout(1800);
  await expect(page.locator('.player-dock-title')).toContainText('Kyoto Groove');
  expect(syncBodies).toHaveLength(1);
  const syncedLibrary = JSON.parse(syncBodies[0]) as {
    tasteProfile?: { signals?: Array<{ stationId: string }> };
  };
  expect(syncedLibrary.tasteProfile?.signals?.length || 0).toBeGreaterThan(0);
  expect(syncedLibrary.tasteProfile?.signals?.some((signal) => signal.stationId === 'uuid-kyoto')).toBe(true);

  await page.getByRole('button', { name: 'Медиатека' }).first().click();
  await expect(page.locator('.screen-library-v2')).toBeVisible();
  await page.getByRole('button', { name: 'Поиск' }).first().click();
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'search');
});

test('logged-in navigation and visibility recovery stay responsive', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMediaMocks(page);
  await installGoogleAuthFixture(page);
  await mockStations(page, {
    authProviders: {
      google: true
    }
  });
  const seeded = await seedConflictFixture(request, ACCOUNT_FIXTURE_API_BASE, 'combine');
  await applyConflictSession(page, seeded, ACCOUNT_FIXTURE_API_BASE);

  await page.goto(`/?api=${encodeURIComponent(ACCOUNT_FIXTURE_API_BASE)}`);
  await expect(page.locator('.app-topbar-primary-cta')).toContainText('Аккаунт');

  await page.getByRole('button', { name: 'Медиатека' }).first().click();
  await expect(page.locator('.screen-library-v2')).toBeVisible();

  await page.getByRole('button', { name: 'Поиск' }).first().click();
  await expect(page.locator('.search-command-card')).toBeVisible();

  await page.locator('.search-bar input').first().fill('Tokyo');
  const stationRow = page.locator('.station-row').filter({ hasText: 'Tokyo FM' }).first();
  await expect(stationRow).toBeVisible();
  await stationRow.locator('.play-btn').click();
  await expect(page.locator('.player-dock-title')).toContainText('Tokyo FM');

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: false
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  await page.getByRole('button', { name: 'Глобус' }).first().click();
  await expect(page.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'globe');
  await expect(page.locator('.screen-globe-v2')).toBeVisible();
});
