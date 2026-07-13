import { useMemo, useState, type CSSProperties } from 'react';
import { getProxiedAssetUrl } from '../lib/assetUrl';
import { createGeneratedArtworkPalette } from '../lib/artwork';
import type { StationLite } from '../types';

type StationArtworkProps = {
  station: StationLite | null;
  size?: 'sm' | 'md' | 'card' | 'dock';
  className?: string;
  priority?: boolean;
};

const BROKEN_ARTWORK_URLS = new Set<string>();

const toInitial = (value?: string) => {
  const cleaned = (value || '').trim();
  if (!cleaned) return '?';
  const letter = Array.from(cleaned).find((char) => /\p{L}|\p{N}/u.test(char));
  return (letter || cleaned[0] || '?').toUpperCase();
};

export const StationArtwork = ({
  station,
  size = 'md',
  className = '',
  priority = false
}: StationArtworkProps) => {
  const [, rerenderBrokenSource] = useState(0);
  const artworkCandidates = [
    { kind: 'station-artwork', url: getProxiedAssetUrl(station?.stationArtwork?.trim()) },
    { kind: 'favicon', url: getProxiedAssetUrl(station?.favicon?.trim()) }
  ].filter(
    (candidate, index, candidates) =>
      Boolean(candidate.url) &&
      candidates.findIndex((item) => item.url === candidate.url) === index
  );
  const selectedArtwork = artworkCandidates.find(
    (candidate) => !BROKEN_ARTWORK_URLS.has(candidate.url)
  );
  const imageSrc = selectedArtwork?.url || '';
  const showImage = Boolean(imageSrc);
  const artworkSource = selectedArtwork?.kind || 'generated';
  const initial = toInitial(station?.name);
  const palette = useMemo(
    () =>
      createGeneratedArtworkPalette(
        [
          station?.stationuuid,
          station?.name,
          station?.country,
          station?.state,
          station?.tags
        ]
          .filter(Boolean)
          .join(':') || 'radio'
      ),
    [station?.country, station?.name, station?.stationuuid, station?.state, station?.tags]
  );

  const handleImageError = () => {
    if (imageSrc) {
      BROKEN_ARTWORK_URLS.add(imageSrc);
    }
    rerenderBrokenSource((version) => version + 1);
  };

  const style = showImage
    ? undefined
    : ({
        '--station-artwork-primary': palette.primary,
        '--station-artwork-secondary': palette.secondary,
        '--station-artwork-tertiary': palette.tertiary,
        '--station-artwork-angle': palette.angle
      } as CSSProperties);

  return (
    <div
      className={`station-artwork station-artwork-${size} ${className}`.trim()}
      data-has-image={showImage ? 'true' : 'false'}
      data-artwork-source={artworkSource}
      data-artwork-pattern={palette.pattern}
      style={style}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          key={imageSrc}
          src={imageSrc || ''}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          {...(priority ? { fetchpriority: 'high' } : {})}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={handleImageError}
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
};
