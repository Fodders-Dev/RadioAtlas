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
  const panel = page.locator('.account-sheet-panel');
  await accountButton.click({ force: true });
  // The retry MUST wait for the panel first. `isVisible()` is a synchronous
  // snapshot, and React has not committed the sheet in the same tick as the
  // click — so the un-awaited check below always read `false`, fired a second
  // click, and TOGGLED THE SHEET BACK CLOSED. The subsequent waitFor then sat
  // on a panel that the fixture itself had just dismissed. Whether the race was
  // lost depended purely on how fast the entry graph mounted, which made this a
  // latent failure that any unrelated change to app startup could trigger.
  try {
    await panel.waitFor({ state: 'visible', timeout: 5_000 });
  } catch {
    await accountButton.click({ force: true });
  }
  await panel.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: mergeButtonLabel }).click();
  await page.locator('.google-fixture-btn').click();
};
