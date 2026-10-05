import { expect, test, type Page } from '@playwright/test';
import { ACCOUNT_FIXTURE_API_BASE, encodeGoogleFixtureCredential } from './authFixture';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

const ids = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('radio:library:v2') || '{}').collections || []).find((item: { id: string }) => item.id === 'cross-device')?.stationIds as string[] | undefined);
const transport = (page: Page) => page.evaluate(() => ({ queue: JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue, src: document.querySelector('audio')?.getAttribute('src'), state: document.querySelector('audio')?.getAttribute('data-ra-state') }));

for (const staleWrite of [false, true]) {
  test(`two isolated devices ${staleWrite ? 'reconcile concurrent additions in one playlist' : 'pull a phone playlist change on desktop return'}`, async ({ browser, request }) => {
    const signIn = await request.post(`${ACCOUNT_FIXTURE_API_BASE}/auth/google`, { data: { credential: encodeGoogleFixtureCredential({ sub: `cross-${Date.now()}-${staleWrite}`, name: 'Cross Device' }) } });
    expect(signIn.ok()).toBe(true);
    const session = await signIn.json() as { token: string };
    const headers = { Authorization: `Bearer ${session.token}` };
    const collection = { id: 'cross-device', name: 'My shared mix', description: null, stationIds: [stations[0].stationuuid], isPublic: false, pinned: false, createdAt: 1, updatedAt: 1 };
    const initial = await request.put(`${ACCOUNT_FIXTURE_API_BASE}/me/library`, { headers, data: { favorites: stations.slice(0, 4), collections: [collection] } });
    expect(initial.status(), initial.ok() ? '' : await initial.text()).toBe(200);
    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const phone = await phoneContext.newPage();
      const desktop = await desktopContext.newPage();
      const libraryWrites: number[] = [];
      for (const page of [phone, desktop]) {
        page.on('response', response => { if (response.url().endsWith('/me/library')) libraryWrites.push(response.status()); });
        await mockStations(page);
        await installMediaMocks(page);
        await seedRadioState(page, { activeSection: 'library', stationCache: stations, queue: stations.slice(0, 3), seedOnlyIfAbsent: true });
        await page.addInitScript(({ token, api }) => { localStorage.setItem('radio:session:v1', token); localStorage.setItem('radio:api-url', api); }, { token: session.token, api: ACCOUNT_FIXTURE_API_BASE });
        await page.goto('/?calm=1');
        await expect.poll(() => ids(page)).toEqual([stations[0].stationuuid]);
        await page.getByRole('button', { name: 'Открыть: My shared mix', exact: true }).click();
      }
      const before = await transport(desktop);
      const add = async (page: Page, choices: typeof stations) => {
        await page.locator('.library-detail-add-stations').click();
        const dialog = page.getByRole('dialog', { name: 'My shared mix' });
        for (const station of choices) await dialog.getByRole('button', { name: `Добавить «${station.name}» в плейлист`, exact: true }).click();
        await dialog.getByRole('button', { name: 'Готово', exact: true }).click();
      };
      const serverIds = async () => {
        const response = await request.get(`${ACCOUNT_FIXTURE_API_BASE}/me`, { headers });
        expect(response.ok()).toBe(true);
        const data = await response.json();
        return data.profile.library.collections[0].stationIds as string[];
      };
      await add(phone, stations.slice(1, 3));
      await expect.poll(async () => (await serverIds()).slice().sort()).toEqual(stations.slice(0, 3).map(station => station.stationuuid).sort());
      // Desktop was already open with the old playlist, so this tests a pull
      // or stale write, not signing in again against a newer cloud snapshot.
      expect(await ids(desktop)).toEqual([stations[0].stationuuid]);
      if (staleWrite) {
        const conflicts: number[] = [];
        desktop.on('response', response => { if (response.url().endsWith('/me/library')) conflicts.push(response.status()); });
        await add(desktop, [stations[3]]);
        const allIds = stations.slice(0, 4).map(station => station.stationuuid).sort();
        await expect.poll(async () => (await serverIds()).slice().sort()).toEqual(allIds);
        await expect.poll(async () => (await ids(desktop))?.slice().sort()).toEqual(allIds);
        expect(conflicts).toContain(409);
        await phone.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect.poll(async () => (await ids(phone))?.slice().sort()).toEqual(allIds);
      } else {
        await desktop.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect.poll(async () => (await ids(desktop))?.slice().sort()).toEqual(stations.slice(0, 3).map(station => station.stationuuid).sort());
        await expect(desktop.locator('.library-detail-station-list')).toContainText(stations[2].name);
      }
      expect(await transport(desktop)).toEqual(before);
      expect(libraryWrites.length, `Unexpected library write burst: ${libraryWrites.join(',')}`).toBeLessThanOrEqual(12);
    } finally {
      await phoneContext.close();
      await desktopContext.close();
    }
  });
}
