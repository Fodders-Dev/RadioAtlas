import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getProxiedAssetUrl } from '../lib/assetUrl';
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

const toAccent = (seed: string) => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  return {
    primary: `hsla(${hue}, 78%, 62%, 0.9)`,
    secondary: `hsla(${(hue + 42) % 360}, 84%, 70%, 0.66)`
  };
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
  const accent = useMemo(
    () => toAccent(station?.stationuuid || station?.name || 'radio'),
    [station?.name, station?.stationuuid]
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
        '--station-artwork-primary': accent.primary,
        '--station-artwork-secondary': accent.secondary
      } as CSSProperties);

  return (
    <div
      className={`station-artwork station-artwork-${size} ${className}`.trim()}
      data-has-image={showImage ? 'true' : 'false'}
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
