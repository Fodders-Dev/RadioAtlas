import { useMemo, useState, type CSSProperties } from 'react';
import type { StationLite } from '../types';

type StationArtworkProps = {
  station: StationLite | null;
  size?: 'sm' | 'md' | 'card' | 'dock';
  className?: string;
};

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
  const [broken, setBroken] = useState(false);
  const imageSrc = station?.stationArtwork?.trim() || station?.favicon?.trim();
  const showImage = Boolean(imageSrc) && !broken;
  const initial = toInitial(station?.name);
  const accent = useMemo(
    () => toAccent(station?.stationuuid || station?.name || 'radio'),
    [station?.name, station?.stationuuid]
  );
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
          onError={() => setBroken(true)}
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
};
