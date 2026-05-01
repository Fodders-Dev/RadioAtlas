import type { CSSProperties } from 'react';
import { createGeneratedArtworkPalette } from '../lib/artwork';
import type { StationLite } from '../types';
import { StationArtwork } from './StationArtwork';

type CollectionArtworkProps = {
  label: string;
  stations: StationLite[];
  className?: string;
};

const toInitials = (label: string) =>
  label
    .split(/\s+/g)
    .map((part) => part.trim()[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'RA';

export const CollectionArtwork = ({
  label,
  stations,
  className = ''
}: CollectionArtworkProps) => {
  const palette = createGeneratedArtworkPalette(
    `${label}:${stations.map((station) => station.stationuuid).join(':')}`
  );
  const style = {
    '--station-artwork-primary': palette.primary,
    '--station-artwork-secondary': palette.secondary,
    '--station-artwork-tertiary': palette.tertiary,
    '--station-artwork-angle': palette.angle
  } as CSSProperties;
  const previewStations = stations.slice(0, 4);

  return (
    <div
      className={`collection-artwork ${className}`.trim()}
      data-collection-artwork
      data-artwork-pattern={palette.pattern}
      style={style}
      aria-hidden="true"
    >
      {previewStations.length ? (
        previewStations.map((station) => (
          <StationArtwork key={station.stationuuid} station={station} size="sm" />
        ))
      ) : (
        <span className="collection-artwork-empty">{toInitials(label)}</span>
      )}
    </div>
  );
};
