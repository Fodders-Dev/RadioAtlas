import type { APIRequestContext, Page } from '@playwright/test';

export const ACCOUNT_FIXTURE_API_BASE = 'http://127.0.0.1:4311';

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

export const installGoogleAuthFixture = async (page: Page) => {
  await page.addInitScript(() => {
    let credentialCallback: ((response: { credential: string }) => void) | null = null;

    Object.defineProperty(window, '__radioTriggerGoogleFixture', {
      configurable: true,
      value: (credential: string) => {
        credentialCallback?.({ credential });
      }
    });

    Object.defineProperty(window, 'google', {
      configurable: true,
      value: {
        accounts: {
          id: {
            initialize: (config: { callback: (response: { credential: string }) => void }) => {
              credentialCallback = config.callback;
            },
            renderButton: (parent: HTMLElement) => {
              parent.innerHTML = '';
              const button = document.createElement('button');
              button.type = 'button';
              button.className = 'google-fixture-btn';
              button.textContent = 'Continue with Google';
              button.addEventListener('click', () => {
                const credential = (window as Window & { __radioGoogleFixtureCredential?: string }).__radioGoogleFixtureCredential || '';
                credentialCallback?.({ credential });
              });
              parent.appendChild(button);
            },
            prompt: () => {}
          }
        }
      }
    });
  });

  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.google = window.google || {};'
    })
  );
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
  await page.addInitScript(
    ({ token, incomingCredential, resolvedApiBase }) => {
      Object.defineProperty(window, 'Telegram', { configurable: true, value: undefined });
      localStorage.clear();
      localStorage.setItem('radio:session:v1', token);
      localStorage.setItem('radio:api-url', resolvedApiBase);
      Object.defineProperty(window, '__radioGoogleFixtureCredential', {
        configurable: true,
        value: incomingCredential
      });
    },
    {
      token: seeded.token,
      incomingCredential: seeded.incomingCredential,
      resolvedApiBase: apiBase
    }
  );
};

export const openConflictPreview = async (page: Page, mergeButtonLabel: string) => {
  await page.goto(`/?api=${encodeURIComponent(ACCOUNT_FIXTURE_API_BASE)}`);
  await page.getByRole('button', { name: 'Управлять' }).first().click();
  await page.getByRole('button', { name: mergeButtonLabel }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
};
