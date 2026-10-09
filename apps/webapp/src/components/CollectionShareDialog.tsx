import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { UserCollection, CollectionShare } from '../domain/contracts';
import { buildCollectionShareUrl, rememberCollectionShareState } from '../lib/collectionShare';
import { useLocale } from '../state/LocaleContext';
import { useSession } from '../state/SessionContext';
import { useDialog } from '../lib/useDialog';
import './CollectionShareDialog.css';

type Props = {
  collection: UserCollection;
  open: boolean;
  onClose: () => void;
  onLogin: () => void;
};

export const CollectionShareDialog = ({ collection, open, onClose, onLogin }: Props) => {
  const { t } = useLocale();
  const { status, profile, getCollectionShare, publishCollectionShare, revokeCollectionShare } = useSession();
  const [share, setShare] = useState<CollectionShare | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const operationSequenceRef = useRef(0);
  useDialog(rootRef, { isOpen: open, onClose });

  useEffect(() => {
    const sequence = ++operationSequenceRef.current;
    if (!open || status !== 'authenticated') {
      setShare(null);
      setBusy(false);
      setLoading(false);
      setError(null);
      setNotice(null);
      return;
    }
    let active = true;
    setShare(null);
    setBusy(false);
    setLoading(true);
    setError(null);
    setNotice(null);
    void getCollectionShare(collection.id)
      .then((loaded) => {
        if (active && operationSequenceRef.current === sequence) {
          setShare(loaded);
          if (profile?.id) rememberCollectionShareState(profile.id, collection.id, Boolean(loaded));
        }
      })
      .catch(() => {
        if (active && operationSequenceRef.current === sequence) setError(t('collectionShare.loadError'));
      })
      .finally(() => {
        if (active && operationSequenceRef.current === sequence) setLoading(false);
      });
    return () => {
      active = false;
      if (operationSequenceRef.current === sequence) operationSequenceRef.current += 1;
    };
  }, [collection.id, getCollectionShare, open, profile?.id, status, t]);

  useEffect(() => {
    if (!open) {
      operationSequenceRef.current += 1;
      setNotice(null);
      setError(null);
    }
  }, [open]);

  if (!open || typeof document === 'undefined') return null;
  const shareUrl = share && typeof window !== 'undefined'
    ? buildCollectionShareUrl(share.token, window.location.origin)
    : '';

  const reload = async () => {
    if (status !== 'authenticated') return;
    const sequence = ++operationSequenceRef.current;
    setLoading(true);
    setError(null);
    try {
      const loaded = await getCollectionShare(collection.id);
      if (operationSequenceRef.current !== sequence || !open || status !== 'authenticated') return;
      setShare(loaded);
      if (profile?.id) rememberCollectionShareState(profile.id, collection.id, Boolean(loaded));
    } catch {
      if (operationSequenceRef.current === sequence && open && status === 'authenticated') setError(t('collectionShare.loadError'));
    } finally {
      if (operationSequenceRef.current === sequence) setLoading(false);
    }
  };

  const publish = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const sequence = ++operationSequenceRef.current;
    const accountId = profile?.id;
    try {
      const published = await publishCollectionShare(collection);
      if (sequence !== operationSequenceRef.current || !open || status !== 'authenticated' || profile?.id !== accountId) return;
      setShare(published);
      if (accountId) rememberCollectionShareState(accountId, collection.id, true);
      setNotice(t('collectionShare.published'));
    } catch {
      if (sequence === operationSequenceRef.current && open && status === 'authenticated' && profile?.id === accountId) {
        setError(t('collectionShare.publishError'));
      }
    } finally {
      if (sequence === operationSequenceRef.current) setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!shareUrl) return;
    setNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(shareUrl);
      setNotice(t('collectionShare.copied'));
    } catch {
      urlRef.current?.focus();
      urlRef.current?.select();
      setNotice(t('collectionShare.selectToCopy'));
    }
  };

  const nativeShare = async () => {
    if (!shareUrl || typeof navigator.share !== 'function') return;
    try {
      await navigator.share({ title: collection.name, url: shareUrl });
    } catch (reason) {
      if (typeof reason === 'object' && reason !== null && 'name' in reason && reason.name === 'AbortError') return;
      setError(t('collectionShare.nativeShareError'));
    }
  };

  const revoke = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const sequence = ++operationSequenceRef.current;
    const accountId = profile?.id;
    try {
      await revokeCollectionShare(collection.id);
      if (sequence !== operationSequenceRef.current || !open || status !== 'authenticated' || profile?.id !== accountId) return;
      setShare(null);
      if (accountId) rememberCollectionShareState(accountId, collection.id, false);
      setNotice(t('collectionShare.revoked'));
    } catch {
      if (sequence === operationSequenceRef.current && open && status === 'authenticated' && profile?.id === accountId) {
        setError(t('collectionShare.revokeError'));
      }
    } finally {
      if (sequence === operationSequenceRef.current) setBusy(false);
    }
  };

  return createPortal(
    <div ref={rootRef} className="collection-share-backdrop" data-dialog-backdrop role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        className="collection-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-share-title"
      >
        <header className="collection-share-header">
          <div>
            <p className="collection-share-eyebrow">{t('collectionShare.eyebrow')}</p>
            <h2 id="collection-share-title">{t('collectionShare.title')}</h2>
            <p className="collection-share-name">{collection.name}</p>
          </div>
          <button type="button" className="collection-share-close" data-dialog-initial-focus onClick={onClose} aria-label={t('common.close')}>×</button>
        </header>

        <p className="collection-share-explainer">{t('collectionShare.explainer')}</p>
        {status !== 'authenticated' ? (
          <div className="collection-share-login">
            <p>{t('collectionShare.loginRequired')}</p>
            <button type="button" className="collection-share-primary" onClick={onLogin}>
              {t('collectionShare.login')}
            </button>
          </div>
        ) : loading ? (
          <p className="collection-share-status" role="status">{t('collectionShare.loading')}</p>
        ) : error && !share ? (
          <div className="collection-share-status" role="alert">
            <p>{error}</p>
            <button type="button" className="collection-share-secondary" onClick={() => void reload()}>{t('common.retry')}</button>
          </div>
        ) : share ? (
          <>
            <label className="collection-share-link-label" htmlFor="collection-share-link">{t('collectionShare.link')}</label>
            <input
              id="collection-share-link"
              ref={urlRef}
              className="collection-share-link"
              value={shareUrl}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
            />
            <div className="collection-share-actions">
              <button type="button" className="collection-share-primary" onClick={() => void copyLink()}>{t('collectionShare.copy')}</button>
              {typeof navigator.share === 'function' ? (
                <button type="button" className="collection-share-secondary" onClick={() => void nativeShare()}>{t('collectionShare.native')}</button>
              ) : null}
            </div>
            <p className="collection-share-snapshot">{t('collectionShare.snapshotHint')}</p>
            <div className="collection-share-footer-actions">
              <button type="button" className="collection-share-secondary" disabled={busy} onClick={() => void publish()}>
                {busy ? t('collectionShare.working') : t('collectionShare.update')}
              </button>
              <button type="button" className="collection-share-danger" disabled={busy} onClick={() => void revoke()}>
                {t('collectionShare.revoke')}
              </button>
            </div>
          </>
        ) : (
          <div className="collection-share-publish">
            <p>{t('collectionShare.noLink')}</p>
            <button type="button" className="collection-share-primary" disabled={busy} onClick={() => void publish()}>
              {busy ? t('collectionShare.working') : t('collectionShare.publish')}
            </button>
          </div>
        )}
        {error && share ? <p className="collection-share-error" role="alert">{error}</p> : null}
        {notice ? <p className="collection-share-notice" role="status">{notice}</p> : null}
      </section>
    </div>,
    document.body
  );
};
