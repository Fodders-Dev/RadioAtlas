import { expect, test } from '@playwright/test';
import { ACCOUNT_FIXTURE_API_BASE, installGoogleAuthFixture } from './authFixture';
import { createSharedGoogleCredential, prepareSharedGooglePage, signInThroughOnboarding } from './accountSessionFixture';
import { installMediaMocks, mockStations } from './helpers';

test('favorites sync to another logged-in device right after like', async ({ page, browser }) => {
  const credential = createSharedGoogleCredential(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const stationName = 'Tokyo FM';

  await installMediaMocks(page);
  await installGoogleAuthFixture(page);
  await mockStations(page);
  await prepareSharedGooglePage(page, credential);

  await signInThroughOnboarding(page, ACCOUNT_FIXTURE_API_BASE);
  await expect(page.locator('.account-card .account-pill.authenticated')).toContainText('В облаке');

  const cloudSyncResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/me/library') &&
      response.request().method() === 'PUT' &&
      response.status() === 200
  );

  await page
    .locator('.station-row')
    .filter({ hasText: stationName })
    .first()
    .locator('.station-fav-btn')
    .click();
  await cloudSyncResponse;
  await expect(page.locator('.account-card .globe-selection-pill').filter({ hasText: 'Избранное' })).toContainText('1');

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();

  await installMediaMocks(secondPage);
  await installGoogleAuthFixture(secondPage);
  await mockStations(secondPage);
  await prepareSharedGooglePage(secondPage, credential);

  await signInThroughOnboarding(secondPage, ACCOUNT_FIXTURE_API_BASE);
  await expect(secondPage.locator('.account-card .account-pill.authenticated')).toContainText('В облаке');
  await expect(
    secondPage.locator('.account-card .globe-selection-pill').filter({ hasText: 'Избранное' })
  ).toContainText('1');

  await secondPage.locator('.account-card').getByRole('button', { name: 'Открыть медиатеку' }).click();
  await expect(secondPage.locator('.app-shell-v2')).toHaveAttribute('data-active-section', 'library');
  await expect(secondPage.locator('.screen-library-v2')).toContainText(stationName);

  await secondContext.close();
});
