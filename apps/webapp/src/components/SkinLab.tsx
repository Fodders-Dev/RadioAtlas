import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { searchMuseumSkins } from '../lib/skinMuseum';
import { extractSkinPaletteFromBlob, extractSkinPaletteFromUrl } from '../lib/skinTheme';
import { WINAMP_CLASSIC_PALETTE } from '../lib/winampSkins';
import { useDebounce } from '../lib/useDebounce';
import { useLocale } from '../state/LocaleContext';
import { useShell } from '../state/RadioContext';
import type { ActiveWinampSkin, SkinPalette, WinampMuseumSkin, WinampSkinPreset, WinampUploadedSkin } from '../types';
import { SettingsSheet } from './SettingsSheet';

type SearchState = 'idle' | 'loading' | 'ready' | 'error';

type SkinLabCandidate =
  | (WinampSkinPreset & { source: 'preset'; screenshotUrl?: null })
  | (WinampMuseumSkin & { source: 'museum' })
  | WinampUploadedSkin;

type SkinLabSheetProps = {
  open: boolean;
  onClose: () => void;
};

const SAMPLE_STATION = {
  name: 'RadioAtlas Lab FM',
  meta: 'Preview only - no audio',
  track: 'Mock Song - Purple Signals'
};

const candidateKey = (skin: SkinLabCandidate | ActiveWinampSkin | null) => {
  if (!skin) return 'none';
  if (skin.source === 'museum') return `museum:${skin.md5}`;
  if (skin.source === 'uploaded') return `uploaded:${skin.objectUrl}`;
  return `preset:${skin.id}`;
};

const toCandidate = (skin: ActiveWinampSkin): SkinLabCandidate => {
  if (skin.source === 'museum' || skin.source === 'uploaded') return skin;
  return { ...skin, source: 'preset', screenshotUrl: null };
};

const PreviewShell = ({ skin }: { skin: SkinLabCandidate }) => {
  const palette: SkinPalette = skin.palette || WINAMP_CLASSIC_PALETTE;
  const style = {
    '--skin-preview-bg': palette.bg,
    '--skin-preview-panel': palette.panel,
    '--skin-preview-accent': palette.accent,
    '--skin-preview-muted': palette.muted,
    '--skin-preview-border': palette.border,
    '--skin-preview-text': palette.text
  } as CSSProperties;

  return (
    <div
      className="skin-lab-preview-shell"
      style={style}
      data-preview-skin-source={skin.source}
      data-preview-skin-name={skin.name}
    >
      <div className="skin-lab-preview-titlebar">
        <span>WINAMP</span>
        <strong>{skin.name}</strong>
      </div>
      <div className="skin-lab-preview-display">
        <span>{SAMPLE_STATION.name}</span>
        <strong>{SAMPLE_STATION.track}</strong>
      </div>
      <div className="skin-lab-preview-controls" aria-hidden="true">
        <span />
        <span />
        <span className="active" />
        <span />
        <span />
      </div>
      <div className="skin-lab-preview-playlist">
        <div>{SAMPLE_STATION.meta}</div>
        <div>01. {SAMPLE_STATION.name}</div>
      </div>
    </div>
  );
};

export const SkinLabSheet = ({ open, onClose }: SkinLabSheetProps) => {
  const { t } = useLocale();
  const { winamp } = useShell();
  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [results, setResults] = useState<WinampMuseumSkin[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [previewSkin, setPreviewSkin] = useState<SkinLabCandidate>(() => toCandidate(winamp.activeSkin));
  const [uploadedSkin, setUploadedSkin] = useState<WinampUploadedSkin | null>(null);
  const [uploadState, setUploadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadedPreviewUrlRef = useRef<string | null>(null);
  const previewPaletteCacheRef = useRef(new Map<string, SkinPalette>());
  const previewRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const debouncedQuery = useDebounce(query, 280);

  const presetSkins = useMemo(
    () => winamp.availableSkins.map((skin) => ({ ...skin, source: 'preset' as const, screenshotUrl: null })),
    [winamp.availableSkins]
  );
  const previewKey = candidateKey(previewSkin);
  const activeKey = candidateKey(winamp.activeSkin);

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
  }, [debouncedQuery, t]);

  useEffect(
    () => () => {
      mountedRef.current = false;
      if (uploadedPreviewUrlRef.current) {
        URL.revokeObjectURL(uploadedPreviewUrlRef.current);
      }
    },
    []
  );

  const previewCandidate = (skin: SkinLabCandidate) => {
    const key = candidateKey(skin);
    const cachedPalette = previewPaletteCacheRef.current.get(key);
    const nextSkin = cachedPalette && !skin.palette ? { ...skin, palette: cachedPalette } : skin;
    setPreviewSkin(nextSkin);
    if (nextSkin.palette || skin.source === 'uploaded') return;

    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    void extractSkinPaletteFromUrl(skin.url)
      .then((palette) => {
        previewPaletteCacheRef.current.set(key, palette);
        if (!mountedRef.current || previewRequestRef.current !== requestId) return;
        setPreviewSkin((current) =>
          candidateKey(current) === key ? { ...current, palette } : current
        );
      })
      .catch(() => {});
  };

  const applyPreview = () => {
    if (previewSkin.source === 'museum') {
      winamp.selectSkin(previewSkin);
      return;
    }
    if (previewSkin.source === 'uploaded') {
      if (uploadedPreviewUrlRef.current === previewSkin.objectUrl) {
        uploadedPreviewUrlRef.current = null;
      }
      winamp.selectUploadedSkin(previewSkin);
      setUploadedSkin(null);
      return;
    }
    winamp.setSkin(previewSkin.id);
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    if (!file) return;
    if (!/\.(wsz|zip)$/i.test(file.name)) {
      setUploadState('error');
      setUploadError(t('skin.uploadInvalid'));
      return;
    }

    if (uploadedPreviewUrlRef.current) {
      URL.revokeObjectURL(uploadedPreviewUrlRef.current);
      uploadedPreviewUrlRef.current = null;
    }

    setUploadState('loading');
    setUploadError(null);
    const objectUrl = URL.createObjectURL(file);
    uploadedPreviewUrlRef.current = objectUrl;

    try {
      const palette = await extractSkinPaletteFromBlob(file);
      const nextSkin: WinampUploadedSkin = {
        id: `uploaded:${file.name}:${file.lastModified}`,
        name: file.name,
        url: objectUrl,
        objectUrl,
        source: 'uploaded',
        palette
      };
      setUploadedSkin(nextSkin);
      setPreviewSkin(nextSkin);
      setUploadState('ready');
    } catch (uploadErrorValue) {
      const nextSkin: WinampUploadedSkin = {
        id: `uploaded:${file.name}:${file.lastModified}`,
        name: file.name,
        url: objectUrl,
        objectUrl,
        source: 'uploaded',
        palette: WINAMP_CLASSIC_PALETTE
      };
      setUploadedSkin(nextSkin);
      setPreviewSkin(nextSkin);
      setUploadState('error');
      setUploadError(uploadErrorValue instanceof Error ? uploadErrorValue.message : t('skin.uploadFailed'));
    }
  };

  const renderSkinCard = (skin: SkinLabCandidate, label: string) => {
    const selected = previewKey === candidateKey(skin);
    const active = activeKey === candidateKey(skin);
    return (
      <article className={`skin-lab-card ${selected ? 'selected' : ''} ${active ? 'active' : ''}`} key={candidateKey(skin)}>
        <button className="skin-lab-card-main" type="button" onClick={() => previewCandidate(skin)}>
          <div className="skin-result-media">
            {skin.source === 'museum' && skin.screenshotUrl ? (
              <img src={skin.screenshotUrl} alt="" loading="lazy" />
            ) : (
              <div className="skin-result-fallback">{skin.source === 'uploaded' ? 'WSZ' : 'WIN'}</div>
            )}
          </div>
          <div className="skin-result-body">
            <div className="skin-result-name">{skin.name}</div>
            <div className="skin-result-meta">{label}</div>
          </div>
        </button>
        {skin.source === 'museum' ? (
          <a className="chip" href={skin.museumUrl} target="_blank" rel="noreferrer">
            {t('common.view')}
          </a>
        ) : null}
      </article>
    );
  };

  return (
    <SettingsSheet open={open} onClose={onClose} kicker={t('skin.kicker')} title={t('skin.title')}>
      <div className="skin-lab-sheet" data-skin-lab>
        <section className="skin-lab-section">
          <div className="skin-lab-section-head">
            <div>
              <div className="skin-picker-label">{t('skin.current')}</div>
              <div className="skin-picker-current" data-skin-source={winamp.activeSkin.source}>
                {winamp.activeSkin.name}
              </div>
            </div>
            <button className="chip" type="button" onClick={() => winamp.setSkin('base-2.91')}>
              {t('skin.resetClassic')}
            </button>
          </div>
        </section>

        <section className="skin-lab-section skin-lab-preview-panel">
          <div className="skin-lab-section-head">
            <div>
              <div className="skin-picker-label">{t('skin.preview')}</div>
              <div className="skin-lab-preview-name">{previewSkin.name}</div>
            </div>
            <button className="chip active" type="button" onClick={applyPreview}>
              {previewKey === activeKey ? t('common.active') : t('common.apply')}
            </button>
          </div>
          <PreviewShell skin={previewSkin} />
        </section>

        <section className="skin-lab-section">
          <div className="skin-lab-section-head">
            <div>
              <div className="section-title">{t('skin.libraryTitle')}</div>
              <div className="section-subtitle">{t('skin.libraryCopy')}</div>
            </div>
          </div>

          <div className="search-bar skin-picker-search">
            <input
              id="skin-lab-search"
              placeholder={t('skin.placeholder')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
            {query ? (
              <button className="clear-btn" type="button" onClick={() => setQuery('')}>
                {t('common.clear')}
              </button>
            ) : null}
          </div>

          {searchState === 'loading' ? <div className="skin-picker-status">{t('skin.searching')}</div> : null}
          {searchState === 'error' ? <div className="error">{error || t('skin.searchFailed')}</div> : null}
          {searchState === 'ready' && !results.length ? <div className="empty-state">{t('skin.noResults')}</div> : null}
          {results.length ? (
            <div className="skin-lab-grid" role="list" aria-label={t('skin.resultsLabel')}>
              {results.map((skin) => renderSkinCard({ ...skin, source: 'museum' }, t('skin.museum')))}
            </div>
          ) : null}

          <div className="skin-lab-grid skin-lab-presets">
            {presetSkins.map((skin) => renderSkinCard(skin, t('skin.preset')))}
          </div>
        </section>

        <section className="skin-lab-section">
          <div className="skin-lab-section-head">
            <div>
              <div className="section-title">{t('skin.uploadTitle')}</div>
              <div className="section-subtitle">{t('skin.uploadCopy')}</div>
            </div>
            <label className="chip active skin-lab-upload">
              {t('skin.uploadAction')}
              <input type="file" accept=".wsz,.zip" onChange={handleUpload} />
            </label>
          </div>
          {uploadState === 'loading' ? <div className="skin-picker-status">{t('skin.uploading')}</div> : null}
          {uploadError ? <div className={uploadState === 'error' ? 'error' : 'skin-picker-status'}>{uploadError}</div> : null}
          {uploadedSkin ? (
            <div className="skin-lab-grid">
              {renderSkinCard(uploadedSkin, t('skin.uploaded'))}
            </div>
          ) : null}
        </section>
      </div>
    </SettingsSheet>
  );
};
