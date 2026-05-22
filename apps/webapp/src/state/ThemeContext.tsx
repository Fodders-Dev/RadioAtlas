import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import {
  getTelegramThemeParams,
  subscribeTelegramThemeChange,
  type TelegramThemeParams
} from '../lib/telegram';
import { DEFAULT_RADIOATLAS_THEMES, DEFAULT_THEME_ID } from '../lib/theme/defaults';
import { themeRuntimeVars } from '../lib/theme/runtime';
import {
  deleteStoredAsset,
  deleteStoredTheme,
  getStoredAssets,
  listStoredThemeManifests,
  saveStoredAsset,
  saveStoredTheme
} from '../lib/theme/storage';
import {
  buildTelegramThemeVars,
  telegramParamsHaveMappedKeys,
  TELEGRAM_AUTO_THEME,
  TELEGRAM_AUTO_THEME_ID
} from '../lib/theme/telegramAuto';
import type { RadioAtlasTheme, ThemeAsset, ThemeAssetInput, ThemeDraftInput } from '../lib/theme/types';
import { useLocalStorage } from '../lib/useLocalStorage';

type ThemeContextValue = {
  currentTheme: RadioAtlasTheme;
  currentThemeId: string;
  availableThemes: RadioAtlasTheme[];
  customThemes: RadioAtlasTheme[];
  ready: boolean;
  applyTheme: (themeId: string) => boolean;
  saveDraft: (theme: ThemeDraftInput) => Promise<RadioAtlasTheme>;
  saveDraftAndApply: (theme: ThemeDraftInput) => Promise<RadioAtlasTheme>;
  removeTheme: (themeId: string) => Promise<void>;
  saveAsset: (asset: ThemeAssetInput) => Promise<ThemeAsset>;
  removeAsset: (assetId: string) => Promise<void>;
  ensureThemeAssets: (assetIds: string[]) => Promise<void>;
  getAssetUrl: (assetId: string) => string | null;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const CURRENT_THEME_KEY = 'radio:theme-current:v1';

const isBundledThemeId = (themeId: string) =>
  DEFAULT_RADIOATLAS_THEMES.some((theme) => theme.id === themeId);

const createAssetUrls = (assets: ThemeAsset[]) => {
  if (typeof URL === 'undefined' || !URL.createObjectURL) {
    return new Map<string, string>();
  }

  return new Map(assets.map((asset) => [asset.id, URL.createObjectURL(asset.blob)]));
};

export const collectThemeAssetIds = (theme: RadioAtlasTheme | null | undefined) => {
  if (!theme) return [];
  const ids = new Set<string>();
  const backgroundAssetId =
    theme.layers.background?.kind === 'image' ? theme.layers.background.assetId : null;
  if (backgroundAssetId) ids.add(backgroundAssetId);
  const iconLayer = theme.layers.icons;
  if (iconLayer) {
    (['play', 'pause', 'next', 'prev', 'like'] as const).forEach((iconName) => {
      const assetId = iconLayer[iconName];
      if (assetId) ids.add(assetId);
    });
  }
  theme.layers.stickers?.forEach((item) => ids.add(item.assetId));
  theme.layers.gifs?.forEach((item) => ids.add(item.assetId));
  return [...ids];
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [currentThemeId, setCurrentThemeId] = useLocalStorage(CURRENT_THEME_KEY, DEFAULT_THEME_ID);
  const [customThemes, setCustomThemes] = useState<RadioAtlasTheme[]>([]);
  const [assetUrls, setAssetUrls] = useState<Map<string, string>>(() => new Map());
  const [ready, setReady] = useState(false);
  const assetUrlsRef = useRef(assetUrls);

  // T1.3: Telegram themeParams as the lowest-priority theme layer.
  // null means either "outside Telegram client" or "SDK has no
  // themeParams field" — both fall through to whatever the user
  // picked (default = 'classic'). On themeChanged we re-snapshot;
  // the SDK mutates the same object in place between events so we
  // MUST clone in getTelegramThemeParams() for setState to fire.
  const [telegramThemeParams, setTelegramThemeParams] =
    useState<TelegramThemeParams | null>(() => getTelegramThemeParams());
  useEffect(() => {
    const unsubscribe = subscribeTelegramThemeChange(() => {
      setTelegramThemeParams(getTelegramThemeParams());
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    assetUrlsRef.current = assetUrls;
  }, [assetUrls]);

  useEffect(() => {
    let cancelled = false;
    void listStoredThemeManifests()
      .then((themes) => {
        if (cancelled) return;
        setCustomThemes(themes.filter((theme) => !theme.builtin));
      })
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const ensureThemeAssets = useCallback(async (assetIds: string[]) => {
    const missingIds = [...new Set(assetIds)].filter(
      (assetId) => assetId && !assetUrlsRef.current.has(assetId)
    );
    if (!missingIds.length) return;

    const assets = await getStoredAssets(missingIds);
    if (!assets.length) return;
    const nextUrls = createAssetUrls(assets);
    setAssetUrls((prev) => {
      const next = new Map(prev);
      nextUrls.forEach((url, assetId) => {
        const previousUrl = next.get(assetId);
        if (previousUrl && previousUrl !== url) {
          URL.revokeObjectURL?.(previousUrl);
        }
        next.set(assetId, url);
      });
      return next;
    });
  }, []);

  useEffect(
    () => () => {
      assetUrlsRef.current.forEach((url) => URL.revokeObjectURL?.(url));
    },
    []
  );

  const availableThemes = useMemo(() => {
    const customById = new Map(customThemes.map((theme) => [theme.id, theme]));
    // The synthetic Telegram-auto theme is render-only (PB-3) — NOT
    // included here so the Theme Studio picker never shows it as a
    // selectable option. currentTheme resolves it separately below.
    return [
      ...DEFAULT_RADIOATLAS_THEMES,
      ...Array.from(customById.values()).sort((a, b) => b.updatedAt - a.updatedAt)
    ];
  }, [customThemes]);

  // T1.3: the effective theme id used for rendering. Differs from
  // `currentThemeId` only when ALL of the following hold:
  //   - user has NOT picked an explicit theme (predicate:
  //     `currentThemeId === DEFAULT_THEME_ID`, i.e. stored 'classic')
  //   - we are inside the Telegram client (strict initData gate;
  //     getTelegramThemeParams returns null on standalone web)
  //   - at least one of our 4 mapped source keys is present in
  //     themeParams (synthesis floor; see telegramAuto.ts)
  //
  // Known wrinkle: the predicate conflates two cases — genuine
  // first-time users with the stored default vs. users who
  // explicitly tapped Classic in Theme Studio (both store 'classic').
  // Both fall through to Telegram themeParams. Distinguishing
  // "explicit classic" is a Theme Studio change (T1.3b in backlog),
  // not in scope here.
  const effectiveThemeId = useMemo(() => {
    if (currentThemeId !== DEFAULT_THEME_ID) return currentThemeId;
    if (telegramParamsHaveMappedKeys(telegramThemeParams)) return TELEGRAM_AUTO_THEME_ID;
    return DEFAULT_THEME_ID;
  }, [currentThemeId, telegramThemeParams]);

  const currentTheme = useMemo(() => {
    if (effectiveThemeId === TELEGRAM_AUTO_THEME_ID) return TELEGRAM_AUTO_THEME;
    return (
      availableThemes.find((theme) => theme.id === effectiveThemeId) ||
      availableThemes.find((theme) => theme.id === DEFAULT_THEME_ID) ||
      DEFAULT_RADIOATLAS_THEMES[0]
    );
  }, [availableThemes, effectiveThemeId]);
  const currentThemeAssetIds = useMemo(() => collectThemeAssetIds(currentTheme), [currentTheme]);

  useEffect(() => {
    void ensureThemeAssets(currentThemeAssetIds);
  }, [currentThemeAssetIds, ensureThemeAssets]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    // For telegram-auto we bypass themeRuntimeVars and pull the 5
    // CSS-var values directly from the Telegram themeParams payload.
    // Same shape, different source — write side stays identical so
    // theme switches (telegram-auto → user-picked or vice versa)
    // always rewrite all 5 vars and leave no zombies.
    const vars =
      effectiveThemeId === TELEGRAM_AUTO_THEME_ID && telegramThemeParams
        ? buildTelegramThemeVars(telegramThemeParams)
        : themeRuntimeVars(currentTheme, (assetId) => assetUrls.get(assetId) || null);

    root.dataset.theme = effectiveThemeId;
    root.style.setProperty('--theme-accent', vars.accent);
    root.style.setProperty('--theme-accent-2', vars.accent2);
    root.style.setProperty('--theme-bg-image', vars.background);
    root.style.setProperty('--theme-font-family', vars.font);
    root.style.setProperty('--theme-icon-radius', vars.iconRadius);
  }, [assetUrls, currentTheme, effectiveThemeId, telegramThemeParams]);

  const applyTheme = useCallback(
    (themeId: string) => {
      if (!availableThemes.some((theme) => theme.id === themeId)) {
        return false;
      }
      setCurrentThemeId(themeId);
      return true;
    },
    [availableThemes, setCurrentThemeId]
  );

  const saveDraft = useCallback(async (theme: ThemeDraftInput) => {
    const saved = await saveStoredTheme(theme);
    setCustomThemes((prev) => {
      const next = [saved, ...prev.filter((item) => item.id !== saved.id && !item.builtin)];
      return next.sort((a, b) => b.updatedAt - a.updatedAt);
    });
    return saved;
  }, []);

  const saveDraftAndApply = useCallback(
    async (theme: ThemeDraftInput) => {
      const saved = await saveDraft(theme);
      await ensureThemeAssets(collectThemeAssetIds(saved));
      setCurrentThemeId(saved.id);
      return saved;
    },
    [ensureThemeAssets, saveDraft, setCurrentThemeId]
  );

  const removeTheme = useCallback(
    async (themeId: string) => {
      if (isBundledThemeId(themeId)) return;
      await deleteStoredTheme(themeId);
      setCustomThemes((prev) => prev.filter((theme) => theme.id !== themeId));
      if (currentThemeId === themeId) {
        setCurrentThemeId(DEFAULT_THEME_ID);
      }
    },
    [currentThemeId, setCurrentThemeId]
  );

  const saveAsset = useCallback(async (asset: ThemeAssetInput) => {
    const saved = await saveStoredAsset(asset);
    if (typeof URL !== 'undefined' && URL.createObjectURL) {
      const nextUrl = URL.createObjectURL(saved.blob);
      setAssetUrls((prev) => {
        const previousUrl = prev.get(saved.id);
        if (previousUrl) {
          URL.revokeObjectURL?.(previousUrl);
        }
        const next = new Map(prev);
        next.set(saved.id, nextUrl);
        return next;
      });
    }
    return saved;
  }, []);

  const removeAsset = useCallback(async (assetId: string) => {
    await deleteStoredAsset(assetId);
    setAssetUrls((prev) => {
      const previousUrl = prev.get(assetId);
      if (previousUrl) {
        URL.revokeObjectURL?.(previousUrl);
      }
      const next = new Map(prev);
      next.delete(assetId);
      return next;
    });
  }, []);

  const getAssetUrl = useCallback((assetId: string) => assetUrlsRef.current.get(assetId) || null, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      currentTheme,
      // T1.3: expose the STORED user pick (not currentTheme.id) so the
      // Theme Studio picker keeps highlighting the user's choice even
      // when rendering is overridden by the synthetic Telegram-auto
      // theme. Previous behavior was `currentTheme.id` which would
      // never have collided with the picker (every render id WAS a
      // selectable theme); now telegram-auto is render-only and the
      // picker must continue to reflect localStorage truth.
      currentThemeId,
      availableThemes,
      customThemes,
      ready,
      applyTheme,
      saveDraft,
      saveDraftAndApply,
      removeTheme,
      saveAsset,
      removeAsset,
      ensureThemeAssets,
      getAssetUrl
    }),
    [
      applyTheme,
      availableThemes,
      currentTheme,
      currentThemeId,
      customThemes,
      getAssetUrl,
      ensureThemeAssets,
      ready,
      removeAsset,
      removeTheme,
      saveAsset,
      saveDraftAndApply,
      saveDraft
    ]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return context;
};
