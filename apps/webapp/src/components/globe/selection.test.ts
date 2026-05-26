import { describe, expect, it } from 'vitest';
import { pickNearestPointToReticle, type ReticleProjector } from './selection';

type TestPoint = { id: string; lat: number; lon: number };

// Center-relative projector that mimics map.project near the reticle:
// longitude wraps across the antimeridian, latitude maps linearly to
// pixels. Good enough to validate the helper's pixel pass + lock radius.
const makeProjector = (centerLon: number, cx: number, cy: number, scale = 4): ReticleProjector =>
  (lon, lat) => {
    let deltaLon = lon - centerLon;
    if (deltaLon > 180) deltaLon -= 360;
    else if (deltaLon < -180) deltaLon += 360;
    return { x: cx + deltaLon * scale, y: cy - lat * scale };
  };

const bruteForceNearest = (
  points: TestPoint[],
  viewport: { cx: number; cy: number },
  project: ReticleProjector,
  lockRadiusPx: number
): string | null => {
  let id: string | null = null;
  let best = Infinity;
  for (const point of points) {
    const projected = project(point.lon, point.lat);
    const dx = projected.x - viewport.cx;
    const dy = projected.y - viewport.cy;
    const distance = dx * dx + dy * dy;
    if (distance < best) {
      best = distance;
      id = point.id;
    }
  }
  return best > lockRadiusPx * lockRadiusPx ? null : id;
};

describe('pickNearestPointToReticle (T2.13)', () => {
  const viewport = { cx: 720, cy: 360 };

  it('returns null for an empty point set', () => {
    expect(
      pickNearestPointToReticle([], { lat: 0, lon: 0 }, viewport, makeProjector(0, 720, 360), 140)
    ).toBeNull();
  });

  it('picks the point whose projected dot is closest to the crosshair', () => {
    const project = makeProjector(0, 720, 360);
    const points: TestPoint[] = [
      { id: 'far', lat: 40, lon: 40 },
      { id: 'near', lat: 0.5, lon: 0.5 },
      { id: 'mid', lat: 5, lon: 5 }
    ];
    expect(pickNearestPointToReticle(points, { lat: 0, lon: 0 }, viewport, project, 140)).toBe(
      'near'
    );
  });

  it('rejects the nearest when it falls outside the lock radius', () => {
    const project = makeProjector(0, 720, 360);
    // lon 10 -> x = 720 + 40 -> 40px from centre.
    const points: TestPoint[] = [{ id: 'A', lat: 0, lon: 10 }];
    expect(pickNearestPointToReticle(points, { lat: 0, lon: 0 }, viewport, project, 20)).toBeNull();
    expect(pickNearestPointToReticle(points, { lat: 0, lon: 0 }, viewport, project, 140)).toBe('A');
  });

  it('handles antimeridian wrap', () => {
    const project = makeProjector(179, 720, 360);
    const points: TestPoint[] = [
      { id: 'wrap', lat: 0, lon: -179 }, // 2deg across the seam from center 179
      { id: 'home', lat: 0, lon: 170 } // 9deg west
    ];
    expect(pickNearestPointToReticle(points, { lat: 0, lon: 179 }, viewport, project, 140)).toBe(
      'wrap'
    );
  });

  it('reproduces a brute-force projected scan when every point is a candidate', () => {
    // candidateCount >= N makes the pixel pass run over the full set, so
    // the result must equal a straight brute-force projected nearest —
    // this locks the pixel-distance + lock-radius logic exactly.
    const center = { lat: 10, lon: 20 };
    const project = makeProjector(20, 720, 360);
    const points: TestPoint[] = Array.from({ length: 24 }, (_, i) => ({
      id: `p${i}`,
      lat: 10 + ((i % 7) - 3) * 1.3,
      lon: 20 + ((i % 5) - 2) * 1.7
    }));
    const expected = bruteForceNearest(points, viewport, project, 140);
    expect(pickNearestPointToReticle(points, center, viewport, project, 140, points.length)).toBe(
      expected
    );
  });

  it('keeps the true nearest after pruning to K candidates', () => {
    // N (12) > default K (8): the nearest point is also the geographically
    // nearest, so the equirect pre-rank must keep it in the candidate set.
    const center = { lat: 0, lon: 0 };
    const project = makeProjector(0, 720, 360);
    const points: TestPoint[] = [
      { id: 'bullseye', lat: 0.2, lon: 0.2 },
      ...Array.from({ length: 11 }, (_, i) => ({
        id: `ring${i}`,
        lat: (i - 5) * 6,
        lon: (i % 2 === 0 ? 1 : -1) * (10 + i * 3)
      }))
    ];
    expect(pickNearestPointToReticle(points, center, viewport, project, 140)).toBe('bullseye');
  });
});
