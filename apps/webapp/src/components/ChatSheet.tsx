import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent
} from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../lib/useDialog';
import { getProxiedAssetUrl } from '../lib/assetUrl';
import { StationArtwork } from './StationArtwork';
import type { StationLite } from '../types';
import {
  postChatMessage,
  type ChatHistoryTurn,
  type ChatActionReceipt,
  type ChatServiceLink,
  type ChatSource,
  type ChatStationRef,
  type ChatUserTaste
} from '../lib/aiChat';
import { executeAgentActions } from '../lib/agentActions';
import { useLocale } from '../state/LocaleContext';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary, usePlayback } from '../state/RadioContext';
import { triggerHaptic, triggerSelectionHaptic } from '../lib/telegram';
import { withFavoriteTasteBoosts, type TasteProfileV2 } from '../lib/tasteProfile';
import { LiraMark } from './LiraMark';
import './ChatSheet.css';

type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /** A local transport failure, NOT something Лира said. Never sent back as
      history (the model was literally being told it had apologised for a network
      error) and never persisted; carries the draft so the user can retry. */
  errorFor?: string;
  stations?: ChatStationRef[];
  serviceLinks?: ChatServiceLink[];
  sources?: ChatSource[];
  actionReceipts?: ChatActionReceipt[];
};

type ChatSheetProps = { open: boolean; onClose: () => void };

import { pickChatPrompts, type ChatPromptSpec } from '../lib/chatPrompts';

const HISTORY_LIMIT = 10;
const STORED_MESSAGE_LIMIT = 40;
const CHAT_STORAGE_KEY = 'radio:lira-thread:v1';
const TASTE_SCORE_LIMIT = 24;
const FAVORITE_ID_LIMIT = 60;
const RECENT_ID_LIMIT = 30;
const AVOID_ID_LIMIT = 80;
const LAST_RECOMMENDED_ID_LIMIT = 20;
const NEGATIVE_STATION_SCORE_THRESHOLD = -4;



const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

const readStoredMessages = (): ChatMessage[] => {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) =>
          isRecord(item) &&
          (item.role === 'user' || item.role === 'assistant') &&
          typeof item.text === 'string' &&
          item.text.trim()
      )
      .slice(-STORED_MESSAGE_LIMIT)
      .map((item, index) => ({
        id: typeof item.id === 'number' && Number.isFinite(item.id) ? item.id : Date.now() + index,
        role: item.role as ChatMessage['role'],
        text: String(item.text).slice(0, 12_000),
        stations: Array.isArray(item.stations) ? (item.stations as ChatStationRef[]) : undefined,
        serviceLinks: Array.isArray(item.serviceLinks)
          ? (item.serviceLinks as ChatServiceLink[])
          : undefined,
        sources: Array.isArray(item.sources) ? (item.sources as ChatSource[]) : undefined,
        actionReceipts: Array.isArray(item.actionReceipts)
          ? (item.actionReceipts as ChatActionReceipt[])
          : undefined
      }));
  } catch {
    return [];
  }
};

const sourceHost = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const compactScoreMap = (scores: Record<string, number> | null | undefined) =>
  Object.fromEntries(
    Object.entries(scores || {})
      .filter(([key, value]) => key.trim() && Number.isFinite(value) && Math.abs(value) >= 0.05)
      .sort((left, right) => Math.abs(right[1]) - Math.abs(left[1]) || left[0].localeCompare(right[0]))
      .slice(0, TASTE_SCORE_LIMIT)
  );

const buildChatUserTaste = (
  tasteProfile: TasteProfileV2,
  favorites: ReturnType<typeof useLibrary>['favorites'],
  recent: ReturnType<typeof useLibrary>['recent'],
  messages: ChatMessage[]
): ChatUserTaste | undefined => {
  const effectiveTaste = withFavoriteTasteBoosts(tasteProfile, favorites);
  const favoriteStationIds = favorites
    .map((station) => station.stationuuid)
    .filter(Boolean)
    .slice(0, FAVORITE_ID_LIMIT);
  const recentStationIds = recent
    .map((station) => station.stationuuid)
    .filter(Boolean)
    .slice(0, RECENT_ID_LIMIT);
  const hiddenStationIds = (effectiveTaste.hiddenStationIds || []).filter(Boolean).slice(0, AVOID_ID_LIMIT);
  const negativeStationIds = Object.entries(effectiveTaste.stationScores || {})
    .filter(([stationId, score]) => stationId && Number.isFinite(score) && score <= NEGATIVE_STATION_SCORE_THRESHOLD)
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([stationId]) => stationId)
    .slice(0, AVOID_ID_LIMIT);
  const lastRecommendedStationIds = messages
    .slice()
    .reverse()
    .flatMap((message) => message.stations || [])
    .map((station) => station.stationuuid)
    .filter((stationId, index, all) => Boolean(stationId) && all.indexOf(stationId) === index)
    .slice(0, LAST_RECOMMENDED_ID_LIMIT);
  const stationScores = compactScoreMap(effectiveTaste.stationScores);
  const tagScores = compactScoreMap(effectiveTaste.tagScores);
  const countryScores = compactScoreMap(effectiveTaste.countryScores);
  const languageScores = compactScoreMap(effectiveTaste.languageScores);
  if (
    !favoriteStationIds.length &&
    !recentStationIds.length &&
    !hiddenStationIds.length &&
    !negativeStationIds.length &&
    !lastRecommendedStationIds.length &&
    !Object.keys(stationScores).length &&
    !Object.keys(tagScores).length &&
    !Object.keys(countryScores).length &&
    !Object.keys(languageScores).length
  ) {
    return undefined;
  }
  return {
    favoriteStationIds,
    recentStationIds,
    hiddenStationIds,
    negativeStationIds,
    lastRecommendedStationIds,
    stationScores,
    tagScores,
    countryScores,
    languageScores
  };
};

export const ChatSheet = ({ open, onClose }: ChatSheetProps) => {
  const { t } = useLocale();
  const { fetchStationById } = useCatalog();
  const { player, queue, nowPlaying, playStation } = usePlayback();
  const { favorites, recent, tasteProfile, toggleFavorite, isFavorite } = useLibrary();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef(Date.now());
  const titleId = useId();
  const inputId = useId();
  const [messages, setMessages] = useState<ChatMessage[]>(readStoredMessages);

  // Advance the rotation each time the welcome screen appears, NOT each render:
  // chips that reshuffle under a finger are worse than chips that repeat.
  const promptSeedRef = useRef(0);
  const welcomeVisible = open && messages.length === 0;
  useEffect(() => {
    if (welcomeVisible) promptSeedRef.current += 1;
  }, [welcomeVisible]);
  const quickPrompts = useMemo(
    () =>
      pickChatPrompts({
        seed: promptSeedRef.current,
        hour: new Date().getHours(),
        station: player.current?.name?.trim() || undefined,
        track: nowPlaying?.trim() || undefined
      }),
    [welcomeVisible, player.current?.stationuuid, nowPlaying]
  );
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  useDialog(rootRef, { isOpen: open, onClose });

  // Scroll so the newest turn STARTS at the top of the view, not so the thread
  // ends at the bottom. Pinning scrollTop to scrollHeight meant a long answer
  // (the API caps replies at 3500 chars ≈ 2.8 screens) opened on its LAST line —
  // measured at 390x844, the first line of a full-length reply sat 1506px above
  // the viewport, so every good answer had to be scrolled UP to be read.
  //
  // A short answer that fits below the question changes nothing (the clamp keeps
  // it at the bottom); only replies taller than the view are re-anchored.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = list.querySelectorAll<HTMLElement>('.chat-row');
    const latest = rows[rows.length - 1];
    const target = latest
      ? Math.min(latest.offsetTop - list.offsetTop - 8, list.scrollHeight - list.clientHeight)
      : list.scrollHeight;
    list.scrollTop = Math.max(0, target);
  }, [messages, sending]);

  useEffect(() => {
    try {
      if (messages.length) {
        localStorage.setItem(
          CHAT_STORAGE_KEY,
          // A transport error is a local UI state, not part of the conversation:
          // persisting it meant reopening the chat to an apology Лира never made.
          JSON.stringify(messages.filter((message) => !message.errorFor).slice(-STORED_MESSAGE_LIMIT))
        );
      } else {
        localStorage.removeItem(CHAT_STORAGE_KEY);
      }
    } catch {
      // Private mode / a full storage quota must never make Lira unusable.
    }
  }, [messages]);

  const nextId = () => {
    idRef.current += 1;
    return idRef.current;
  };

  const playVerified = async (stationuuid: string) => {
    const station = await fetchStationById(stationuuid).catch(() => null);
    if (station && station.url_resolved) {
      playStation(station, { sourceId: 'assistant', sourceLabel: t('chat.sourceLabel') });
    }
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || sending) return;
    const history: ChatHistoryTurn[] = messages
      .filter((message) => !message.errorFor)
      .slice(-HISTORY_LIMIT)
      .map((message) => ({ role: message.role, text: message.text }));
    const userTaste = buildChatUserTaste(tasteProfile, favorites, recent, messages);
    const actionReceipts = messages.flatMap((message) => message.actionReceipts || []).slice(-6);
    const trustedTrack = nowPlaying?.trim();
    const trustedStationName = player.current?.name?.trim();
    // The NAME alone cannot answer "tell me about this station" — the catalogue
    // is keyed by uuid, and names repeat. Sending the id lets Lira look the
    // station up for real instead of describing a string.
    const trustedStationUuid = player.current?.stationuuid?.trim();
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    if (override === undefined) {
      setInput('');
      if (composerRef.current) composerRef.current.style.height = '';
    }
    setSending(true);
    try {
      const response = await postChatMessage(text, history, {
        userTaste,
        agentContext: {
          isPlaying: player.isPlaying,
          queueStationIds: queue.items.map((station) => station.stationuuid).filter(Boolean).slice(0, 80)
        },
        actionReceipts,
        nowPlaying: trustedTrack || trustedStationName || trustedStationUuid
          ? {
              ...(trustedTrack ? { track: trustedTrack.slice(0, 220) } : {}),
              ...(trustedStationName ? { stationName: trustedStationName.slice(0, 120) } : {}),
              ...(trustedStationUuid ? { stationUuid: trustedStationUuid } : {})
            }
          : undefined
      });
      const assistantMessageId = nextId();
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          text: response.reply,
          stations: response.stations,
          serviceLinks: response.serviceLinks,
          sources: response.sources
        }
      ]);
      const receipts = await executeAgentActions(response.actions, {
        resolveStation: (stationuuid) => fetchStationById(stationuuid).catch(() => null),
        play: (station) =>
          playStation(station, { sourceId: 'assistant', sourceLabel: t('chat.sourceLabel') }),
        enqueue: (station) => queue.enqueue(station),
        pause: () => player.pause(),
        isFavorite,
        toggleFavorite
      });
      if (receipts.some((receipt) => receipt.status === 'executed')) triggerHaptic('light');
      if (receipts.length) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessageId ? { ...message, actionReceipts: receipts } : message
          )
        );
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', text: t('chat.error'), errorFor: text }
      ]);
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const onInputChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const startFresh = () => {
    if (!window.confirm(t('chat.clearChatConfirm'))) return;
    triggerSelectionHaptic();
    setMessages([]);
    setInput('');
    if (composerRef.current) composerRef.current.style.height = '';
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={rootRef}
      className="chat-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-chat-sheet
    >
      <button
        className="chat-sheet-scrim"
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        tabIndex={-1}
        data-dialog-backdrop
      />
      <div className="chat-sheet-card">
        <div className="chat-liquid-field" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <header className="chat-sheet-head">
          <div className="chat-identity">
            <span className="chat-lira-orb chat-lira-orb--header" aria-hidden="true">
              <LiraMark />
              <i />
            </span>
            <div className="chat-identity-copy">
              <span className="chat-kicker">{t('chat.kicker')}</span>
              <h1 id={titleId}>{t('chat.title')}</h1>
              <span className="chat-online">
                <i aria-hidden="true" />
                {messages.length ? t('chat.threadSaved') : t('chat.status')}
              </span>
            </div>
          </div>
          <div className="chat-head-actions">
            {messages.length ? (
              <button className="chat-history-btn" type="button" onClick={startFresh}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.72 12H7.72L7 9Zm2.08 2 .48 8h1.5l-.24-8H9.08Zm4.1 0-.24 8h1.5l.48-8h-1.74Z" />
                </svg>
                <span>{t('chat.newChat')}</span>
              </button>
            ) : null}
            <button
              className="chat-close-btn"
              type="button"
              onClick={onClose}
              aria-label={t('common.close')}
              data-dialog-initial-focus
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4Z" />
              </svg>
            </button>
          </div>
        </header>

        <div
          className={`chat-sheet-thread ${messages.length ? 'has-messages' : 'is-empty'}`}
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {messages.length === 0 ? (
            <section className="chat-welcome" aria-labelledby={`${titleId}-welcome`}>
              <div className="chat-welcome-copy">
                <span className="chat-welcome-spark" aria-hidden="true">✦</span>
                <div>
                  <h2 id={`${titleId}-welcome`}>{t('chat.welcomeTitle')}</h2>
                  <p>{t('chat.greeting')}</p>
                </div>
              </div>

              <div className="chat-prompt-grid" aria-label={t('chat.quickPrompts')}>
                {quickPrompts.map((prompt: ChatPromptSpec) => (
                  <button
                    key={prompt.id}
                    className="chat-prompt-card"
                    type="button"
                    onClick={() => {
                      triggerSelectionHaptic();
                      void send(t(prompt.queryKey, prompt.params));
                    }}
                  >
                    <span className="chat-prompt-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24"><path d={prompt.path} /></svg>
                    </span>
                    <span>{t(prompt.labelKey)}</span>
                  </button>
                ))}
              </div>
              <p className="chat-history-note">{t('chat.historyHint')}</p>
            </section>
          ) : null}

          {messages.map((message, messageIndex) => (
            <div key={message.id} className={`chat-row chat-row--${message.role}`}>
              {message.role === 'assistant' ? (
                <span className="chat-lira-orb chat-lira-orb--message" aria-hidden="true">
                  <LiraMark />
                </span>
              ) : null}
              <div className="chat-message-stack">
                <div className={`chat-bubble chat-bubble--${message.role}`}>{message.text}</div>
                {message.actionReceipts?.some((receipt) => receipt.status === 'failed') ? (
                  <p className="chat-action-feedback" role="status">{t('chat.actionFailed')}</p>
                ) : null}
                {message.errorFor ? (
                  <button
                    type="button"
                    className="chat-reject-btn chat-retry-btn"
                    onClick={() => {
                      triggerHaptic('light');
                      // Drop the failed turn AND the question it answered, then
                      // resend that same question — the composer was cleared on
                      // submit, so without this the text was simply lost.
                      const failed = message.errorFor as string;
                      setMessages((prev) => {
                        const index = prev.findIndex((item) => item.id === message.id);
                        if (index < 0) return prev;
                        const start = index > 0 && prev[index - 1]?.role === 'user' ? index - 1 : index;
                        return prev.slice(0, start);
                      });
                      void send(failed);
                    }}
                  >
                    {t('chat.retry')}
                  </button>
                ) : null}
                {message.stations && message.stations.length ? (
                  <div className="chat-station-list">
                    {message.stations.map((station) => (
                      <button
                        key={station.stationuuid}
                        className="chat-station-card"
                        type="button"
                        onClick={() => {
                          triggerHaptic('light');
                          void playVerified(station.stationuuid);
                        }}
                        aria-label={t('chat.playStation', { name: station.name })}
                      >
                        {/* Owner's screenshots: most of Лира's cards were a blank
                            dark square. This surface hand-rolled its own
                            `background-image: var(--art)` — with an empty or 404
                            favicon there was no letter, no palette and no error
                            path, just a hole. Every OTHER station list already
                            uses StationArtwork, which falls back to the station's
                            initial over a deterministic palette and retires
                            broken URLs. */}
                        <StationArtwork
                          station={station as unknown as StationLite}
                          size="sm"
                          className="chat-station-art"
                        />
                        <span className="chat-station-copy">
                          <strong>{station.name}</strong>
                          <small>
                            {[station.country, station.tags.slice(0, 2).join(' · ')]
                              .filter(Boolean)
                              .join(' · ')}
                          </small>
                        </span>
                        <span className="chat-station-play" aria-hidden="true">
                          <svg viewBox="0 0 24 24"><path d="m9 5 8 7-8 7V5Z" /></svg>
                        </span>
                      </button>
                    ))}
                    {messageIndex === messages.length - 1 ? (
                      <button
                        type="button"
                        className="chat-reject-btn"
                        onClick={() => {
                          triggerSelectionHaptic();
                          void send(t('chat.rejectQuery'));
                        }}
                        disabled={sending}
                      >
                        {t('chat.reject')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {message.serviceLinks && message.serviceLinks.length ? (
                  <div className="chat-service-row">
                    {message.serviceLinks.map((link) => (
                      <a
                        key={`${message.id}-${link.service}`}
                        className="chat-service-chip"
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {link.label}<span aria-hidden="true">↗</span>
                      </a>
                    ))}
                  </div>
                ) : null}
                {message.sources && message.sources.length ? (
                  <div className="chat-source-row" aria-label={t('chat.sources')}>
                    {message.sources.map((source, index) => (
                      <a
                        key={`${message.id}-source-${index}`}
                        className="chat-source-chip"
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <span className="chat-source-icon" aria-hidden="true">↗</span>
                        <span className="chat-source-copy">
                          <small>{sourceHost(source.url) || t('chat.source')}</small>
                          <strong>{source.title}</strong>
                        </span>
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {sending ? (
            <div className="chat-row chat-row--assistant">
              <span className="chat-lira-orb chat-lira-orb--message" aria-hidden="true">
                <LiraMark />
              </span>
              <div className="chat-bubble chat-bubble--assistant chat-bubble--typing">
                <span className="visually-hidden">{t('chat.thinking')}</span>
                <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
              </div>
            </div>
          ) : null}
        </div>

        <form className="chat-sheet-input" onSubmit={onSubmit}>
          <div className="chat-composer-glass">
            <label className="visually-hidden" htmlFor={inputId}>{t('chat.placeholder')}</label>
            <textarea
              ref={composerRef}
              id={inputId}
              className="chat-input-field"
              value={input}
              onChange={onInputChange}
              onKeyDown={onInputKeyDown}
              placeholder={t('chat.placeholder')}
              rows={1}
              maxLength={2000}
            />
            <span className="chat-input-spark" aria-hidden="true">✦</span>
          </div>
          <button
            className="chat-send-btn"
            type="submit"
            disabled={!input.trim() || sending}
            aria-label={t('chat.send')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 11 21 3l-8 18-2.5-7.5L3 11Zm7.8 1.1 2 5.85 4.48-10.08-10.1 4.49 3.62-.26Z" />
            </svg>
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
};
