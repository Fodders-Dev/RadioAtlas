import { describe, expect, it } from 'vitest';
import { averageRgb, coverSourceRect, toPlateColor } from './scenePlate';

/**
 * The cover mapping gets a unit test because the first version of it was wrong
 * and the only symptom was a plate that looked "a bit dark" in a screenshot —
 * a wrongness with no error, no failing test and no obvious tell, which is the
 * expensive kind. Arithmetic is checkable; a screenshot of a photograph is not.
 */
describe('coverSourceRect', () => {
  it('maps the whole box to the whole image when the aspect ratios match', () => {
    const source = coverSourceRect(
      { width: 200, height: 100 },
      { width: 400, height: 200 },
      { x: 0, y: 0, width: 200, height: 100 }
    );
    expect(source).toEqual({ sx: 0, sy: 0, sw: 400, sh: 200 });
  });

  it('accounts for the crop when the image is taller than the box', () => {
    // Box 200x100, image 400x400. cover scales by max(0.5, 0.25) = 0.5, so the
    // drawn image is 200x200 and 50px is cut from the top and bottom alike.
    const source = coverSourceRect(
      { width: 200, height: 100 },
      { width: 400, height: 400 },
      { x: 0, y: 0, width: 200, height: 100 }
    );
    expect(source).toEqual({ sx: 0, sy: 100, sw: 400, sh: 200 });
  });

  it('maps a control in the corner of the box to the matching corner of the crop', () => {
    // Same geometry, but sampling a 20x20 control at the box's bottom-right.
    const source = coverSourceRect(
      { width: 200, height: 100 },
      { width: 400, height: 400 },
      { x: 180, y: 80, width: 20, height: 20 }
    );
    expect(source).toEqual({ sx: 360, sy: 260, sw: 40, sh: 40 });
  });

  it('clamps a control that hangs off the picture instead of reading out of bounds', () => {
    const source = coverSourceRect(
      { width: 200, height: 100 },
      { width: 400, height: 200 },
      { x: 190, y: 0, width: 40, height: 40 }
    );
    expect(source).not.toBeNull();
    expect(source!.sx + source!.sw).toBeLessThanOrEqual(400);
    expect(source!.sy + source!.sh).toBeLessThanOrEqual(200);
  });

  it('refuses degenerate geometry rather than returning NaN', () => {
    expect(coverSourceRect({ width: 0, height: 0 }, { width: 10, height: 10 }, { x: 0, y: 0, width: 5, height: 5 })).toBeNull();
    expect(coverSourceRect({ width: 10, height: 10 }, { width: 0, height: 0 }, { x: 0, y: 0, width: 5, height: 5 })).toBeNull();
    expect(coverSourceRect({ width: 10, height: 10 }, { width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 0 })).toBeNull();
  });
});

describe('averageRgb', () => {
  it('ignores fully transparent pixels', () => {
    // Two opaque white pixels and two transparent ones. Counting the
    // transparent pair would drag the answer to mid-grey.
    const data = new Uint8ClampedArray([
      255, 255, 255, 255,
      255, 255, 255, 255,
      0, 0, 0, 0,
      0, 0, 0, 0
    ]);
    expect(averageRgb(data)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('returns null when there is nothing opaque to average', () => {
    expect(averageRgb(new Uint8ClampedArray([0, 0, 0, 0]))).toBeNull();
  });
});

describe('toPlateColor', () => {
  const lightnessOf = (plate: string) => Number(/,\s*([\d.]+)%,\s*[\d.]+\)/.exec(plate)?.[1]);
  const hueOf = (plate: string) => Number(/hsla\((\d+)/.exec(plate)?.[1]);

  it('keeps the hue of the artwork — that is the whole point of sampling it', () => {
    // A warm scene stays warm, a cool one stays cool.
    expect(hueOf(toPlateColor({ r: 200, g: 150, b: 90 }))).toBeGreaterThan(20);
    expect(hueOf(toPlateColor({ r: 200, g: 150, b: 90 }))).toBeLessThan(50);
    expect(hueOf(toPlateColor({ r: 90, g: 150, b: 220 }))).toBeGreaterThan(180);
    expect(hueOf(toPlateColor({ r: 90, g: 150, b: 220 }))).toBeLessThan(250);
  });

  it('pulls a sunlit scene down so the white glyph still reads', () => {
    // Straight from the picture this would be a white arrow on a pale coin.
    expect(lightnessOf(toPlateColor({ r: 250, g: 245, b: 235 }))).toBeLessThanOrEqual(42);
  });

  it('lifts a near-black scene so the control does not vanish into the tile', () => {
    expect(lightnessOf(toPlateColor({ r: 6, g: 8, b: 10 }))).toBeGreaterThanOrEqual(15);
  });

  it('is translucent, so the plate still belongs to the picture under it', () => {
    expect(toPlateColor({ r: 120, g: 120, b: 120 })).toMatch(/,\s*0\.82\)$/);
  });
});
