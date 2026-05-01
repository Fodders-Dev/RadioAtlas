import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getProxiedAssetUrl } from '../lib/assetUrl';
import { createGeneratedArtworkPalette } from '../lib/artwork';
import type { StationLite } from '../types';

type StationArtworkProps = {
  station: StationLite | null;
  size?: 'sm' | 'md' | 'card' | 'dock';
  className?: string;
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
  className = ''
}: StationArtworkProps) => {
  const imageSrc = getProxiedAssetUrl(station?.stationArtwork?.trim() || station?.favicon?.trim());
  const [broken, setBroken] = useState(() => Boolean(imageSrc && BROKEN_ARTWORK_URLS.has(imageSrc)));
  const showImage = Boolean(imageSrc) && !broken;
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

  useEffect(() => {
    setBroken(Boolean(imageSrc && BROKEN_ARTWORK_URLS.has(imageSrc)));
  }, [imageSrc]);

  const handleImageError = () => {
    if (imageSrc) {
      BROKEN_ARTWORK_URLS.add(imageSrc);
    }
    setBroken(true);
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
      data-artwork-pattern={palette.pattern}
      style={style}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={imageSrc || ''}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={handleImageError}
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
};
