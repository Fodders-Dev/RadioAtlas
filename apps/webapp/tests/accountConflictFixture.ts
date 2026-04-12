import type { APIRequestContext, Page } from '@playwright/test';
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
  const response = await request.post(`${apiBase}/test/auth/seed-conflict`, {
    data: { mergeStrategy }
  });
  if (!response.ok()) {
    throw new Error(`seed conflict fixture failed (${response.status()})`);
  }
  return (await response.json()) as ConflictSeed;
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
  await page.getByRole('button', { name: 'Управлять' }).first().click();
  await page.getByRole('button', { name: mergeButtonLabel }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
};
