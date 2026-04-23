import { useCallback, useEffect, useState } from 'react';
import { getApiBase } from '../../lib/apiBase';
import { checkApiAvailability, markApiUnavailable } from '../../lib/apiAvailability';
import { usePersistentState } from '../../lib/persistentState';
import {
  deriveName,
  isBlocked,
  isDirectAudioUrl,
  isPlaylistUrl,
  normalizeUrl,
  parseM3u,
  parsePls,
  pickBestStream
} from './linkUtils';
import type { ExternalLink, ExtractResponse, TranslateFn } from './types';

type UseExternalLinksOptions = {
  mode: 'stations' | 'links';
  t: TranslateFn;
};

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const useExternalLinks = ({ mode, t }: UseExternalLinksOptions) => {
  const apiBase = getApiBase();
  const [apiOnline, setApiOnline] = useState(() => Boolean(apiBase));
  const [linkUrl, setLinkUrl] = useState('');
  const [linkName, setLinkName] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [links, setLinks] = usePersistentState<ExternalLink[]>('radio:links:v2', [], {
    clearLegacyKeys: ['radio:links']
  });

  useEffect(() => {
    if (linkError) {
      setLinkError(null);
    }
  }, [linkError, linkName, linkUrl, mode]);

  const checkApiOnline = useCallback(async () => {
    if (!apiBase) {
      setApiOnline(false);
      return false;
    }
    const ok = await checkApiAvailability(apiBase, { timeoutMs: 1_000 });
    setApiOnline(ok);
    return ok;
  }, [apiBase]);

  useEffect(() => {
    if (!apiBase) {
      setApiOnline(false);
      return;
    }
    if (mode !== 'links') return;

    let active = true;
    const refresh = async () => {
      const ok = await checkApiOnline();
      if (active) {
        setApiOnline(ok);
      }
    };
    const handleVisibility = () => {
      if (!document.hidden) {
        void refresh();
      }
    };

    void refresh();
    window.addEventListener('focus', handleVisibility);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      active = false;
      window.removeEventListener('focus', handleVisibility);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [apiBase, checkApiOnline, mode]);

  const addLinks = useCallback(
    (items: ExternalLink[]) => {
      setLinks((prev) => {
        const existing = new Set(prev.map((item) => item.url));
        const seen = new Set<string>();
        const next = items.filter((item) => {
          if (seen.has(item.url)) return false;
          seen.add(item.url);
          return !existing.has(item.url);
        });
        return [...next, ...prev];
      });
    },
    [setLinks]
  );

  const ensureApiAvailable = useCallback(async () => {
    if (!apiBase) {
      setApiOnline(false);
      setLinkError(t('discover.apiUnavailable'));
      return false;
    }
    const ok = await checkApiOnline();
    if (!ok) {
      setLinkError(t('discover.apiUnavailable'));
    }
    return ok;
  }, [apiBase, checkApiOnline, t]);

  const importPlaylist = useCallback(
    async (source: string) => {
      setLinkError(null);
      const normalized = normalizeUrl(source);
      if (!normalized) {
        setLinkError(t('discover.enterPlaylistUrl'));
        return;
      }
      if (isBlocked(normalized)) {
        setLinkError(t('discover.youtubeBlocked'));
        return;
      }

      setLinkLoading(true);
      try {
        const fetchTargets: string[] = [normalized];
        const apiReady = apiBase ? await checkApiOnline() : false;
        if (apiReady) {
          fetchTargets.unshift(`${apiBase}/fetch?url=${encodeURIComponent(normalized)}`);
        }

        let response: Response | null = null;
        let lastStatus = 0;
        for (const fetchUrl of fetchTargets) {
          try {
            const next = await fetch(fetchUrl);
            if (!next.ok) {
              lastStatus = next.status;
              if (apiBase && fetchUrl.startsWith(`${apiBase}/`)) {
                setApiOnline(false);
              }
              continue;
            }
            response = next;
            break;
          } catch {
            if (apiBase && fetchUrl.startsWith(`${apiBase}/`)) {
              setApiOnline(false);
              markApiUnavailable(apiBase);
              continue;
            }
          }
        }

        if (!response) {
          if (apiBase && !apiReady) {
            throw new Error(t('discover.apiUnavailable'));
          }
          throw new Error(`Playlist fetch failed (${lastStatus || 0})`);
        }

        const text = await response.text();
        const lower = normalized.toLowerCase();
        const rawItems =
          lower.endsWith('.pls') || text.toLowerCase().includes('[playlist]')
            ? parsePls(text, normalized)
            : parseM3u(text, normalized);

        const cleanItems = rawItems
          .map((item) => ({ url: normalizeUrl(item.url), name: item.name }))
          .filter((item) => item.url && !isBlocked(item.url))
          .slice(0, 200);

        if (!cleanItems.length) {
          setLinkError(t('discover.noPlayableUrls'));
          return;
        }

        addLinks(
          cleanItems.map((item) => ({
            id: createId(),
            name: item.name?.trim() || deriveName(item.url),
            url: item.url,
            addedAt: Date.now()
          }))
        );
        setLinkUrl('');
        setLinkName('');
      } catch (error) {
        setLinkError(error instanceof Error ? error.message : t('common.importPlaylist'));
      } finally {
        setLinkLoading(false);
      }
    },
    [addLinks, apiBase, checkApiOnline, t]
  );

  const extractLinkFor = useCallback(
    async (sourceUrl: string, nameOverride?: string) => {
      const normalized = normalizeUrl(sourceUrl);
      if (!apiBase) {
        setLinkError(t('discover.apiUnavailable'));
        return;
      }
      const canUseApi = await ensureApiAvailable();
      if (!canUseApi) return;
      setLinkLoading(true);
      try {
        const response = await fetch(`${apiBase}/extract?url=${encodeURIComponent(normalized)}`);
        const data = (await response.json()) as ExtractResponse;
        if (!response.ok || data?.type === 'error') {
          throw new Error(data?.error || `Extractor error (${response.status})`);
        }

        if (data.type === 'playlist') {
          const items = data.items?.filter((item) => item.url && !isBlocked(item.url)) || [];
          if (!items.length) {
            setLinkError(t('discover.noPlayableItems'));
            return;
          }
          addLinks(
            items.slice(0, 200).map((item) => ({
              id: createId(),
              name: item.title?.trim() || deriveName(item.url),
              url: item.url,
              addedAt: Date.now()
            }))
          );
        } else {
          const best = pickBestStream(data.audioStreams || []);
          if (!best?.url) {
            setLinkError(t('discover.noPlayableStreams'));
            return;
          }
          const name = nameOverride?.trim() || data.title?.trim() || deriveName(normalized);
          addLinks([{ id: createId(), name, url: best.url, addedAt: Date.now() }]);
        }

        setLinkUrl('');
        setLinkName('');
      } catch (error) {
        setApiOnline(false);
        markApiUnavailable(apiBase);
        setLinkError(error instanceof Error ? error.message : t('common.extractStreams'));
      } finally {
        setLinkLoading(false);
      }
    },
    [addLinks, apiBase, ensureApiAvailable, t]
  );

  const addSingleLink = useCallback(() => {
    setLinkError(null);
    const normalized = normalizeUrl(linkUrl);
    if (!normalized) {
      setLinkError(t('discover.enterValidUrl'));
      return;
    }
    if (isBlocked(normalized)) {
      setLinkError(t('discover.youtubeBlocked'));
      return;
    }
    if (isPlaylistUrl(normalized)) {
      void importPlaylist(normalized);
      return;
    }
    if (!isDirectAudioUrl(normalized)) {
      if (!apiBase) {
        setLinkError(t('discover.extractorMissing'));
        return;
      }
      void extractLinkFor(normalized, linkName.trim());
      return;
    }
    const name = linkName.trim() || deriveName(normalized);
    addLinks([{ id: createId(), name, url: normalized, addedAt: Date.now() }]);
    setLinkUrl('');
    setLinkName('');
  }, [addLinks, apiBase, extractLinkFor, importPlaylist, linkName, linkUrl, t]);

  const extractLink = useCallback(async () => {
    setLinkError(null);
    const normalized = normalizeUrl(linkUrl);
    if (!normalized) {
      setLinkError(t('discover.enterValidUrl'));
      return;
    }
    if (isBlocked(normalized)) {
      setLinkError(t('discover.youtubeBlocked'));
      return;
    }
    if (!apiBase) {
      setLinkError(t('discover.extractorNotConfigured'));
      return;
    }
    await extractLinkFor(normalized, linkName.trim());
  }, [apiBase, extractLinkFor, linkName, linkUrl, t]);

  const handlePaste = useCallback(async () => {
    setLinkError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setLinkUrl(text.trim());
      }
    } catch {
      setLinkError(t('discover.clipboardDenied'));
    }
  }, [t]);

  const removeLink = useCallback(
    (id: string) => {
      setLinks((prev) => prev.filter((item) => item.id !== id));
    },
    [setLinks]
  );

  return {
    apiBase,
    apiOnline,
    linkUrl,
    setLinkUrl,
    linkName,
    setLinkName,
    linkError,
    linkLoading,
    links,
    addSingleLink,
    extractLink,
    importPlaylist,
    handlePaste,
    removeLink
  };
};
