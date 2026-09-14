import { afterEach, describe, expect, it, vi } from 'vitest';

// Which shell a listener gets. The contract since 14.09.2026: the production
// build opens the A4 «Журнал» shell unless the address says `?calm=0` or
// `?classic=1`; the dev server and this harness keep the classic shell as
// the default and enter the new one only through `?calm=1`.
const load = async (search: string, prod: boolean) => {
  vi.resetModules();
  vi.stubEnv('PROD', prod);
  window.history.replaceState(null, '', `/${search}`);
  const module = await import('./calmPreview');
  return module.CALM_PREVIEW;
};

describe('CALM_PREVIEW', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState(null, '', '/');
  });

  it('is the default on the production build', async () => {
    expect(await load('', true)).toBe(true);
  });

  it('yields to the classic shell on ?calm=0 and ?classic=1 in production', async () => {
    // Mutation this answers: dropping the opt-out would leave a listener
    // no address for the old shell at all.
    expect(await load('?calm=0', true)).toBe(false);
    expect(await load('?classic=1', true)).toBe(false);
  });

  it('stays off by default outside production and on with ?calm=1', async () => {
    expect(await load('', false)).toBe(false);
    expect(await load('?calm=1', false)).toBe(true);
  });
});
