import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { VisualizerFrame } from '../lib/useAudioPlayer';
import type { StationLite } from '../types';
import { createGeneratedArtworkPalette } from '../lib/artwork';
import {
  extractArtworkPalette,
  toStagePalette,
  type ExtractedPalette,
  type PaletteTone
} from '../lib/artworkColor';
import { getProxiedAssetUrl } from '../lib/assetUrl';
import { resolveSceneArtworkUrl } from '../lib/sceneArtwork';
import './StationBackdrop.css';

// Phase 1 station-backdrop engine (generalizes the old FullPlayerBackdrop). A
// reusable, full-bleed, two-layer background tinted by THE STATION rather than
// the theme — the foundation the Phase 2 feed reuses unchanged.
//
//   Layer A (base, station colour): a blurred full-bleed cover <img> under a
//     gradient built from the extracted artwork palette. The palette starts as
//     the deterministic createGeneratedArtworkPalette(station) (never an empty
//     frame) and upgrades to the extracted-from-cover palette when it resolves.
//     No cover at all → generated palette only (no blur image).
//   Layer B (sound glow): the --ra-energy swell from the live audio pump,
//     tinted by the station palette mixed with the theme accent. Written via
//     direct DOM (no per-frame React state) so the host never re-renders at 30Hz.
//   Scrim: a dark overlay so text/controls above stay AA-readable in both themes.
type StationBackdropProps = {
  station: StationLite | null;
  active: boolean;
  subscribe: (callback: (frame: VisualizerFrame) => void) => () => void;
  /** 'stage' recedes behind dense copy (the player); 'poster' stays colourful
   *  (the feed card). Defaults to poster — the pre-existing behaviour. */
  tone?: PaletteTone;
};

const stationArtworkUrlOf = (station: StationLite | null) =>
  station?.stationArtwork?.trim() || station?.favicon?.trim() || '';

// Identity seed for the generated fallback palette — same fields/shape as
// StationArtwork so a station's fallback colours line up across the app.
const seedOf = (station: StationLite | null) =>
  [station?.stationuuid, station?.name, station?.country, station?.state, station?.tags]
    .filter(Boolean)
    .join(':') || 'radio';

export const StationBackdrop = ({
  station,
  active,
  subscribe,
  tone = 'poster'
}: StationBackdropProps) => {
  const energyRef = useRef<HTMLDivElement>(null);

  const stationArtworkUrl = stationArtworkUrlOf(station);
  const [sceneImage, setSceneImage] = useState({ stationId: '', url: '' });
  const sceneUrl = sceneImage.stationId === station?.stationuuid ? sceneImage.url : '';
  const artworkUrl = sceneUrl || stationArtworkUrl;
  const seed = seedOf(station);

  useEffect(() => {
    let alive = true;
    if (!station?.stationuuid) {
      return () => {
        alive = false;
      };
    }
    const stationId = station.stationuuid;
    void resolveSceneArtworkUrl(stationId).then((url) => {
      if (alive && url) setSceneImage({ stationId, url });
    });
    return () => {
      alive = false;
    };
  }, [station?.stationuuid]);

  // Immediate, never-empty palette from station identity; upgraded below.
  const generated = useMemo(() => createGeneratedArtworkPalette(seed), [seed]);
  const [extracted, setExtracted] = useState<ExtractedPalette | null>(null);

  // The DISPLAYED blur image uses the normal proxy (https passthrough); colour
  // EXTRACTION force-proxies for CORS inside artworkColor.
  const blurSrc = useMemo(() => (artworkUrl ? getProxiedAssetUrl(artworkUrl) : ''), [artworkUrl]);

  useEffect(() => {
    setExtracted(null);
    if (!artworkUrl) return undefined;
    let alive = true;
    extractArtworkPalette(artworkUrl).then((palette) => {
      if (alive && palette) setExtracted(palette);
    });
    return () => {
      alive = false;
    };
  }, [artworkUrl]);

  // Re-banded for the surface: the tile palettes are far too bright to carry a
  // whole screen. See toStagePalette — hue is kept, brightness is not.
  const palette = useMemo(
    () => toStagePalette(extracted ?? generated, tone),
    [extracted, generated, tone]
  );

  // Layer B energy: subscribe to the same audio pump as the spectrum, smooth the
  // low-mid bands, and write --ra-energy straight to the DOM node (no React state
  // per frame). With no live data the CSS falls back to a slow ambient drift.
  useEffect(() => {
    if (!active) return undefined;
    let smoothed = 0;
    const unsubscribe = subscribe((frame) => {
      const node = energyRef.current;
      if (!node) return;
      const { spectrum } = frame;
      const count = Math.min(spectrum.length, 16);
      let sum = 0;
      for (let index = 0; index < count; index += 1) sum += spectrum[index] ?? 0;
      const energy = count > 0 ? sum / count : 0;
      smoothed += (energy - smoothed) * 0.28;
      node.style.setProperty('--ra-energy', smoothed.toFixed(3));
    });
    return () => {
      unsubscribe();
      energyRef.current?.style.removeProperty('--ra-energy');
    };
  }, [active, subscribe]);

  const style = {
    '--station-bd-primary': palette.primary,
    '--station-bd-secondary': palette.secondary,
    '--station-bd-tertiary': palette.tertiary,
    '--station-bd-angle': palette.angle
  } as CSSProperties;

  return (
    <div
      className="station-backdrop"
      data-active={active ? 'true' : 'false'}
      data-has-artwork={blurSrc ? 'true' : 'false'}
      data-visual-source={sceneUrl ? 'scene' : artworkUrl ? 'station' : 'generated'}
      data-palette-source={extracted ? 'artwork' : 'generated'}
      data-full-player-backdrop
      aria-hidden="true"
      style={style}
    >
      {blurSrc ? (
        <img
          className="station-backdrop-image"
          src={blurSrc}
          alt=""
          aria-hidden="true"
          loading={active ? 'eager' : 'lazy'}
          {...(active ? { fetchpriority: 'high' } : {})}
          decoding="async"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <div className="station-backdrop-color" />
      <div
        ref={energyRef}
        className="station-backdrop-energy"
        data-active={active ? 'true' : 'false'}
      />
      <div className="station-backdrop-scrim" />
    </div>
  );
};
