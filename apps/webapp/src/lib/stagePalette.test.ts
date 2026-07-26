import { describe, expect, it } from 'vitest';
import { toStagePalette } from './artworkColor';
import { createGeneratedArtworkPalette } from './artwork';

const lightnessOf = (value: string) => Number(/(\d+)%\)$/.exec(value)?.[1] ?? NaN);
const saturationOf = (value: string) => Number(/\s(\d+)%\s/.exec(value)?.[1] ?? NaN);
const hueOf = (value: string) => Number(/^hsl\((\d+)/.exec(value)?.[1] ?? NaN);

describe('toStagePalette', () => {
  it('darkens the highlighter colours that filled the whole player', () => {
    // The measured failure: Tokyo FM's generated palette put hsl(56 85% 50%) at
    // 0.85 alpha across the lower half of the stage — a screen of olive.
    const staged = toStagePalette({
      primary: 'hsl(56 85% 50%)',
      secondary: 'hsl(100 82% 68%)',
      tertiary: 'hsl(254 70% 50%)',
      angle: '145deg'
    });
    for (const stop of [staged.primary, staged.secondary, staged.tertiary]) {
      expect(lightnessOf(stop)).toBeLessThanOrEqual(24);
      expect(saturationOf(stop)).toBeLessThanOrEqual(50);
    }
  });

  it('keeps the station HUE — identity was never the problem, brightness was', () => {
    const staged = toStagePalette({
      primary: 'hsl(56 85% 50%)',
      secondary: 'hsl(100 82% 68%)',
      tertiary: 'hsl(254 70% 50%)',
      angle: '145deg'
    });
    expect(hueOf(staged.primary)).toBe(56);
    expect(hueOf(staged.secondary)).toBe(100);
    expect(hueOf(staged.tertiary)).toBe(254);
    expect(staged.angle).toBe('145deg');
  });

  it('lifts a near-black stop instead of leaving the stage dead', () => {
    const staged = toStagePalette({
      primary: 'hsl(210 4% 2%)',
      secondary: 'hsl(210 4% 2%)',
      tertiary: 'hsl(210 4% 2%)',
      angle: '90deg'
    });
    for (const stop of [staged.primary, staged.secondary, staged.tertiary]) {
      expect(lightnessOf(stop)).toBeGreaterThanOrEqual(10);
    }
  });

  it('holds for EVERY generated palette, not just the one that was reported', () => {
    // createGeneratedArtworkPalette walks the whole hue circle off the station
    // hash, so a single bad seed is a screen of colour for those stations.
    for (let i = 0; i < 400; i += 1) {
      const staged = toStagePalette(createGeneratedArtworkPalette(`station-${i}`));
      for (const stop of [staged.primary, staged.secondary, staged.tertiary]) {
        expect(lightnessOf(stop), stop).toBeLessThanOrEqual(24);
      }
    }
  });

  it('keeps the discovery feed alive — the poster tone is not the stage tone', () => {
    // Clamping the feed card as hard as the player made a full-screen poster
    // flat. It only needs the highlighter ceiling, not the player's darkness.
    const tile = { primary: 'hsl(190 78% 62%)', secondary: 'hsl(320 74% 60%)', tertiary: 'hsl(260 70% 50%)', angle: '145deg' };
    const stage = toStagePalette(tile, 'stage');
    const poster = toStagePalette(tile, 'poster');
    expect(lightnessOf(poster.primary)).toBeGreaterThan(lightnessOf(stage.primary));
    expect(saturationOf(poster.primary)).toBeGreaterThan(saturationOf(stage.primary));
    // …but the poster still has a ceiling, or the olive problem just moves.
    expect(lightnessOf(poster.primary)).toBeLessThanOrEqual(42);
  });

  it('passes through anything it cannot parse rather than guessing', () => {
    const odd = {
      primary: 'var(--accent)',
      secondary: 'rgb(1 2 3)',
      tertiary: '#ff0000',
      angle: '10deg'
    };
    expect(toStagePalette(odd)).toEqual(odd);
  });
});
