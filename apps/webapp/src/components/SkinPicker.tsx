import { useEffect, useState } from 'react';
import { searchMuseumSkins } from '../lib/skinMuseum';
import { useDebounce } from '../lib/useDebounce';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';
import type { WinampMuseumSkin } from '../types';

type SearchState = 'idle' | 'loading' | 'ready' | 'error';

export const SkinPicker = () => {
  const { winamp } = useRadio();
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [results, setResults] = useState<WinampMuseumSkin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const debouncedQuery = useDebounce(query, 280);

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!trimmed) {
      setResults([]);
      setError(null);
      setSearchState('idle');
      return;
    }

    const controller = new AbortController();
    setSearchState('loading');
    setError(null);

    void searchMuseumSkins(trimmed, {
      limit: 12,
      signal: controller.signal
    })
      .then((items) => {
        setResults(items);
        setSearchState('ready');
      })
      .catch((nextError) => {
        if (controller.signal.aborted) return;
        setResults([]);
        setError(nextError instanceof Error ? nextError.message : t('skin.searchFailed'));
        setSearchState('error');
      });

    return () => controller.abort();
  }, [debouncedQuery]);

  const activeMuseumMd5 = winamp.activeSkin.source === 'museum' ? winamp.activeSkin.md5 : null;

  return (
    <div className="skin-picker">
      <div className="skin-picker-header">
        <div>
          <div className="skin-picker-label">{t('skin.current')}</div>
          <div className="skin-picker-current" data-skin-source={winamp.activeSkin.source}>
            {winamp.activeSkin.name}
          </div>
        </div>
        <button className="chip" type="button" onClick={() => winamp.setSkin('base-2.91')}>
          {t('skin.useDefault')}
        </button>
      </div>

      <div className="search-bar skin-picker-search">
        <input
          id="skin-search"
          placeholder={t('skin.placeholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
        {query && (
          <button className="clear-btn" type="button" onClick={() => setQuery('')}>
            {t('common.clear')}
          </button>
        )}
      </div>

      <div className="skin-picker-status">{t('skin.helper')}</div>

      {searchState === 'loading' && <div className="skin-picker-status">{t('skin.searching')}</div>}
      {searchState === 'error' && <div className="error">{error || t('skin.searchFailed')}</div>}
      {searchState === 'ready' && !results.length && (
        <div className="empty-state">{t('skin.noResults')}</div>
      )}

      {results.length > 0 && (
        <div className="skin-results" role="list" aria-label={t('skin.resultsLabel')}>
          {results.map((skin) => {
            const isActive = activeMuseumMd5 === skin.md5;
            return (
              <article
                key={skin.md5}
                className={`skin-result ${isActive ? 'active' : ''}`}
                role="listitem"
              >
                <div className="skin-result-media">
                  {skin.screenshotUrl ? (
                    <img src={skin.screenshotUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="skin-result-fallback">WSZ</div>
                  )}
                </div>
                <div className="skin-result-body">
                  <div className="skin-result-name">{skin.name}</div>
                  <div className="skin-result-meta">{skin.md5.slice(0, 8)}</div>
                </div>
                <div className="skin-result-actions">
                  <button
                    className={`chip ${isActive ? 'active' : ''}`}
                    type="button"
                    onClick={() => winamp.selectSkin(skin)}
                  >
                    {isActive ? t('common.active') : t('common.apply')}
                  </button>
                  <a
                    className="chip"
                    href={skin.museumUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('common.view')}
                  </a>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};
