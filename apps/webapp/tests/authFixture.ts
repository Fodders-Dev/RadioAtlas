import type { Page } from '@playwright/test';

export const ACCOUNT_FIXTURE_API_BASE = 'http://127.0.0.1:4311';

export const encodeGoogleFixtureCredential = (identity: {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
  email_verified?: boolean;
}) => `fixture-google:${Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url')}`;

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
                const credential =
                  (window as Window & { __radioGoogleFixtureCredential?: string }).__radioGoogleFixtureCredential || '';
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

export const primeAuthFixturePage = async (
  page: Page,
  options: {
    apiBase?: string;
    token?: string;
    googleCredential?: string;
  }
) => {
  const { apiBase = ACCOUNT_FIXTURE_API_BASE, token = '', googleCredential = '' } = options;

  await page.addInitScript(
    ({ resolvedApiBase, resolvedToken, resolvedCredential }) => {
      Object.defineProperty(window, 'Telegram', { configurable: true, value: undefined });
      localStorage.clear();
      localStorage.setItem('radio:api-url', resolvedApiBase);
      if (resolvedToken) {
        localStorage.setItem('radio:session:v1', resolvedToken);
      }
      Object.defineProperty(window, '__radioGoogleFixtureCredential', {
        configurable: true,
        value: resolvedCredential
      });
    },
    {
      resolvedApiBase: apiBase,
      resolvedToken: token,
      resolvedCredential: googleCredential
    }
  );
};
