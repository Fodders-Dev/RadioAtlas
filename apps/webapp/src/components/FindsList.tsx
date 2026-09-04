import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildMusicServiceLinks, type MusicServiceId } from '../lib/musicServiceLinks';
import { filterFinds, groupFinds, monthGroupLabel, type FindGroup } from '../lib/findGroups';
import { readPreferredMusicService, writePreferredMusicService } from '../lib/preferredMusicService';
import { openLinkOrFallback, triggerHaptic } from '../lib/telegram';
import { useDialog } from '../lib/useDialog';
import { useLocale } from '../state/LocaleContext';
import type { TrackHistoryItem } from '../state/radio/types';

/**
 * «Находки» — the saved finds, and the screen that gives them a life after air.
 *
 * Shape decided with the owner against mockups at 390x844 before any code:
 *
 *  - ONE page scroll. The previous version put the list in a
 *    `max-height: min(420px, 55vh); overflow: auto` box, so finds scrolled
 *    inside a page that also scrolled.
 *  - Search is PERMANENT, not revealed past some count. A screen that grows a
 *    new control at the fifteenth find is a screen that behaves differently for
 *    reasons the person cannot see.
 *  - Time headings coarsen with age (today, yesterday, this week, then months)
 *    so two hundred finds do not become a second wall made of dates.
 *  - The row is for READING; leaving the app is one explicit 44x44 control that
 *    names where it goes. The whole row was the other candidate and was
 *    rejected: a 362x60 target whose only job is to leave RadioAtlas, sitting
 *    in a list you scroll with a thumb, and leaving can kill the stream.
 *  - Delete lives behind «⋮» and asks. Undo would be kinder, but it needs an
 *    actionable snackbar this app does not have, and building one for a
 *    secondary action is not what this lane is for.
 */

type FindsListProps = {
  finds: TrackHistoryItem[];
  onRemove: (id: string) => void;
};

/** Two letters is enough to tell six services apart, and owes nobody a licence. */
const SERVICE_MONOGRAM: Record<MusicServiceId, string> = {
  yandex: 'ЯМ',
  zvuk: 'ЗВ',
  vk: 'VK',
  spotify: 'SP',
  soundcloud: 'SC',
  youtube: 'YT'
};

const KebabGlyph = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="19" r="1.8" />
  </svg>
);

/** A portal'd overlay. Same idiom as the station dialogs — scrim, focus trap,
 *  and `document.body` so nothing inside the library's stacking context clips
 *  it and no fixed dock covers it. */
const FindOverlay = ({
  title,
  subtitle,
  onClose,
  children,
  testid
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  testid: string;
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  useDialog(rootRef, { isOpen: true, onClose });
  const { t } = useLocale();
  return createPortal(
    <div className="finds-overlay" role="dialog" aria-modal="true" ref={rootRef} data-testid={testid}>
      <button
        className="finds-overlay-scrim"
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        data-dialog-backdrop
      />
      <div className="finds-overlay-card">
        <div className="finds-overlay-head">
          <div className="finds-overlay-title">{title}</div>
          {subtitle ? <div className="finds-overlay-sub">{subtitle}</div> : null}
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
};

export const FindsList = ({ finds, onRemove }: FindsListProps) => {
  const { t, locale } = useLocale();
  const [query, setQuery] = useState('');
  const [preferred, setPreferred] = useState<MusicServiceId | null>(null);
  // Which find is waiting on a service choice, and whether that choice is a
  // one-off («открыть в другом сервисе») or the first-ever pick that gets kept.
  const [picking, setPicking] = useState<{ find: TrackHistoryItem; remember: boolean } | null>(null);
  const [menuFor, setMenuFor] = useState<TrackHistoryItem | null>(null);
  const [confirming, setConfirming] = useState<TrackHistoryItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Read once on mount rather than during render: `localStorage` can throw, and
  // a render that throws in a private window would take the whole tab down.
  useEffect(() => {
    setPreferred(readPreferredMusicService());
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const searching = query.trim().length > 0;
  const matches = useMemo(() => filterFinds(finds, query), [finds, query]);
  // ⚠ `Date.now()` is read ONCE per render pass and handed in, so every row in
  // one paint is grouped against the same instant. Reading the clock per item
  // would let a find cross midnight halfway down the list.
  const groups: FindGroup[] = useMemo(
    () => (searching ? [] : groupFinds(matches, Date.now())),
    [matches, searching]
  );

  const groupTitle = (group: FindGroup) => {
    if (group.key === 'today') return t('finds.groups.today');
    if (group.key === 'yesterday') return t('finds.groups.yesterday');
    if (group.key === 'week') return t('finds.groups.week');
    return monthGroupLabel(group.monthStart || 0, Date.now(), locale);
  };

  /**
   * How much of the moment a row has to repeat.
   *
   * ⚠ Under «СЕГОДНЯ», printing «4 сент., 23:36» says the same thing twice —
   * the heading already fixed the day. So a row carries only what its heading
   * does not: the clock under today/yesterday, the date under the coarser
   * buckets. Search results get the full date, because a flat result list has
   * no heading to lean on.
   */
  const rowTime = (at: number, scope: 'time' | 'date') =>
    new Date(at).toLocaleString(
      locale,
      scope === 'time'
        ? { hour: '2-digit', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    );

  const openIn = (find: TrackHistoryItem, service: MusicServiceId) => {
    const link = buildMusicServiceLinks(find.track).find((item) => item.service === service);
    if (!link) {
      // `cleanTrackQuery` refused the title — station advertising, a placeholder.
      // Say so instead of opening a search for nothing.
      setNotice(t('finds.notSearchable'));
      return;
    }
    triggerHaptic();
    openLinkOrFallback(link.url);
  };

  const chooseService = (service: MusicServiceId) => {
    const pending = picking;
    setPicking(null);
    if (!pending) return;
    // Remember ONLY the first-ever pick. «Открыть в другом сервисе» is a one-off
    // by the owner's decision: moving the default silently would make a single
    // curious tap redefine every future tap.
    if (pending.remember) {
      writePreferredMusicService(service);
      setPreferred(service);
    }
    openIn(pending.find, service);
  };

  const onServiceButton = (find: TrackHistoryItem) => {
    if (preferred) {
      openIn(find, preferred);
      return;
    }
    setPicking({ find, remember: true });
  };

  const copyFind = async (find: TrackHistoryItem) => {
    setMenuFor(null);
    // ⚠ The defect this replaces: `onClick={() => navigator.clipboard.writeText(...)}`
    // with no await, no catch and no feedback — not even on success. The same
    // class of silent failure 0.1a fixed on the catch itself.
    try {
      await navigator.clipboard.writeText(find.track);
      setNotice(t('finds.copied'));
    } catch {
      setNotice(t('finds.copyFailed'));
    }
  };

  const confirmRemove = () => {
    const target = confirming;
    setConfirming(null);
    if (!target) return;
    onRemove(target.id);
    setNotice(t('finds.removed'));
  };

  const renderRow = (find: TrackHistoryItem, scope: 'time' | 'date' = 'date') => (
    <div className="find-row" key={find.id} data-find-row={find.id}>
      <div className="find-row-body">
        <div className="find-row-track" title={find.track}>
          {find.track}
        </div>
        <div className="find-row-source">
          {find.stationName} · {rowTime(find.timestamp, scope)}
        </div>
      </div>
      <button
        className="find-row-service"
        type="button"
        data-find-service
        onClick={() => onServiceButton(find)}
        aria-label={
          preferred
            ? t('finds.openInNamed', { service: t(`finds.services.${preferred}`) })
            : t('finds.chooseService')
        }
      >
        <span aria-hidden="true">{preferred ? SERVICE_MONOGRAM[preferred] : '♪'}</span>
      </button>
      <button
        className="find-row-more"
        type="button"
        data-find-more
        onClick={() => setMenuFor(find)}
        aria-label={t('finds.moreFor', { track: find.track })}
      >
        <KebabGlyph />
      </button>
    </div>
  );

  return (
    <div className="finds-surface">
      <label className="finds-search">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('finds.searchPlaceholder')}
          aria-label={t('finds.searchPlaceholder')}
          data-finds-search
        />
      </label>

      {notice ? (
        <div className="library-inline-toast" role="status">
          {notice}
        </div>
      ) : null}

      {matches.length === 0 ? (
        <div className="empty-state library-empty-state">
          <div className="library-empty-title">
            {searching ? t('finds.searchEmpty') : t('finds.empty')}
          </div>
          {searching ? null : (
            <div className="section-subtitle">{t('finds.emptyHint')}</div>
          )}
        </div>
      ) : searching ? (
        // Searching flattens the list: a result set has no useful relationship
        // to «вчера», and headings over three scattered matches are furniture.
        <div className="finds-list" data-finds-list>
          {/* Flat results carry the full date: there is no heading above them
              to say when, which is exactly why the scope differs here. */}
          {matches.map((item) => renderRow(item, 'date'))}
        </div>
      ) : (
        <div className="finds-list" data-finds-list>
          {groups.map((group) => (
            <div className="finds-group" key={group.id}>
              <div className="finds-group-head">
                <span>{groupTitle(group)}</span>
                <span className="finds-group-count">{group.items.length}</span>
              </div>
              {group.items.map((item) =>
                renderRow(item, group.key === 'today' || group.key === 'yesterday' ? 'time' : 'date')
              )}
            </div>
          ))}
        </div>
      )}

      {picking ? (
        <FindOverlay
          testid="finds-service-picker"
          title={
            picking.remember
              ? t('finds.pickerTitle')
              : preferred
                ? t('finds.pickerOtherTitle')
                : t('finds.openInService')
          }
          subtitle={picking.remember ? t('finds.pickerHint') : undefined}
          onClose={() => setPicking(null)}
        >
          <div className="finds-overlay-list">
            {buildMusicServiceLinks(picking.find.track).map((link) => (
              <button
                key={link.service}
                className="finds-overlay-option"
                type="button"
                data-find-service-option={link.service}
                onClick={() => chooseService(link.service)}
              >
                <span className="finds-overlay-mono" aria-hidden="true">
                  {SERVICE_MONOGRAM[link.service]}
                </span>
                <span>{link.label}</span>
              </button>
            ))}
          </div>
        </FindOverlay>
      ) : null}

      {menuFor ? (
        <FindOverlay
          testid="finds-row-menu"
          title={menuFor.track}
          subtitle={`${menuFor.stationName} · ${rowTime(menuFor.timestamp, 'date')}`}
          onClose={() => setMenuFor(null)}
        >
          <div className="finds-overlay-list">
            <button
              className="finds-overlay-item"
              type="button"
              data-find-open-other
              onClick={() => {
                const find = menuFor;
                setMenuFor(null);
                setPicking({ find, remember: false });
              }}
            >
              {/* Before the first pick there is no «main» service, so «открыть
                  в ДРУГОМ» would be naming something that does not exist. */}
              {preferred ? t('finds.openInOther') : t('finds.openInService')}
            </button>
            <button
              className="finds-overlay-item"
              type="button"
              data-find-copy
              onClick={() => void copyFind(menuFor)}
            >
              {t('common.copy')}
            </button>
            <button
              className="finds-overlay-item danger"
              type="button"
              data-find-delete
              onClick={() => {
                const find = menuFor;
                setMenuFor(null);
                setConfirming(find);
              }}
            >
              {/* `common.remove` is «Убрать» — softer than what this does. A
                  find is deleted, and the word has to say so. */}
              {t('finds.delete')}
            </button>
          </div>
        </FindOverlay>
      ) : null}

      {confirming ? (
        <FindOverlay
          testid="finds-delete-confirm"
          title={t('finds.deleteTitle')}
          subtitle={confirming.track}
          onClose={() => setConfirming(null)}
        >
          <div className="finds-confirm-actions">
            <button
              className="finds-confirm-btn"
              type="button"
              data-find-delete-cancel
              onClick={() => setConfirming(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              className="finds-confirm-btn danger"
              type="button"
              data-find-delete-confirm
              onClick={confirmRemove}
            >
              {t('finds.delete')}
            </button>
          </div>
        </FindOverlay>
      ) : null}
    </div>
  );
};
