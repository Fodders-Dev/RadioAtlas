import { expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  ACCOUNT_FIXTURE_API_BASE,
  installGoogleAuthFixture,
  primeAuthFixturePage
} from './authFixture';

export type ConflictMergeStrategy = 'combine' | 'prefer-current' | 'prefer-incoming';

export type ConflictSeed = {
  token: string;
  incomingCredential: string;
  mergeStrategy: ConflictMergeStrategy;
  currentCounts: {
    favorites: number;
    recent: number;
    trackHistory: number;
  };
  incomingCounts: {
    favorites: number;
    recent: number;
    trackHistory: number;
  };
};

export const seedConflictFixture = async (
  request: APIRequestContext,
  apiBase: string,
  mergeStrategy: ConflictMergeStrategy = 'combine'
) => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await request.post(`${apiBase}/test/auth/seed-conflict`, {
        data: { mergeStrategy }
      });
      if (!response.ok()) {
        throw new Error(`seed conflict fixture failed (${response.status()})`);
      }
      return (await response.json()) as ConflictSeed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error('seed conflict fixture failed');
};

export const applyConflictSession = async (
  page: Page,
  seeded: ConflictSeed,
  apiBase = ACCOUNT_FIXTURE_API_BASE
) => {
  await primeAuthFixturePage(page, {
    apiBase,
    token: seeded.token,
    googleCredential: seeded.incomingCredential
  });
};

export const openConflictPreview = async (page: Page, mergeButtonLabel: string) => {
  await page.goto(`/?api=${encodeURIComponent(ACCOUNT_FIXTURE_API_BASE)}`);
  const accountButton = page.locator('.app-topbar-primary-cta');
  await accountButton.waitFor({ state: 'visible' });
  await expect(accountButton).toHaveAttribute('aria-label', /Аккаунт/);
  await expect(accountButton).toHaveClass(/is-live/);
  await accountButton.click({ force: true });
  if (!(await page.locator('.account-sheet-panel').isVisible().catch(() => false))) {
    await accountButton.click({ force: true });
  }
  await page.locator('.account-sheet-panel').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: mergeButtonLabel }).click();
  await page.locator('.google-fixture-btn').click();
};
