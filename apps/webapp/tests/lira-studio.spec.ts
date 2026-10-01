import { expect, test } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations, waitForAnimationsToSettle } from './helpers';

for (const size of [{ width: 320, height: 740 }, { width: 390, height: 844 },
  { width: 834, height: 1112 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
  test(`Lira studio offers explicit questions without changing transport at ${size.width}`, async ({ page }) => {
    await page.setViewportSize(size);
    await mockStations(page);
    await installMediaMocks(page);
    await seedRadioState(page, { queue: stations.slice(0, 3), queueCurrentIndex: 0, queueSourceId: 'favorites',
      queueSourceLabel: 'Избранное', stationCache: stations.slice(0, 3) });
    const posted: Array<{ message: string; nowPlaying?: { stationUuid?: string } }> = [];
    await page.route('**/ai/chat**', async route => {
      posted.push(route.request().postDataJSON());
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        reply: 'Предложение по выбранному источнику, без запуска.', stations: [], actions: [], sources: [], serviceLinks: []
      }) });
    });
    await page.goto('/?calm=1');
    const nav = page.locator(size.width < 900 ? '.app-navigation-mobile' : '.app-navigation-desktop');
    const snapshot = () => page.evaluate(() => {
      const audio = document.querySelector('audio');
      return { src: audio?.getAttribute('src') || null, paused: audio?.paused ?? true,
        queue: JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue };
    });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('radio:player:v2') || '{}').queue?.items?.length)).toBe(3);
    await nav.getByRole('button', { name: 'Лента', exact: true }).click();
    // A restored paused source need not have an attached stream yet. Start
    // through the real Feed control, then snapshot settled playback; tablet
    // also covers an explicitly paused attached source.
    const feedPlay = page.locator('.station-feed-card-content[data-focus="true"] [data-feed-action="play"]');
    await feedPlay.click();
    await expect(feedPlay).toHaveClass(/is-playing/);
    await expect(page.locator('audio')).toHaveAttribute('src', stations[0].url_resolved);
    await expect(page.locator('.station-feed-card-content[data-focus="true"] .calm-slide-track strong')).toHaveText('Mock Song');
    if (size.width === 834) {
      await feedPlay.click();
      await expect(feedPlay).not.toHaveClass(/is-playing/);
    }
    const before = await snapshot();
    await page.locator('.station-feed-card-content[data-focus="true"] [data-feed-action="lira"]').click();
    const chat = page.locator('[data-chat-sheet]');
    const questions = chat.locator('[data-chat-prompts]');
    await expect(questions.getByRole('button')).toHaveCount(4);
    expect(posted).toHaveLength(0);
    expect(await snapshot()).toEqual(before);
    await expect(chat.locator('[data-chat-opening-card]').first()).toHaveAttribute('data-chat-opening-card', stations[0].stationuuid);
    await waitForAnimationsToSettle(page, '[data-chat-sheet]');
    for (const button of await questions.getByRole('button').all()) {
      const box = await button.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
      const art = await button.locator('.lira-studio-art').boundingBox();
      const label = await button.locator('.lira-studio-label').boundingBox();
      expect(art!.y + art!.height + 7).toBeLessThanOrEqual(label!.y);
    }
    const filledWidth = await chat.locator('.chat-sheet-thread').evaluate(el => {
      const style = getComputedStyle(el);
      const available = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return { available, actual: el.querySelector('.chat-welcome')!.getBoundingClientRect().width };
    });
    expect(Math.abs(filledWidth.actual - filledWidth.available)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(chat.getByRole('textbox')).toBeVisible();
    await page.screenshot({ path: `../../output/lira-studio-${size.width}.png` });

    // A known track adds a third context prompt, and the existing picker
    // rotates two of those. Exercise the station question visible in this
    // settled session; the foreign query remains covered in source-entry.
    const stationQuestion = questions.getByRole('button', { name: 'Что за станция?', exact: true });
    await chat.getByRole('textbox').fill('Мой ещё не отправленный вопрос');
    await stationQuestion.focus();
    await stationQuestion.press('Enter');
    await expect(chat.locator('.chat-row--assistant')).toContainText('Предложение по выбранному источнику');
    await expect(chat.getByRole('textbox')).toBeFocused();
    await expect(chat.getByRole('textbox')).toHaveValue('Мой ещё не отправленный вопрос');
    expect(posted).toHaveLength(1);
    expect(posted[0].message).toContain(stations[0].name);
    expect(posted[0].nowPlaying?.stationUuid).toBe(stations[0].stationuuid);
    expect(await snapshot()).toEqual(before);
    await expect(chat.locator('[data-chat-opening]')).toHaveCount(0);
    await expect(chat.locator('.chat-prompts-row')).toBeVisible();
    await nav.getByRole('button', { name: 'Главная', exact: true }).click();
    await expect(chat).toHaveCount(0);
    expect(await snapshot()).toEqual(before);
    await nav.getByRole('button', { name: 'Лира', exact: true }).click();
    await expect(chat.locator('.chat-row--assistant')).toContainText('Предложение по выбранному источнику');
    expect(posted).toHaveLength(1);
  });
}

for (const width of [390, 1440]) {
  test(`Lira studio keeps its illustrated actions in dark reduced-motion mode at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockStations(page);
    await installMediaMocks(page);
    await seedRadioState(page);
    await page.addInitScript(() => localStorage.setItem('radio:theme-current:v1', JSON.stringify('aurora-field')));
    let requests = 0;
    await page.route('**/ai/chat**', route => { requests++; return route.abort(); });
    await page.goto('/?calm=1');
    await expect(page.locator('html')).toHaveAttribute('data-theme-mode', 'dark');
    const nav = page.locator(width < 900 ? '.app-navigation-mobile' : '.app-navigation-desktop');
    await nav.getByRole('button', { name: 'Лира', exact: true }).click();
    const studio = page.locator('.lira-studio');
    await expect(studio.getByRole('button').first()).toBeVisible();
    const styles = await studio.locator('.lira-studio-prompt').evaluateAll(buttons => buttons.map(el => {
      const style = getComputedStyle(el);
      return { color: style.color, transition: style.transitionDuration };
    }));
    expect(styles).toHaveLength(4);
    for (const style of styles) {
      expect(style.color).toBe('rgb(244, 234, 216)');
      expect(style.transition).toBe('0s');
    }
    expect(requests).toBe(0);
    await waitForAnimationsToSettle(page, '[data-chat-sheet]');
    await page.screenshot({ path: `../../output/lira-studio-dark-${width}.png` });
  });
}
