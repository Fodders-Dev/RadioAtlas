import { useEffect, useState } from 'react';
import { searchMuseumSkins } from '../lib/skinMuseum';
import { useDebounce } from '../lib/useDebounce';
import { useRadio } from '../state/RadioContext';
import type { WinampMuseumSkin } from '../types';

type SearchState = 'idle' | 'loading' | 'ready' | 'error';

export const SkinPicker = () => {
  const { winamp } = useRadio();
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
        setError(nextError instanceof Error ? nextError.message : 'Unable to search skins');
        setSearchState('error');
      });

    return () => controller.abort();
  }, [debouncedQuery]);

  const activeMuseumMd5 = winamp.activeSkin.source === 'museum' ? winamp.activeSkin.md5 : null;

  return (
    <div className="skin-picker">
      <div className="skin-picker-header">
        <div>
          <div className="skin-picker-label">Current skin</div>
          <div className="skin-picker-current" data-skin-source={winamp.activeSkin.source}>
            {winamp.activeSkin.name}
          </div>
        </div>
        <button className="chip" type="button" onClick={() => winamp.setSkin('base-2.91')}>
          Use default
        </button>
      </div>

      <div className="search-bar skin-picker-search">
        <input
          id="skin-search"
          placeholder="Search skins.webamp.org"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
        {query && (
          <button className="clear-btn" type="button" onClick={() => setQuery('')}>
            Clear
          </button>
        )}
      </div>

      <div className="skin-picker-status">
        Search Winamp Skin Museum and keep the selected skin between visits.
      </div>

      {searchState === 'loading' && <div className="skin-picker-status">Searching skins...</div>}
      {searchState === 'error' && <div className="error">{error || 'Skin search failed'}</div>}
      {searchState === 'ready' && !results.length && (
        <div className="empty-state">No matching skins found.</div>
      )}

      {results.length > 0 && (
        <div className="skin-results" role="list" aria-label="Skin search results">
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
                    {isActive ? 'Active' : 'Apply'}
                  </button>
                  <a
                    className="chip"
                    href={skin.museumUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View
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
