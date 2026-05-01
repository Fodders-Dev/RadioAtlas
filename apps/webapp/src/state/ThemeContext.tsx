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
import { DEFAULT_RADIOATLAS_THEMES, DEFAULT_THEME_ID } from '../lib/theme/defaults';
import { themeRuntimeVars } from '../lib/theme/runtime';
import {
  deleteStoredAsset,
  deleteStoredTheme,
  listStoredAssets,
  listStoredThemes,
  saveStoredAsset,
  saveStoredTheme
} from '../lib/theme/storage';
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
  removeTheme: (themeId: string) => Promise<void>;
  saveAsset: (asset: ThemeAssetInput) => Promise<ThemeAsset>;
  removeAsset: (assetId: string) => Promise<void>;
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

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [currentThemeId, setCurrentThemeId] = useLocalStorage(CURRENT_THEME_KEY, DEFAULT_THEME_ID);
  const [customThemes, setCustomThemes] = useState<RadioAtlasTheme[]>([]);
  const [assetUrls, setAssetUrls] = useState<Map<string, string>>(() => new Map());
  const [ready, setReady] = useState(false);
  const assetUrlsRef = useRef(assetUrls);

  useEffect(() => {
    assetUrlsRef.current = assetUrls;
  }, [assetUrls]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listStoredThemes(), listStoredAssets()])
      .then(([themes, assets]) => {
        if (cancelled) return;
        setCustomThemes(themes.filter((theme) => !theme.builtin));
        const nextAssetUrls = createAssetUrls(assets);
        const previousUrls = assetUrlsRef.current;
        setAssetUrls(nextAssetUrls);
        previousUrls.forEach((url) => URL.revokeObjectURL?.(url));
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

  useEffect(
    () => () => {
      assetUrlsRef.current.forEach((url) => URL.revokeObjectURL?.(url));
    },
    []
  );

  const availableThemes = useMemo(() => {
    const customById = new Map(customThemes.map((theme) => [theme.id, theme]));
    return [
      ...DEFAULT_RADIOATLAS_THEMES,
      ...Array.from(customById.values()).sort((a, b) => b.updatedAt - a.updatedAt)
    ];
  }, [customThemes]);

  const currentTheme = useMemo(
    () =>
      availableThemes.find((theme) => theme.id === currentThemeId) ||
      availableThemes.find((theme) => theme.id === DEFAULT_THEME_ID) ||
      DEFAULT_RADIOATLAS_THEMES[0],
    [availableThemes, currentThemeId]
  );

  useLayoutEffect(() => {
    const root = document.documentElement;
    const vars = themeRuntimeVars(currentTheme, (assetId) => assetUrls.get(assetId) || null);

    root.dataset.theme = currentTheme.id;
    root.style.setProperty('--theme-accent', vars.accent);
    root.style.setProperty('--theme-accent-2', vars.accent2);
    root.style.setProperty('--theme-bg-image', vars.background);
    root.style.setProperty('--theme-font-family', vars.font);
  }, [assetUrls, currentTheme]);

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
      currentThemeId: currentTheme.id,
      availableThemes,
      customThemes,
      ready,
      applyTheme,
      saveDraft,
      removeTheme,
      saveAsset,
      removeAsset,
      getAssetUrl
    }),
    [
      applyTheme,
      availableThemes,
      currentTheme,
      customThemes,
      getAssetUrl,
      ready,
      removeAsset,
      removeTheme,
      saveAsset,
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
