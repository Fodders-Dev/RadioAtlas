import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent
} from 'react';
import { createPortal } from 'react-dom';
import { useDialog } from '../lib/useDialog';
import { getProxiedAssetUrl } from '../lib/assetUrl';
import {
  postChatMessage,
  type ChatHistoryTurn,
  type ChatServiceLink,
  type ChatSource,
  type ChatStationRef,
  type ChatUserTaste
} from '../lib/aiChat';
import { useLocale } from '../state/LocaleContext';
import { useCatalog } from '../state/CatalogContext';
import { useLibrary, usePlayback } from '../state/RadioContext';
import { withFavoriteTasteBoosts, type TasteProfileV2 } from '../lib/tasteProfile';
import './ChatSheet.css';

type ChatMessage = {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  stations?: ChatStationRef[];
  serviceLinks?: ChatServiceLink[];
  sources?: ChatSource[];
};

type ChatSheetProps = { open: boolean; onClose: () => void };

const HISTORY_LIMIT = 10;
const TASTE_SCORE_LIMIT = 24;
const FAVORITE_ID_LIMIT = 60;
const RECENT_ID_LIMIT = 30;
const AVOID_ID_LIMIT = 80;
const LAST_RECOMMENDED_ID_LIMIT = 20;
const NEGATIVE_STATION_SCORE_THRESHOLD = -4;

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
  const { playStation } = usePlayback();
  const { favorites, recent, tasteProfile } = useLibrary();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);
  const titleId = useId();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  useDialog(rootRef, { isOpen: open, onClose });

  // Keep the latest message in view as the thread grows / typing toggles.
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending]);

  const nextId = () => {
    idRef.current += 1;
    return idRef.current;
  };

  const playVerified = async (stationuuid: string) => {
    // Defence in depth: re-verify the station against the catalog before
    // playing, so a stale/edge ref never starts a dead stream.
    const station = await fetchStationById(stationuuid).catch(() => null);
    if (station && station.url_resolved) {
      playStation(station, { sourceId: 'assistant', sourceLabel: t('chat.sourceLabel') });
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const history: ChatHistoryTurn[] = messages
      .slice(-HISTORY_LIMIT)
      .map((message) => ({ role: message.role, text: message.text }));
    const userTaste = buildChatUserTaste(tasteProfile, favorites, recent, messages);
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    setInput('');
    setSending(true);
    try {
      const response = await postChatMessage(text, history, { userTaste });
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: 'assistant',
          text: response.reply,
          stations: response.stations,
          serviceLinks: response.serviceLinks,
          sources: response.sources
        }
      ]);
      // The brain marks the lead station for autoplay on an explicit "включи".
      const playAction = response.actions.find((action) => action.kind === 'play');
      if (playAction?.stationuuid) void playVerified(playAction.stationuuid);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: 'assistant', text: t('chat.error') }
      ]);
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send();
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={rootRef}
      className="bottom-sheet chat-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-chat-sheet
    >
      <button
        className="bottom-sheet-scrim"
        type="button"
        onClick={onClose}
        aria-label={t('common.close')}
        tabIndex={-1}
      />
      <div className="bottom-sheet-card chat-sheet-card">
        <div className="bottom-sheet-handle" aria-hidden="true" />
        <div className="bottom-sheet-head">
          <div>
            <div className="bottom-sheet-kicker">{t('chat.kicker')}</div>
            <div className="bottom-sheet-title" id={titleId}>
              {t('chat.title')}
            </div>
          </div>
          <button
            className="bottom-sheet-close"
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4Z" />
            </svg>
          </button>
        </div>

        <div
          className="chat-sheet-thread"
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {messages.length === 0 ? (
            <div className="chat-bubble chat-bubble--assistant chat-bubble--intro">
              {t('chat.greeting')}
            </div>
          ) : null}
          {messages.map((message) => (
            <div key={message.id} className={`chat-row chat-row--${message.role}`}>
              {/* Plain text only — the Mini App surface returns plain (un-
                  escaped) text, so React's auto-escaping is the XSS guard.
                  white-space: pre-wrap (CSS) preserves the model's line breaks. */}
              <div className={`chat-bubble chat-bubble--${message.role}`}>{message.text}</div>
              {message.stations && message.stations.length ? (
                <div className="chat-station-list">
                  {message.stations.map((station) => (
                    <button
                      key={station.stationuuid}
                      className="chat-station-card"
                      type="button"
                      onClick={() => void playVerified(station.stationuuid)}
                      aria-label={t('chat.playStation', { name: station.name })}
                    >
                      <span
                        className="chat-station-art"
                        style={
                          {
                            '--art': getProxiedAssetUrl(station.favicon)
                              ? `url(${JSON.stringify(getProxiedAssetUrl(station.favicon))})`
                              : 'none'
                          } as CSSProperties
                        }
                        aria-hidden="true"
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
                        ▶
                      </span>
                    </button>
                  ))}
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
                      {link.label}
                    </a>
                  ))}
                </div>
              ) : null}
              {message.sources && message.sources.length ? (
                <div className="chat-source-row">
                  {message.sources.map((source, index) => (
                    <a
                      key={`${message.id}-source-${index}`}
                      className="chat-source-chip"
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={source.title}
                    >
                      🔗 {source.title}
                    </a>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
          {sending ? (
            <div className="chat-row chat-row--assistant">
              <div className="chat-bubble chat-bubble--assistant chat-bubble--typing">
                {t('chat.thinking')}
              </div>
            </div>
          ) : null}
        </div>

        <form className="chat-sheet-input" onSubmit={onSubmit}>
          <textarea
            className="chat-input-field"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t('chat.placeholder')}
            rows={1}
            aria-label={t('chat.placeholder')}
          />
          <button
            className="chat-send-btn"
            type="submit"
            disabled={!input.trim() || sending}
            aria-label={t('chat.send')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 11 21 3l-8 18-2.5-7.5L3 11Z" />
            </svg>
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
};
