import { stationLocation } from '../lib/stationUtils';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';

export const MiniPlayerDock = () => {
  const { t } = useLocale();
  const {
    player,
    nowPlaying,
    queue,
    playNext,
    playerPresentation,
    setPlayerPresentation,
    setDetailsOpen,
    toggleFavorite,
    isFavorite,
    setActiveSection,
    setLibraryTab,
    winamp
  } = useRadio();

  const current = player.current;
  const liked = current ? isFavorite(current.stationuuid) : false;
  const subtitle = current ? stationLocation(current) : t('dock.emptySubtitle');
  const queueCount = Math.max(queue.items.length, 0);

  if (playerPresentation === 'expanded' && winamp.expanded) {
    return null;
  }

  if (playerPresentation === 'peek') {
    return (
      <div className="player-dock player-dock-peek">
        <button
          className="player-peek-handle"
          type="button"
          onClick={() => setPlayerPresentation('bar')}
        >
          <span className="player-peek-pill" />
          <span>{current ? current.name : t('dock.peekLabel')}</span>
          <span className="player-peek-meta">
            {queueCount ? t('dock.queueCount', { count: queueCount }) : t('dock.peekHint')}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="player-dock player-dock-bar" data-has-station={current ? 'true' : 'false'}>
      <button className="player-dock-collapse" type="button" onClick={() => setPlayerPresentation('peek')}>
        <span />
        <span />
      </button>

      <button
        className="player-dock-meta"
        type="button"
        onClick={() => {
          if (current) {
            setDetailsOpen(true);
          }
        }}
      >
        <div className="player-dock-kicker">{current ? t('dock.liveNow') : t('dock.ready')}</div>
        <div className="player-dock-title">{current?.name || t('dock.emptyTitle')}</div>
        <div className="player-dock-copy">
          {nowPlaying || subtitle}
        </div>
      </button>

      <div className="player-dock-actions">
        <button
          className={`dock-icon-btn ${current && player.isPlaying ? 'active' : ''}`}
          type="button"
          onClick={() => {
            if (current) {
              void player.toggle();
            }
          }}
          disabled={!current}
          aria-label={player.isPlaying ? t('common.pause') : t('common.play')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {player.isPlaying ? (
              <path d="M7 5h4v14H7zm6 0h4v14h-4z" />
            ) : (
              <path d="M8 5v14l11-7z" />
            )}
          </svg>
        </button>
        <button className="dock-icon-btn" type="button" onClick={playNext} aria-label={t('common.next')}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6v12l8.5-6L6 6Zm9 0v12h2V6h-2Z" />
          </svg>
        </button>
        <button
          className={`dock-icon-btn ${liked ? 'active' : ''}`}
          type="button"
          onClick={() => current && toggleFavorite(current)}
          disabled={!current}
          aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
          </svg>
        </button>
        <button
          className="dock-icon-btn"
          type="button"
          onClick={() => {
            setActiveSection('library');
            setLibraryTab('queue');
          }}
          aria-label={t('nav.library')}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5h16v2H4zm0 6h16v2H4zm0 6h10v2H4z" />
          </svg>
        </button>
        <button
          className="dock-expand-btn"
          type="button"
          onClick={() => setPlayerPresentation('expanded')}
        >
          {t('dock.openWinamp')}
        </button>
      </div>
    </div>
  );
};
