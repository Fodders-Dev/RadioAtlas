import type { CSSProperties } from 'react';
import type { FollowedRegion } from '../domain/contracts';
import { createGeneratedArtworkPalette } from '../lib/artwork';

type RegionArtworkProps = {
  region: Pick<FollowedRegion, 'id' | 'label' | 'scope'> | null;
  count?: number;
  className?: string;
};

const labelInitial = (label?: string) =>
  (Array.from(label || '').find((char) => /\p{L}|\p{N}/u.test(char)) || 'R').toUpperCase();

export const RegionArtwork = ({
  region,
  count = 0,
  className = ''
}: RegionArtworkProps) => {
  const seed = `${region?.id || 'nearby'}:${region?.label || 'radio'}:${count}`;
  const palette = createGeneratedArtworkPalette(seed);
  const style = {
    '--station-artwork-primary': palette.primary,
    '--station-artwork-secondary': palette.secondary,
    '--station-artwork-tertiary': palette.tertiary,
    '--station-artwork-angle': palette.angle
  } as CSSProperties;

  return (
    <div
      className={`region-artwork ${className}`.trim()}
      data-region-artwork
      data-artwork-pattern={palette.pattern}
      style={style}
      aria-hidden="true"
    >
      <span>{labelInitial(region?.label)}</span>
    </div>
  );
};
