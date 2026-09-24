import { useMemo, useState, type CSSProperties } from 'react';
import { getProxiedAssetUrl } from '../lib/assetUrl';
import { hashArtworkSeed } from '../lib/artwork';
import type { StationLite } from '../types';
import './StationArtwork.css';

type StationArtworkProps = {
  station: StationLite | null;
  size?: 'sm' | 'md' | 'card' | 'dock';
  className?: string;
  priority?: boolean;
};

const BROKEN_ARTWORK_URLS = new Set<string>();

const editorialPalettes = [
  { paper: '#d9aa91', ink: '#34251f', motif: '#70483a' }, // terracotta
  { paper: '#aebba5', ink: '#202c22', motif: '#52634e' }, // sage
  { paper: '#d6bd83', ink: '#332b1b', motif: '#77643a' }, // ochre
  { paper: '#aab8c2', ink: '#202a31', motif: '#52616d' }, // slate
  { paper: '#beaaba', ink: '#302631', motif: '#6c536a' } // plum
] as const;

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
  const palette = useMemo(() => {
    const seed =
      station?.stationuuid?.trim() ||
      [station?.name, station?.country].filter(Boolean).join(':') ||
      'radio';
    const hash = hashArtworkSeed(seed);
    return {
      ...editorialPalettes[hash % editorialPalettes.length],
      pattern: `editorial-${(hash >>> 8) % 3}`
    };
  }, [station?.country, station?.name, station?.stationuuid]);

  const handleImageError = () => {
    if (imageSrc) {
      BROKEN_ARTWORK_URLS.add(imageSrc);
    }
    rerenderBrokenSource((version) => version + 1);
  };

  const style = showImage
    ? undefined
    : ({
        '--station-artwork-paper': palette.paper,
        '--station-artwork-ink': palette.ink,
        '--station-artwork-motif': palette.motif
      } as CSSProperties);

  return (
    <div
      className={`station-artwork station-artwork-editorial station-artwork-${size} ${className}`.trim()}
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
