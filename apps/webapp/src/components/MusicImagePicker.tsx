import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../lib/useDialog';
import { MusicImageError, MUSIC_IMAGE_MAX_BYTES, recognizeMusicImage, type MusicImageCandidate } from '../lib/musicImage';
import { useLocale } from '../state/LocaleContext';
import './MusicImagePicker.css';

type Props = { onChoose: (candidate: MusicImageCandidate) => void };

const MusicImageDialog = ({ onClose, onChoose }: { onClose: () => void; onChoose: Props['onChoose'] }) => {
  const { t } = useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [candidates, setCandidates] = useState<MusicImageCandidate[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const titleId = useId();

  useDialog(rootRef, { isOpen: true, onClose });
  const previewUrlRef = useRef('');
  useEffect(() => () => {
    generation.current += 1;
    activeRequest.current?.abort();
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  const revokePreview = () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = '';
    setPreviewUrl('');
  };
  const clearFile = () => {
    generation.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setBusy(false);
    setCandidates(null);
    setSelected(null);
    setArtist('');
    setTitle('');
    setError('');
    setFile(null);
    revokePreview();
    if (inputRef.current) inputRef.current.value = '';
  };
  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!next) return;
    activeRequest.current?.abort();
    generation.current += 1;
    setBusy(false);
    setCandidates(null);
    setSelected(null);
    setArtist('');
    setTitle('');
    setError('');
    setFile(null);
    revokePreview();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(next.type)) {
      setError(t('chat.musicImageFileError'));
      return;
    }
    if (next.size > MUSIC_IMAGE_MAX_BYTES) {
      setError(t('chat.musicImageSizeError'));
      return;
    }
    setFile(next);
    const nextUrl = URL.createObjectURL(next);
    previewUrlRef.current = nextUrl;
    setPreviewUrl(nextUrl);
  };
  const recognize = async () => {
    if (!file || busy) return;
    const request = ++generation.current;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setBusy(true);
    setError('');
    setCandidates(null);
    setSelected(null);
    try {
      const result = await recognizeMusicImage(file, controller.signal);
      if (request !== generation.current || controller.signal.aborted) return;
      setCandidates(result);
      if (!result.length) setError(t('chat.musicImageEmpty'));
    } catch (reason) {
      if (request !== generation.current || controller.signal.aborted) return;
      const code = reason instanceof MusicImageError ? reason.code : 'unavailable';
      const key = code === 'file' ? 'musicImageFileError'
        : code === 'tooLarge' ? 'musicImageSizeError'
        : code === 'timeout' ? 'musicImageTimeout'
        : code === 'rateLimited' ? 'musicImageRateLimited'
        : code === 'response' ? 'musicImageResponseError'
        : 'musicImageUnavailable';
      setError(t(`chat.${key}`));
    } finally {
      if (request === generation.current) setBusy(false);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  };
  const chooseCandidate = (candidate: MusicImageCandidate, index: number) => {
    setSelected(index);
    setArtist(candidate.artist);
    setTitle(candidate.title);
  };
  const manualSafe = (value: string, max: number) => {
    const clean = value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return clean.length > 0 && clean.length <= max && !/https?:\/\//i.test(clean);
  };
  const labelsSafe = manualSafe(artist, 120) && manualSafe(title, 180) && `${artist.trim()} — ${title.trim()}`.length <= 180;
  const commit = () => {
    const cleanArtist = artist.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const cleanTitle = title.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!labelsSafe || selected === null) { setError(t('chat.musicImageTrackInvalid')); return; }
    onChoose({ artist: cleanArtist, title: cleanTitle, uncertain: Boolean(candidates?.[selected]?.uncertain) });
    onClose();
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div ref={rootRef} className="music-image-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId} data-music-image-dialog>
      <button className="music-image-scrim" type="button" aria-label={t('common.close')} onClick={onClose} data-dialog-backdrop />
      <section className="music-image-dialog">
        <header className="music-image-head">
          <div><span>{t('chat.musicImageKicker')}</span><h2 id={titleId} tabIndex={-1} data-dialog-initial-focus>{t('chat.musicImageTitle')}</h2></div>
          <button className="music-image-close" type="button" onClick={onClose} aria-label={t('common.close')}>×</button>
        </header>
        <div className="music-image-body">
          <input ref={inputRef} className="music-image-input-native" type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} />
          {!file ? (
            <button type="button" className="music-image-file-button" onClick={() => inputRef.current?.click()}>
              <span aria-hidden="true">＋</span>{t('chat.musicImageChooseFile')}
            </button>
          ) : (
            <div className="music-image-preview-wrap">
              <img className="music-image-preview" src={previewUrl} alt={t('chat.musicImagePreviewAlt')} />
              <button type="button" className="music-image-remove" onClick={clearFile}>{t('chat.musicImageRemove')}</button>
            </div>
          )}
          {error ? <p className="music-image-message" role="status">{error}</p> : null}
          {candidates?.length ? (
            <div className="music-image-candidates" aria-label={t('chat.musicImageCandidates')}>
              {candidates.map((candidate, index) => (
                <button type="button" key={`${candidate.artist}-${candidate.title}-${index}`} className="music-image-candidate" aria-pressed={selected === index} onClick={() => chooseCandidate(candidate, index)}>
                  <strong>{candidate.title}</strong><span>{candidate.artist || t('chat.musicImageArtistUnknown')}</span>
                  {candidate.uncertain ? <small>{t('chat.musicImageUncertain')}</small> : null}
                </button>
              ))}
            </div>
          ) : null}
          {selected !== null ? (
            <div className="music-image-edit">
              <label>{t('chat.musicImageArtist')}<input value={artist} maxLength={120} onChange={event => { setArtist(event.target.value); setError(''); }} /></label>
              <label>{t('chat.musicImageTrack')}<input value={title} maxLength={180} onChange={event => { setTitle(event.target.value); setError(''); }} /></label>
            </div>
          ) : null}
        </div>
        <footer className="music-image-footer">
          <button type="button" className="music-image-secondary" onClick={onClose}>{t('common.close')}</button>
          {candidates === null ? (
            <div className="music-image-footer-action">
              {file ? <p className="music-image-disclosure">{t('chat.musicImageDisclosure')}</p> : null}
              <button type="button" className="music-image-primary" disabled={!file || busy} onClick={() => void recognize()}>
                {busy ? t('chat.musicImageLoading') : t('chat.musicImageRecognize')}
              </button>
            </div>
          ) : candidates.length === 0 ? (
            <button type="button" className="music-image-primary" onClick={() => inputRef.current?.click()}>{t('chat.musicImageChooseAnother')}</button>
          ) : (
            <button type="button" className="music-image-primary" disabled={selected === null} onClick={commit}>{t('chat.musicImageCommit')}</button>
          )}
        </footer>
      </section>
    </div>, document.body
  );
};

export function MusicImagePicker({ onChoose }: Props) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="music-image-launch" aria-label={t('chat.musicImageLaunch')} onClick={() => setOpen(true)} data-music-image-launch>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13Zm2 .5v10l3.5-3.5 2.5 2.5 2-2 4 4V6H6Zm3 1a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z" /></svg>
      <span>{t('chat.musicImageLaunch')}</span>
    </button>
    {open ? <MusicImageDialog onClose={() => setOpen(false)} onChoose={candidate => { onChoose(candidate); setOpen(false); }} /> : null}
  </>;
}
