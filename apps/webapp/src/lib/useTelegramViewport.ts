// PR-2: dynamic Telegram viewport + safe-area bridge. The CSS shell was frozen
// at mount (100vh): inside the Telegram webview the header/keyboard change the
// usable height AFTER mount, so fixed dock/nav and reserved scroll space drift
// and content overlaps. (Pure Chrome has a static viewport, so it never repros
// there.) This reads the live Telegram WebApp viewport + safe-area, writes them
// to CSS custom properties on :root, and re-writes them on every Telegram
// viewport/safe-area event. Outside Telegram it falls back to visualViewport so
// the URL bar / on-screen keyboard are still tracked.
import { useEffect } from 'react';
import { getTelegramWebApp, type TelegramWebApp } from './telegram';

type CssVarTarget = { style: Pick<CSSStyleDeclaration, 'setProperty'> };

type ViewportWindow = Pick<Window, 'addEventListener' | 'removeEventListener' | 'innerHeight'> & {
  visualViewport?: Pick<
    VisualViewport,
    'height' | 'addEventListener' | 'removeEventListener'
  > | null;
};

export type TelegramViewportDeps = {
  webApp: TelegramWebApp | null;
  win: ViewportWindow;
  root: CssVarTarget;
};

const px = (value: number) => `${Math.round(value)}px`;

// Wire the live viewport/safe-area into CSS vars and subscribe to updates.
// Returns a cleanup that removes every listener. Exported (not just the hook) so
// it unit-tests with a fake WebApp + fake root, no React render needed.
export const setupTelegramViewport = (deps: TelegramViewportDeps): (() => void) => {
  const { webApp, win, root } = deps;
  const setVar = (name: string, value: string) => root.style.setProperty(name, value);

  if (webApp) {
    const applyViewport = () => {
      if (typeof webApp.viewportHeight === 'number') {
        setVar('--tg-viewport-height', px(webApp.viewportHeight));
      }
      if (typeof webApp.viewportStableHeight === 'number') {
        setVar('--tg-viewport-stable-height', px(webApp.viewportStableHeight));
      }
    };
    const applyInset = (
      inset: { top?: number; bottom?: number; left?: number; right?: number } | undefined,
      prefix: string
    ) => {
      if (!inset) return;
      setVar(`${prefix}-top`, px(inset.top ?? 0));
      setVar(`${prefix}-bottom`, px(inset.bottom ?? 0));
      setVar(`${prefix}-left`, px(inset.left ?? 0));
      setVar(`${prefix}-right`, px(inset.right ?? 0));
    };
    const applySafeArea = () => applyInset(webApp.safeAreaInset, '--tg-safe');
    const applyContentSafeArea = () => applyInset(webApp.contentSafeAreaInset, '--tg-content-safe');

    applyViewport();
    applySafeArea();
    applyContentSafeArea();

    webApp.onEvent?.('viewportChanged', applyViewport);
    webApp.onEvent?.('safeAreaChanged', applySafeArea);
    webApp.onEvent?.('contentSafeAreaChanged', applyContentSafeArea);

    return () => {
      webApp.offEvent?.('viewportChanged', applyViewport);
      webApp.offEvent?.('safeAreaChanged', applySafeArea);
      webApp.offEvent?.('contentSafeAreaChanged', applyContentSafeArea);
    };
  }

  // Standalone web: no Telegram safe-area (CSS keeps the env() fallback), but
  // track the visual viewport height so the shell follows the URL bar / keyboard.
  const applyFallback = () => {
    const height = win.visualViewport?.height ?? win.innerHeight;
    setVar('--tg-viewport-height', px(height));
    setVar('--tg-viewport-stable-height', px(height));
  };
  applyFallback();
  const vv = win.visualViewport;
  vv?.addEventListener('resize', applyFallback);
  win.addEventListener('resize', applyFallback);
  return () => {
    vv?.removeEventListener('resize', applyFallback);
    win.removeEventListener('resize', applyFallback);
  };
};

export const useTelegramViewport = (): void => {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    return setupTelegramViewport({
      webApp: getTelegramWebApp(),
      win: window,
      root: document.documentElement
    });
  }, []);
};
