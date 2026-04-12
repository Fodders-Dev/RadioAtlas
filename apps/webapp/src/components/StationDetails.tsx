import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import type { StationProfileSummary } from '../domain/contracts';
import { getApiBase } from '../lib/apiBase';
import { stationLocation, stationTags } from '../lib/stationUtils';
import { useLocale } from '../state/LocaleContext';
import { useRadio } from '../state/RadioContext';
import { useSession } from '../state/SessionContext';

type StationDetailsProps = {
  open: boolean;
  onClose: () => void;
};

export const StationDetails = ({ open, onClose }: StationDetailsProps) => {
  const { t } = useLocale();
  const {
    player,
    stations,
    nowPlaying,
    nowPlayingStatus,
    copyTrack,
    toggleFavorite,
    isFavorite,
    shareStation,
    openExternal,
    followedStations,
    toggleFollowStation
  } = useRadio();
  const { status, openAccountSheet } = useSession();
  const current = player.current;
  const liked = current ? isFavorite(current.stationuuid) : false;
  const followed = current
    ? followedStations.some((station) => station.stationId === current.stationuuid)
    : false;
  const [profileSummary, setProfileSummary] = useState<StationProfileSummary | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const full = useMemo(() => {
    if (!current) return null;
    return stations.find((station) => station.stationuuid === current.stationuuid) ?? null;
  }, [stations, current]);

  if (!open || !current) return null;

  const info = full ?? current;
  const location = stationLocation(info);
  const tags = stationTags(info);
  const homepage = full?.homepage;
  const codec = full?.codec;
  const bitrate = full?.bitrate;
  const apiBase = getApiBase();

  useEffect(() => {
    let cancelled = false;
    setProfileSummary(null);
    if (!current || !apiBase) return;
    void (async () => {
      try {
        const response = await fetch(`${apiBase}/stations/${current.stationuuid}/profile`);
        if (!response.ok) return;
        const data = (await response.json()) as { profile?: StationProfileSummary };
        if (!cancelled) {
          setProfileSummary(data.profile || null);
        }
      } catch {
        if (!cancelled) {
          setProfileSummary(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiBase, current?.stationuuid]);

  const handlePlay = () => {
    player.toggle();
  };

  const openHomepage = () => {
    if (!homepage) return;
    const tg = window.Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(homepage);
      return;
    }
    window.open(homepage, '_blank', 'noopener,noreferrer');
  };

  const openLink = (event: MouseEvent<HTMLAnchorElement>, url: string) => {
    event.preventDefault();
    const tg = window.Telegram?.WebApp;
    if (tg?.openLink) {
      tg.openLink(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="details-overlay" role="dialog" aria-modal="true">
      <button
        className="details-backdrop"
        onClick={onClose}
        type="button"
        aria-label={t('details.closeAria')}
      />
      <div className="details-card">
        <div className="details-header">
          <div>
            <div className="details-title">{current.name}</div>
            <div className="details-sub">{location}</div>
          </div>
          <button className="chip" onClick={onClose} type="button">
            {t('details.close')}
          </button>
        </div>

        <div className="details-tags">{tags}</div>

        <div className="details-actions">
          <button className="player-btn primary" onClick={handlePlay} type="button">
            {player.isPlaying ? t('common.pause') : t('common.play')}
          </button>
          {nowPlaying && (
            <button className="player-btn" onClick={copyTrack} type="button">
              {t('details.copyTrack')}
            </button>
          )}
          <button
            className={`icon-btn ${liked ? 'active' : ''}`}
            onClick={() => toggleFavorite(current)}
            type="button"
            aria-label={liked ? t('stationTable.unfavorite') : t('stationTable.favorite')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 21.2l-1.4-1.3C5.4 15.4 2 12.3 2 8.4 2 5.6 4.2 3.5 7 3.5c1.6 0 3.2.7 4.2 2 1-1.3 2.6-2 4.2-2 2.8 0 5 2.1 5 4.9 0 3.9-3.4 7-8.6 11.4L12 21.2z" />
            </svg>
          </button>
          <button className="player-btn" onClick={() => shareStation(current)} type="button">
            {t('common.share')}
          </button>
          <button
            className={`player-btn ${followed ? 'active' : ''}`}
            onClick={() => toggleFollowStation(current)}
            type="button"
          >
            {followed ? t('details.following') : t('details.follow')}
          </button>
          <button className="player-btn" onClick={() => openExternal(current)} type="button">
            {t('common.stream')}
          </button>
          {homepage && (
            <button className="player-btn" onClick={openHomepage} type="button">
              {t('common.site')}
            </button>
          )}
        </div>

        <div className="details-grid">
          {(nowPlaying || nowPlayingStatus === 'unavailable') && (
            <div className="details-row">
              <span>{t('details.nowPlaying')}</span>
              {nowPlaying ? (
                <button
                  className="track-copy"
                  onClick={copyTrack}
                  type="button"
                  title={t('details.openTrackCopy')}
                >
                  {nowPlaying}
                </button>
              ) : (
                <div>{t('common.unavailable')}</div>
              )}
            </div>
          )}
          <div className="details-row">
            <span>{t('details.streamUrl')}</span>
            <a
              className="details-link"
              href={current.url_resolved}
              onClick={(event) => openLink(event, current.url_resolved)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {current.url_resolved}
            </a>
          </div>
          {homepage && (
            <div className="details-row">
              <span>{t('details.homepage')}</span>
              <a
                className="details-link"
                href={homepage}
                onClick={(event) => openLink(event, homepage)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {homepage}
              </a>
            </div>
          )}
          <div className="details-row">
            <span>{t('details.country')}</span>
            <div>{info.country || t('common.unknown')}</div>
          </div>
          <div className="details-row">
            <span>{t('details.region')}</span>
            <div>{info.state || t('details.unknownRegion')}</div>
          </div>
          {codec && (
            <div className="details-row">
              <span>{t('details.codec')}</span>
              <div>{codec}</div>
            </div>
          )}
          {bitrate !== undefined && bitrate !== null && (
            <div className="details-row">
              <span>{t('details.bitrate')}</span>
              <div>{bitrate} kbps</div>
            </div>
          )}
          {profileSummary ? (
            <div className="details-row">
              <span>{t('details.stationProfile')}</span>
              <div>
                {profileSummary.isVerified ? t('stationTable.verified') : profileSummary.ownerAccountId ? t('stationTable.claimed') : t('details.unclaimed')}
              </div>
            </div>
          ) : null}
          {profileSummary?.description ? (
            <div className="details-row">
              <span>{t('details.description')}</span>
              <div>{profileSummary.description}</div>
            </div>
          ) : null}
          {profileSummary?.scheduleNote ? (
            <div className="details-row">
              <span>{t('details.schedule')}</span>
              <div>{profileSummary.scheduleNote}</div>
            </div>
          ) : null}
        </div>
        {status === 'authenticated' && !profileSummary?.ownerAccountId ? (
          <div className="settings-actions">
            <button
              className="chip"
              type="button"
              onClick={() => {
                setClaimError(t('details.claimViaAccount'));
                openAccountSheet();
              }}
            >
              {t('details.claimStation')}
            </button>
          </div>
        ) : null}
        {claimError ? <div className="section-subtitle">{claimError}</div> : null}
      </div>
    </div>
  );
};
