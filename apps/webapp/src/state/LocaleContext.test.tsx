import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { LocaleProvider, useLocale } from './LocaleContext';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const LangProbe = () => {
  const { locale, setLocale } = useLocale();
  return createElement(
    'div',
    null,
    createElement('span', { id: 'loc' }, locale),
    createElement('button', { id: 'to-en', onClick: () => setLocale('en') }, 'en'),
    createElement('button', { id: 'to-ru', onClick: () => setLocale('ru') }, 'ru')
  );
};

describe('LocaleProvider <html lang> sync (T1.8)', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mount = () =>
    act(() =>
      root.render(createElement(LocaleProvider, { children: createElement(LangProbe) }))
    );

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('sets <html lang> to the default locale on mount', () => {
    mount();
    expect(document.documentElement.lang).toBe('ru');
  });

  it('updates <html lang> when the locale changes', () => {
    mount();
    expect(document.documentElement.lang).toBe('ru');
    act(() => document.getElementById('to-en')?.click());
    expect(document.documentElement.lang).toBe('en');
    act(() => document.getElementById('to-ru')?.click());
    expect(document.documentElement.lang).toBe('ru');
  });
});
