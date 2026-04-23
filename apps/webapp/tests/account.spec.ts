import { expect, test, type Page } from '@playwright/test';
import { ACCOUNT_FIXTURE_API_BASE, installGoogleAuthFixture } from './authFixture';
import {
  applyConflictSession,
  openConflictPreview,
  seedConflictFixture,
  type ConflictMergeStrategy,
  type ConflictSeed
} from './accountConflictFixture';
import { installMediaMocks, mockStations } from './helpers';

const assertBaseConflictPreview = async (page: Page, seeded: ConflictSeed, strategyLabel: string) => {
  await expect(page.locator('.account-sheet-panel')).toBeVisible();

  const previewCard = page.locator('.account-provider-card', {
    has: page.getByText('Подтверждение объединения')
  });

  await expect(previewCard).toBeVisible();
  await expect(previewCard).toContainText('Текущий профиль');
  await expect(previewCard).toContainText('Входящий профиль');
  await expect(previewCard).toContainText('После объединения');

  const previewText = await previewCard.textContent();
  expect(previewText).toContain(`Избранное: ${seeded.currentCounts.favorites}`);
  expect(previewText).toContain(`Недавнее: ${seeded.currentCounts.recent}`);
  expect(previewText).toContain(`История: ${seeded.currentCounts.trackHistory}`);
  expect(previewText).toContain(`Избранное: ${seeded.incomingCounts.favorites}`);
  expect(previewText).toContain(`Недавнее: ${seeded.incomingCounts.recent}`);
  expect(previewText).toContain(`История: ${seeded.incomingCounts.trackHistory}`);
  expect(previewText).toContain(strategyLabel);
};

const expectLinkedGoogleProvider = async (page: Page) => {
  await expect(page.locator('.account-sheet-panel')).toHaveCount(0);
  await page.locator('.app-topbar-primary-cta').click();
  await expect(page.locator('.account-sheet-panel')).toBeVisible();
  await expect(
    page.locator('.account-provider-card').filter({ has: page.getByText('Google') }).first()
  ).toContainText('Подключено как: fixture-incoming-');
};

const runConflictScenario = async (
  page: Page,
  seeded: ConflictSeed,
  strategy: ConflictMergeStrategy,
  strategyLabel: string,
  expectedResult: { favorites: number; recent: number; trackHistory: number }
) => {
  await applyConflictSession(page, seeded, ACCOUNT_FIXTURE_API_BASE);
  await openConflictPreview(page, strategyLabel);
  await assertBaseConflictPreview(page, seeded, strategyLabel);

  const previewCard = page.locator('.account-provider-card', {
    has: page.getByText('Подтверждение объединения')
  });
  await expect(previewCard).toContainText(`Избранное: ${expectedResult.favorites}`);
  await expect(previewCard).toContainText(`Недавнее: ${expectedResult.recent}`);
  await expect(previewCard).toContainText(`История: ${expectedResult.trackHistory}`);

  if (strategy === 'combine') {
    await expect(previewCard).toContainText('Изменение +1');
  }

  await page.getByRole('button', { name: 'Подтвердить объединение' }).click();
  await expectLinkedGoogleProvider(page);
};

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await installGoogleAuthFixture(page);
  await mockStations(page, {
    authProviders: {
      google: true
    }
  });
});

test('account sheet raises a real conflict preview before linking a provider with prefer-incoming', async ({ page, request }) => {
  const seeded = await seedConflictFixture(request, ACCOUNT_FIXTURE_API_BASE, 'prefer-incoming');
  await runConflictScenario(page, seeded, 'prefer-incoming', 'Взять входящее', {
    favorites: seeded.incomingCounts.favorites,
    recent: seeded.incomingCounts.recent,
    trackHistory: seeded.incomingCounts.trackHistory
  });
});

test('account sheet shows union counts for combine before confirming merge', async ({ page, request }) => {
  const seeded = await seedConflictFixture(request, ACCOUNT_FIXTURE_API_BASE, 'combine');
  await runConflictScenario(page, seeded, 'combine', 'Объединять', {
    favorites: seeded.currentCounts.favorites + seeded.incomingCounts.favorites,
    recent: seeded.currentCounts.recent + seeded.incomingCounts.recent,
    trackHistory: seeded.currentCounts.trackHistory + seeded.incomingCounts.trackHistory
  });
});
