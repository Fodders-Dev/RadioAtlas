import { expect, test, type Page } from '@playwright/test';
import { installMediaMocks, mockStations, seedRadioState, stations } from './helpers';

// PR (library batch / shuffle): the user can reshuffle the CURRENT queue, but
// this must NEVER change what is playing or restart playback — the hard
// never-auto-switch boundary (PR #86). shuffleQueue pins the playing item at
// its index, reorders only the rest, and persists via updateQueue ONLY (no
// play* call). These e2e tests pin that contract end-to-end through the real
// RadioContext, on a MULTI-ITEM queue.

// Records the src of every element that reaches the 'playing' state, so we can
// count how many DISTINCT fixture stations were actually started. A correct
// shuffle starts ZERO extra stations.
const installPlayProbe = async (page: Page) => {
  await page.addInitScript(() => {
    (window as unknown as { __playSrcs: string[] }).__playSrcs = [];
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      (window as unknown as { __playSrcs: string[] }).__playSrcs.push(
        this.src || this.currentSrc || ''
      );
      this.setAttribute('data-ra-state', 'playing');
      this.dispatchEvent(new Event('playing'));
      return Promise.resolve();
    };
  });
};

const STATION_SLUGS = stations.map((s) => s.url_resolved.split('/').pop() as string);

const distinctPlayedStations = (page: Page) =>
  page.evaluate((slugs) => {
    const srcs = (window as unknown as { __playSrcs: string[] }).__playSrcs;
    return slugs.filter((slug) => srcs.some((src) => src.includes(slug))).length;
  }, STATION_SLUGS);

// Reads the persisted queue snapshot from localStorage.
const readQueue = (page: Page) =>
  page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('radio:player:v2');
      const queue = raw ? JSON.parse(raw)?.queue : null;
      if (!queue) return null;
      return {
        order: (queue.items ?? []).map((item: { stationuuid: string }) => item.stationuuid),
        currentIndex: queue.currentIndex ?? -1,
        currentUuid: queue.items?.[queue.currentIndex]?.stationuuid ?? null,
        sourceId: queue.sourceId ?? null,
        sourceLabel: queue.sourceLabel ?? null
      };
    } catch {
      return null;
    }
  });

const playCurrent = async (page: Page) => {
  // The queue hero «Слушать» (declutter #146 renamed it from «Слушать текущую»).
  await page.locator('.library-queue-hero-play').click();
  await expect(page.locator('.player-dock-bar')).toBeVisible();
};

// «Перемешать следующие»: since 13.09 the chip reorders only the stations
// AHEAD of the playing one (docs/CLAUDE-UI-COMPLETION-PLAN-2026-09-13.md, Q-3).
const shuffleChip = (page: Page) =>
  page.getByRole('button', { name: /Перемешать следующие|Shuffle the upcoming/ });

type PendingQueueProbe = {
  blockedSlug: string;
  resolve: (() => void) | null;
};

test.beforeEach(async ({ page }) => {
  await installMediaMocks(page);
  await mockStations(page);
  await installPlayProbe(page);
  await page.setViewportSize({ width: 390, height: 844 });
  // Seed a multi-item queue and land directly on the Library "queue" tab.
  await seedRadioState(page, {
    activeSection: 'library',
    libraryTab: 'queue',
    queue: stations
  });
  await page.goto('/?api=/api');
  await expect(shuffleChip(page)).toBeVisible();
});

test('shuffle reorders the queue without changing or restarting what plays', async ({ page }) => {
  await playCurrent(page);
  // Exactly one station was ever started.
  expect(await distinctPlayedStations(page)).toBe(1);

  const before = await readQueue(page);
  expect(before).not.toBeNull();
  expect(before!.order.length).toBeGreaterThan(2); // a meaningful shuffle
  const playingUuid = before!.currentUuid;
  expect(playingUuid).not.toBeNull();

  await shuffleChip(page).click();

  // (feedback) the toast / aria-live announce fires on every tap.
  await expect(page.locator('.toast')).toContainText(/перемешан|shuffled/i);

  const after = await readQueue(page);
  expect(after).not.toBeNull();
  // (a) the playing station is unchanged AND still at the same index.
  expect(after!.currentUuid).toBe(playingUuid);
  expect(after!.currentIndex).toBe(before!.currentIndex);
  // (b) NO second distinct station was started — shuffle never called play*.
  expect(await distinctPlayedStations(page)).toBe(1);
  // (c) the queue source identity is carried through.
  expect(after!.sourceId).toBe(before!.sourceId);
  expect(after!.sourceLabel).toBe(before!.sourceLabel);
  // sanity: same member set, no station lost or duplicated.
  expect([...after!.order].sort()).toEqual([...before!.order].sort());
});

test('pending queue startup blocks order edits, then allows them after resolve', async ({ page }) => {
  await playCurrent(page);
  const target = stations[1];
  const targetSlug = target.url_resolved.split('/').pop() as string;
  const dragHandle = page
    .locator('[data-queue-row]')
    .filter({ hasText: stations[2].name })
    .locator('.library-queue-grip');
  await dragHandle.dispatchEvent('pointerdown', { pointerId: 41, clientY: 300, button: 0 });
  await expect(
    page.locator('[data-queue-row]').filter({ hasText: stations[2].name })
  ).toHaveClass(/dragging/);
  await page.evaluate((slug) => {
    const probe: PendingQueueProbe = { blockedSlug: slug, resolve: null };
    (window as unknown as { pendingQueueProbe: PendingQueueProbe }).pendingQueueProbe = probe;
    const fallbackPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (probe.blockedSlug && this.src.includes(probe.blockedSlug)) {
        this.setAttribute('data-ra-state', 'buffering');
        return new Promise<void>((resolve) => {
          probe.resolve = () => {
            this.setAttribute('data-ra-state', 'playing');
            this.dispatchEvent(new Event('playing'));
            resolve();
          };
        });
      }
      return fallbackPlay.call(this);
    };
  }, targetSlug);

  await page
    .locator('[data-queue-row]')
    .filter({ hasText: target.name })
    .getByRole('button', { name: /Слушать|Play/ })
    .click();
  await expect(page.locator('audio.audio-hidden')).toHaveAttribute('src', new RegExp(targetSlug));
  await expect(page.locator('audio.audio-hidden')).toHaveAttribute('data-ra-state', 'buffering');

  const blockedMove = page
    .locator('[data-queue-row]')
    .filter({ hasText: stations[2].name })
    .getByRole('button', { name: /Ниже|Move down/ });
  await expect(blockedMove).toBeDisabled();
  await expect(shuffleChip(page)).toBeDisabled();
  await expect(page.getByRole('button', { name: /Очистить очередь|Clear queue/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Сохранить как плейлист|Save as playlist/ })).toBeEnabled();
  await expect(page.locator('.library-queue-shell [role="status"]')).toContainText(/Дождитесь подключения|Wait for the current station/);
  await expect(dragHandle).toBeDisabled();
  await expect(
    page.locator('[data-queue-row]').filter({ hasText: stations[2].name })
  ).not.toHaveClass(/dragging/);
  await page.evaluate(() => {
    const probe = (window as unknown as { pendingQueueProbe: PendingQueueProbe }).pendingQueueProbe;
    if (!probe.resolve) throw new Error('pending queue play did not expose a resolver');
    probe.resolve();
    probe.resolve = null;
  });
  await expect
    .poll(async () => (await readQueue(page))?.currentUuid)
    .toBe(target.stationuuid);
  await expect(page.locator('.library-queue-shell [role="status"]')).toHaveCount(0);
  const resolvedMove = page
    .locator('[data-queue-row]')
    .filter({ hasText: stations[2].name })
    .getByRole('button', { name: /Ниже|Move down/ });
  await expect(resolvedMove).toBeEnabled();
  await resolvedMove.click();
  await expect.poll(async () => (await readQueue(page))?.order).toEqual([
    stations[0].stationuuid,
    stations[1].stationuuid,
    stations[3].stationuuid,
    stations[2].stationuuid,
    ...stations.slice(4).map((station) => station.stationuuid)
  ]);
});

test('the never-auto-switch guarantee (#86) holds on a SHUFFLED multi-item queue', async ({
  page
}) => {
  await playCurrent(page);
  expect(await distinctPlayedStations(page)).toBe(1);

  await shuffleChip(page).click();
  await expect(page.locator('.toast')).toContainText(/перемешан|shuffled/i);
  const afterShuffle = await readQueue(page);
  const indexAfterShuffle = afterShuffle!.currentIndex;
  const playingAfterShuffle = afterShuffle!.currentUuid;

  // Kill the live stream at runtime. With never-auto-switch the failure must NOT
  // advance the (now reshuffled) queue or jump to another station.
  await page.evaluate(() => {
    document.querySelectorAll('audio').forEach((audio) => {
      audio.dispatchEvent(new Event('error'));
    });
  });
  await page.waitForTimeout(900);

  // No SECOND distinct station was ever started...
  expect(await distinctPlayedStations(page)).toBe(1);
  const afterError = await readQueue(page);
  // ...and the cursor never moved off the (same) playing station.
  expect(afterError!.currentIndex).toBe(indexAfterShuffle);
  expect(afterError!.currentUuid).toBe(playingAfterShuffle);
  // The user is told the stream is unavailable (not silently skipped).
  await expect(page.locator('.toast')).toContainText(/недоступ|unavailable/i);
});
