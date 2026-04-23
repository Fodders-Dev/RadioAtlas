import type { Page } from '@playwright/test';
import {
  ACCOUNT_FIXTURE_API_BASE,
  encodeGoogleFixtureCredential,
  primeAuthFixturePage
} from './authFixture';

export const createSharedGoogleCredential = (seed: string) =>
  encodeGoogleFixtureCredential({
    sub: `listener-${seed}`,
    name: 'Shared Listener',
    email: `listener-${seed}@example.com`,
    email_verified: true
  });

export const prepareSharedGooglePage = async (
  page: Page,
  credential: string,
  apiBase = ACCOUNT_FIXTURE_API_BASE
) => {
  await primeAuthFixturePage(page, {
    apiBase,
    googleCredential: credential
  });
};

export const signInThroughOnboarding = async (
  page: Page,
  apiBase = ACCOUNT_FIXTURE_API_BASE
) => {
  await page.goto(`/?api=${encodeURIComponent(apiBase)}`);
  await page.locator('.app-topbar-primary-cta').click();
  await page.locator('.account-sheet-panel').waitFor({ state: 'visible' });
  await page.locator('.google-fixture-btn').click();
};
