import { describe, expect, it } from 'vitest';
import { setupTelegramViewport, type TelegramViewportDeps } from './useTelegramViewport';

// A fake :root whose style.setProperty records into a Map we can assert on.
const makeRoot = () => {
  const vars = new Map<string, string>();
  return {
    vars,
    style: { setProperty: (name: string, value: string) => vars.set(name, value) }
  } as { vars: Map<string, string>; style: { setProperty: (n: string, v: string) => void } };
};

// A fake Telegram WebApp with an onEvent/offEvent registry we can fire manually.
const makeWebApp = (initial: Record<string, unknown>) => {
  const handlers = new Map<string, Set<() => void>>();
  return {
    ...initial,
    onEvent: (event: string, cb: () => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(cb);
    },
    offEvent: (event: string, cb: () => void) => {
      handlers.get(event)?.delete(cb);
    },
    fire: (event: string) => handlers.get(event)?.forEach((cb) => cb()),
    handlerCount: (event: string) => handlers.get(event)?.size ?? 0
  };
};

const makeWin = (
  opts: { innerHeight?: number; visualViewportHeight?: number } = {}
) => {
  const winHandlers = new Map<string, Set<() => void>>();
  const vvHandlers = new Map<string, Set<() => void>>();
  const reg = (map: Map<string, Set<() => void>>) => ({
    addEventListener: (event: string, cb: () => void) => {
      if (!map.has(event)) map.set(event, new Set());
      map.get(event)!.add(cb);
    },
    removeEventListener: (event: string, cb: () => void) => {
      map.get(event)?.delete(cb);
    }
  });
  const visualViewport =
    opts.visualViewportHeight === undefined
      ? null
      : { height: opts.visualViewportHeight, ...reg(vvHandlers) };
  return {
    innerHeight: opts.innerHeight ?? 0,
    visualViewport,
    ...reg(winHandlers),
    fireWin: (event: string) => winHandlers.get(event)?.forEach((cb) => cb()),
    fireVv: (event: string) => vvHandlers.get(event)?.forEach((cb) => cb()),
    winHandlerCount: (event: string) => winHandlers.get(event)?.size ?? 0,
    vvHandlerCount: (event: string) => vvHandlers.get(event)?.size ?? 0
  };
};

describe('setupTelegramViewport — inside Telegram', () => {
  it('writes viewport + safe-area vars on setup', () => {
    const root = makeRoot();
    const webApp = makeWebApp({
      viewportHeight: 640,
      viewportStableHeight: 600,
      safeAreaInset: { top: 44, bottom: 34, left: 0, right: 0 },
      contentSafeAreaInset: { top: 56, bottom: 0, left: 0, right: 0 }
    });
    setupTelegramViewport({ webApp, win: makeWin(), root } as unknown as TelegramViewportDeps);

    expect(root.vars.get('--tg-viewport-height')).toBe('640px');
    expect(root.vars.get('--tg-viewport-stable-height')).toBe('600px');
    expect(root.vars.get('--tg-safe-top')).toBe('44px');
    expect(root.vars.get('--tg-safe-bottom')).toBe('34px');
    expect(root.vars.get('--tg-content-safe-top')).toBe('56px');
  });

  it('updates the stable height on viewportChanged', () => {
    const root = makeRoot();
    const webApp = makeWebApp({ viewportHeight: 640, viewportStableHeight: 600 });
    setupTelegramViewport({ webApp, win: makeWin(), root } as unknown as TelegramViewportDeps);
    expect(root.vars.get('--tg-viewport-stable-height')).toBe('600px');

    // Telegram header collapses → stable height grows; the event re-reads it.
    (webApp as Record<string, unknown>).viewportStableHeight = 720;
    webApp.fire('viewportChanged');
    expect(root.vars.get('--tg-viewport-stable-height')).toBe('720px');
  });

  it('updates insets on safeAreaChanged / contentSafeAreaChanged', () => {
    const root = makeRoot();
    const webApp = makeWebApp({
      safeAreaInset: { top: 0, bottom: 0 },
      contentSafeAreaInset: { top: 0, bottom: 0 }
    });
    setupTelegramViewport({ webApp, win: makeWin(), root } as unknown as TelegramViewportDeps);

    (webApp as Record<string, unknown>).safeAreaInset = { top: 59, bottom: 34 };
    webApp.fire('safeAreaChanged');
    expect(root.vars.get('--tg-safe-top')).toBe('59px');
    expect(root.vars.get('--tg-safe-bottom')).toBe('34px');

    (webApp as Record<string, unknown>).contentSafeAreaInset = { top: 48 };
    webApp.fire('contentSafeAreaChanged');
    expect(root.vars.get('--tg-content-safe-top')).toBe('48px');
    expect(root.vars.get('--tg-content-safe-bottom')).toBe('0px');
  });

  it('cleanup unsubscribes every Telegram event', () => {
    const root = makeRoot();
    const webApp = makeWebApp({ viewportStableHeight: 600 });
    const cleanup = setupTelegramViewport({
      webApp,
      win: makeWin(),
      root
    } as unknown as TelegramViewportDeps);
    expect(webApp.handlerCount('viewportChanged')).toBe(1);
    cleanup();
    expect(webApp.handlerCount('viewportChanged')).toBe(0);
    expect(webApp.handlerCount('safeAreaChanged')).toBe(0);
    expect(webApp.handlerCount('contentSafeAreaChanged')).toBe(0);
  });
});

describe('setupTelegramViewport — standalone web fallback', () => {
  it('uses visualViewport height and tracks resize', () => {
    const root = makeRoot();
    const win = makeWin({ innerHeight: 800, visualViewportHeight: 720 });
    setupTelegramViewport({ webApp: null, win, root } as unknown as TelegramViewportDeps);

    // visualViewport wins over innerHeight when present.
    expect(root.vars.get('--tg-viewport-stable-height')).toBe('720px');
    expect(win.vvHandlerCount('resize')).toBe(1);

    // Keyboard opens → visualViewport shrinks → resize re-reads it.
    (win.visualViewport as { height: number }).height = 480;
    win.fireVv('resize');
    expect(root.vars.get('--tg-viewport-stable-height')).toBe('480px');
  });

  it('falls back to innerHeight when visualViewport is absent', () => {
    const root = makeRoot();
    const win = makeWin({ innerHeight: 844 });
    const cleanup = setupTelegramViewport({
      webApp: null,
      win,
      root
    } as unknown as TelegramViewportDeps);
    expect(root.vars.get('--tg-viewport-stable-height')).toBe('844px');
    expect(win.winHandlerCount('resize')).toBe(1);
    cleanup();
    expect(win.winHandlerCount('resize')).toBe(0);
  });
});
