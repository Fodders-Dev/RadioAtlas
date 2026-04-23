import { expect, test } from '@playwright/test';
import { ACCOUNT_FIXTURE_API_BASE, installGoogleAuthFixture } from './authFixture';
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
