import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createGeneratedArtworkPalette } from '../lib/artwork';
import { resolveSceneArtworkUrl } from '../lib/sceneArtwork';
import type { StationLite } from '../types';
import './StationScene.css';

type StationSceneProps = {
  station: StationLite | null;
  className?: string;
  priority?: boolean;
  /**
   * Fired once the scene bitmap is decoded and measurable. The surface that owns
   * the card decides what to do with it — Home reads the colour under its play
   * control so the flat `lite` plate is tinted by the tile's own picture. The
   * scene stays decorative and knows nothing about controls.
   */
  onImageReady?: (image: HTMLImageElement) => void;
};

const BROKEN_SCENE_URLS = new Set<string>();

const seedOf = (station: StationLite | null) =>
  [station?.stationuuid, station?.name, station?.country, station?.state, station?.tags]
    .filter(Boolean)
    .join(':') || 'radio';

/**
 * Opt-in decorative atmosphere for large editorial surfaces.
 *
 * This component never represents the station's identity: owner-provided logos
 * belong in StationArtwork. A missing, unavailable, or broken cached scene
 * degrades to a deterministic procedural composition without starting any
 * generation request from the browser.
 */
export const StationScene = ({
  station,
  className = '',
  priority = false,
  onImageReady
}: StationSceneProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [resolvedScene, setResolvedScene] = useState({ stationId: '', url: '' });
  const [, rerenderBrokenSource] = useState(0);
  const seed = seedOf(station);
  const sceneUrl = resolvedScene.stationId === station?.stationuuid &&
    !BROKEN_SCENE_URLS.has(resolvedScene.url)
    ? resolvedScene.url
    : '';
  const palette = useMemo(() => createGeneratedArtworkPalette(seed), [seed]);

  useEffect(() => {
    let alive = true;
    let observer: IntersectionObserver | null = null;
    if (!station?.stationuuid) {
      return () => {
        alive = false;
      };
    }

    const stationId = station.stationuuid;
    const resolveScene = () => {
      void resolveSceneArtworkUrl(stationId)
        .then((url) => {
          if (alive && url) setResolvedScene({ stationId, url });
        })
        .catch(() => {
          // Optional scene lookup is fail-soft; the procedural layer stays visible.
        });
    };

    // Hero scenes affect LCP and resolve immediately. Rail cards keep their
    // deterministic procedural artwork until they approach the viewport. Home
    // can mount dozens of horizontal cards at once; eagerly probing every
    // scene endpoint caused a cold-load request burst for content the user had
    // not scrolled to yet.
    if (
      priority ||
      typeof IntersectionObserver === 'undefined' ||
      !rootRef.current
    ) {
      resolveScene();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer?.disconnect();
          observer = null;
          resolveScene();
        },
        { rootMargin: '320px 240px' }
      );
      observer.observe(rootRef.current);
    }

    return () => {
      alive = false;
      observer?.disconnect();
    };
  }, [priority, station?.stationuuid]);

  const style = {
    '--station-scene-primary': palette.primary,
    '--station-scene-secondary': palette.secondary,
    '--station-scene-tertiary': palette.tertiary,
    '--station-scene-angle': palette.angle
  } as CSSProperties;

  const handleImageError = () => {
    if (sceneUrl) BROKEN_SCENE_URLS.add(sceneUrl);
    rerenderBrokenSource((version) => version + 1);
  };

  const handleImageLoad = (event: { currentTarget: HTMLImageElement }) => {
    onImageReady?.(event.currentTarget);
  };

  return (
    <div
      ref={rootRef}
      className={`station-scene ${className}`.trim()}
      data-scene-source={sceneUrl ? 'scene' : 'generated'}
      data-scene-pattern={palette.pattern}
      style={style}
      aria-hidden="true"
    >
      {sceneUrl ? (
        <img
          key={sceneUrl}
          className="station-scene-image"
          src={sceneUrl}
          alt=""
          loading={priority ? 'eager' : 'lazy'}
          {...(priority ? { fetchpriority: 'high' } : {})}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={handleImageError}
          onLoad={handleImageLoad}
        />
      ) : null}
      <span className="station-scene-tint" />
    </div>
  );
};
