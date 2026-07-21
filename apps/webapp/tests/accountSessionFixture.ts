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
  const accountCta = page
    .locator('.app-topbar-primary-cta, button:has-text("Войти"), button:has-text("Аккаунт")')
    .first();
  await accountCta.waitFor({ state: 'visible' });
  // The CTA is painted before React has finished hydrating the shell, and this
  // is a FORCED click — so it bypasses actionability checks and can land on a
  // button with no handler attached yet, silently doing nothing. The fixture
  // then waited forever for a sheet that was never asked to open. Retry the
  // click, but only after genuinely waiting for the panel each time, so a click
  // that DID work is never followed by a second one that would toggle it shut.
  const panel = page.locator('.account-sheet-panel');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await accountCta.click({ force: true });
    try {
      await panel.waitFor({ state: 'visible', timeout: 5_000 });
      break;
    } catch {
      if (attempt === 2) throw new Error('account sheet did not open after 3 attempts');
    }
  }
  await panel.waitFor({ state: 'visible' });
  const googleFixtureButton = page.locator('.google-fixture-btn');
  await googleFixtureButton.waitFor({ state: 'visible' });
  await googleFixtureButton.click();
};
