import { afterEach, describe, expect, it } from 'vitest';
import { geoArea, geoContains } from 'd3-geo';
import { feature } from 'topojson-client';
import worldData from '../assets/countries-110m.json';
import {
  buildStateAnchors,
  resolveStationCoords,
  resolveCountryCoords,
  setStateAnchors,
  type StateAnchors
} from './geoResolver';

const moscowLat = 55.7558;
const moscowLon = 37.6173;
const tulaLat = 54.1933;
const tulaLon = 37.6175;
const novosibLat = 55.0084;
const novosibLon = 82.9357;

afterEach(() => {
  // Tests share module-level state in geoResolver, so reset anchors
  // between cases.
  setStateAnchors(null);
});

describe('resolveStationCoords', () => {
  it('returns the station coords verbatim when geo_lat/geo_long are valid', () => {
    const resolved = resolveStationCoords({
      stationuuid: 's1',
      country: 'Russian Federation',
      geo_lat: moscowLat,
      geo_long: moscowLon
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe('station');
    expect(resolved!.lat).toBeCloseTo(moscowLat, 4);
    expect(resolved!.lon).toBeCloseTo(moscowLon, 4);
  });

  it('rejects geo_lat/geo_long that fall outside the station country bbox', () => {
    // Radio Browser sometimes ships obviously wrong coords. A
    // station tagged country=Russia with coords in Brazil should
    // NOT render at the Brazilian point — fall through to the
    // fallback chain.
    const resolved = resolveStationCoords({
      stationuuid: 'bogus-coords',
      country: 'Russia',
      // -15, -55 is somewhere in Brazil
      geo_lat: -15,
      geo_long: -55
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.source).not.toBe('station');
    expect(resolved!.countryKey).toBe('russia');
  });

  it('accepts antimeridian-spanning country coords (Vladivostok in Russia)', () => {
    // Vladivostok 43.1°N, 131.9°E — in Russia's eastern bbox after
    // antimeridian wrap. The naïve range check would reject this;
    // isLonInWrappedRange must allow it.
    const resolved = resolveStationCoords({
      stationuuid: 'vladivostok-station',
      country: 'Russian Federation',
      geo_lat: 43.1,
      geo_long: 131.9
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.source).toBe('station');
    expect(resolved!.lat).toBeCloseTo(43.1, 3);
    expect(resolved!.lon).toBeCloseTo(131.9, 3);
  });

  it('treats (0, 0) as missing coords and falls through to country fallback', () => {
    const resolved = resolveStationCoords({
      stationuuid: 's2',
      country: 'Russia',
      geo_lat: 0,
      geo_long: 0
    });
    expect(resolved).not.toBeNull();
    expect(resolved!.source).not.toBe('station');
    expect(resolved!.countryKey).toBe('russia');
  });

  it('returns null when no country matches and no coords are provided', () => {
    const resolved = resolveStationCoords({
      stationuuid: 's3',
      country: 'Atlantis',
      geo_lat: null,
      geo_long: null
    });
    expect(resolved).toBeNull();
  });

  it('falls back to the country pool when no state anchor matches', () => {
    const a = resolveStationCoords({
      stationuuid: 'pool-1',
      country: 'Russia',
      geo_lat: null,
      geo_long: null
    });
    expect(a).not.toBeNull();
    expect(a!.source).toBe('country-pool');
    // Stable across calls — same UUID, same hash, same pool slot.
    const b = resolveStationCoords({
      stationuuid: 'pool-1',
      country: 'Russia',
      geo_lat: null,
      geo_long: null
    });
    expect(b!.lat).toBeCloseTo(a!.lat, 6);
    expect(b!.lon).toBeCloseTo(a!.lon, 6);
  });

  it('uses the registered state anchor when one exists for the (country, state) tuple', () => {
    const anchors: StateAnchors = new Map();
    anchors.set('russian federation::Тульская область', {
      lat: tulaLat,
      lon: tulaLon,
      n: 12
    });
    setStateAnchors(anchors);

    const tulaStation = resolveStationCoords({
      stationuuid: 'tula-station-1',
      country: 'Russian Federation',
      state: 'Тульская область',
      geo_lat: null,
      geo_long: null
    });

    expect(tulaStation).not.toBeNull();
    // Stays inside ±0.2° of the Tula anchor — the resolver applies
    // a small jitter (up to ±0.18°) but never further.
    expect(Math.abs(tulaStation!.lat - tulaLat)).toBeLessThanOrEqual(0.2);
    expect(Math.abs(tulaStation!.lon - tulaLon)).toBeLessThanOrEqual(0.2);
  });

  it('produces the same dot for the same UUID across re-renders (stable jitter)', () => {
    const anchors: StateAnchors = new Map();
    anchors.set('russian federation::Новосибирская область', {
      lat: novosibLat,
      lon: novosibLon,
      n: 8
    });
    setStateAnchors(anchors);

    const first = resolveStationCoords({
      stationuuid: 'novosib-radio',
      country: 'Russian Federation',
      state: 'Новосибирская область',
      geo_lat: null,
      geo_long: null
    });
    const second = resolveStationCoords({
      stationuuid: 'novosib-radio',
      country: 'Russian Federation',
      state: 'Новосибирская область',
      geo_lat: null,
      geo_long: null
    });
    expect(first).not.toBeNull();
    expect(first!.lat).toBeCloseTo(second!.lat, 8);
    expect(first!.lon).toBeCloseTo(second!.lon, 8);
  });

  it('places stations sharing a state-anchor near each other', () => {
    const anchors: StateAnchors = new Map();
    anchors.set('russian federation::Тульская область', {
      lat: tulaLat,
      lon: tulaLon,
      n: 5
    });
    setStateAnchors(anchors);

    const points = ['t-1', 't-2', 't-3', 't-4', 't-5'].map((id) =>
      resolveStationCoords({
        stationuuid: id,
        country: 'Russian Federation',
        state: 'Тульская область',
        geo_lat: null,
        geo_long: null
      })
    );

    const inside = points.every(
      (p) =>
        p &&
        Math.abs(p.lat - tulaLat) <= 0.25 &&
        Math.abs(p.lon - tulaLon) <= 0.25
    );
    expect(inside).toBe(true);
  });
});

describe('synthesized dots stay inside the country they claim', () => {
  // Measured over the whole 62k catalogue before this was enforced: 583
  // synthesized dots (1.27%) landed inside a NEIGHBOURING country — 57 Mexican
  // stations in the United States, 31 German ones in Czechia, 29 Dutch ones in
  // Germany. The cause was a fixed ±0.12° jitter applied to a pool point
  // without asking whether the result was still home.
  const world = feature(worldData as never, (worldData as never as any).objects.countries)
    .features as any[];
  const polygonFor = (name: string) =>
    world.find((item) => item?.properties?.name === name);

  const stationsFor = (country: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      stationuuid: `${country}-${index}`,
      country
    }));

  // Small countries with long land borders are where the offset used to cross.
  for (const [country, polygonName] of [
    ['Netherlands', 'Netherlands'],
    ['Belgium', 'Belgium'],
    ['Switzerland', 'Switzerland'],
    ['Germany', 'Germany']
  ] as const) {
    it(`places every ${country} station inside ${country}`, () => {
      const polygon = polygonFor(polygonName);
      expect(polygon).toBeDefined();
      const outside: string[] = [];
      for (const station of stationsFor(country, 120)) {
        const resolved = resolveStationCoords(station);
        expect(resolved).not.toBeNull();
        if (!geoContains(polygon, [resolved!.lon, resolved!.lat])) {
          outside.push(`${station.stationuuid} at ${resolved!.lat},${resolved!.lon}`);
        }
      }
      expect(outside).toEqual([]);
    });
  }

  it('still spreads them: no two stations share a position', () => {
    // The first fix collapsed a station onto its bare pool point whenever the
    // offset missed, which put 40 UAE stations on one pixel in Dubai. The
    // offset now mirrors before it shrinks.
    const seen = new Set<string>();
    for (const station of stationsFor('United Arab Emirates', 60)) {
      const resolved = resolveStationCoords(station);
      expect(resolved).not.toBeNull();
      seen.add(`${resolved!.lat.toFixed(4)},${resolved!.lon.toFixed(4)}`);
    }
    expect(seen.size).toBe(60);
  });

  it('spreads an archipelago by area, not by polygon count', () => {
    // Multi-part countries are sampled one polygon at a time, weighted by that
    // polygon's true spherical area — France was half of all the sampling work
    // in a mount because its box spans the Atlantic to French Guiana. Weighting
    // by anything else (part count, bounding box) would quietly move dots:
    // Greece has ~40 polygons and one of them is 93% of the country.
    const greece = polygonFor('Greece');
    const parts = (
      greece.geometry.type === 'MultiPolygon'
        ? greece.geometry.coordinates
        : [greece.geometry.coordinates]
    ).map((coordinates: unknown) => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates }
    }));
    const areas = parts.map((part: never) => geoArea(part));
    const mainland = areas.indexOf(Math.max(...areas));
    const mainlandShareOfArea = areas[mainland] / areas.reduce((a: number, b: number) => a + b, 0);

    let onMainland = 0;
    let placed = 0;
    for (const station of stationsFor('Greece', 400)) {
      const resolved = resolveStationCoords(station);
      if (!resolved) continue;
      placed += 1;
      if (geoContains(parts[mainland] as never, [resolved.lon, resolved.lat])) onMainland += 1;
    }
    expect(placed).toBe(400);
    // Measured over the real catalogue: 93.0% of the area, 92.1% of the dots.
    expect(onMainland / placed).toBeGreaterThan(mainlandShareOfArea - 0.08);
    expect(onMainland / placed).toBeLessThan(mainlandShareOfArea + 0.06);
  });

  it('gives the same station the same point on a second pass', () => {
    // Sample points are now created per slot on demand. An earlier version
    // grew a shared pool instead, which changed `seed % pool.length` mid-pass
    // and moved dots between renders.
    const station = { stationuuid: 'stability-1', country: 'Norway' };
    const first = resolveStationCoords(station);
    const others = stationsFor('Norway', 300).map((s) => resolveStationCoords(s));
    expect(others.every(Boolean)).toBe(true);
    const second = resolveStationCoords(station);
    expect(second!.lat).toBe(first!.lat);
    expect(second!.lon).toBe(first!.lon);
  });

  it('rejects a state anchor that sits outside its own country', () => {
    // A cluster built from wrong coordinates used to be trusted blindly.
    const anchors: StateAnchors = new Map([
      ['russia::Мордор', { lat: 48.85, lon: 2.35, n: 4 }] // Paris
    ]);
    setStateAnchors(anchors);
    const resolved = resolveStationCoords({
      stationuuid: 'bad-anchor-1',
      country: 'Russia',
      state: 'Мордор'
    });
    expect(resolved).not.toBeNull();
    const russia = polygonFor('Russia');
    expect(geoContains(russia, [resolved!.lon, resolved!.lat])).toBe(true);
  });
});

describe('buildStateAnchors', () => {
  it('builds a centroid only when at least 2 sibling stations have explicit coords', () => {
    // Single-coord cluster: should NOT yield an anchor (one outlier
    // shouldn't drag the rest of the state's coord-less stations).
    const onePoint = buildStateAnchors([
      { country: 'Russia', state: 'Тульская область', lat: tulaLat, lon: tulaLon }
    ]);
    expect(onePoint.size).toBe(0);

    // Three-coord cluster: anchor lands on the median.
    const threePoints = buildStateAnchors([
      { country: 'Russia', state: 'Тульская область', lat: 54.0, lon: 37.0 },
      { country: 'Russia', state: 'Тульская область', lat: 54.5, lon: 38.0 },
      { country: 'Russia', state: 'Тульская область', lat: 53.5, lon: 36.5 }
    ]);
    const anchor = threePoints.get('russia::Тульская область');
    expect(anchor).toBeDefined();
    expect(anchor!.n).toBe(3);
    expect(anchor!.lat).toBeCloseTo(54.0, 5);
    expect(anchor!.lon).toBeCloseTo(37.0, 5);
  });

  it('skips rows missing country, state, or coords', () => {
    const result = buildStateAnchors([
      { country: 'Russia', state: '', lat: 55, lon: 37 },
      { country: '', state: 'X', lat: 55, lon: 37 },
      { country: 'Russia', state: 'X', lat: null, lon: null },
      { country: 'Russia', state: 'X', lat: 55, lon: 37 }
    ]);
    expect(result.size).toBe(0); // single coord-having station → no anchor
  });

  it('uses the median, not the mean, so an outlier station does not pull the centroid', () => {
    const anchors = buildStateAnchors([
      { country: 'Russia', state: 'Тульская область', lat: 54.0, lon: 37.0 },
      { country: 'Russia', state: 'Тульская область', lat: 54.2, lon: 37.2 },
      { country: 'Russia', state: 'Тульская область', lat: 54.1, lon: 37.1 },
      // outlier — perhaps a station mis-tagged with this state
      { country: 'Russia', state: 'Тульская область', lat: 30.0, lon: 100.0 }
    ]);
    const anchor = anchors.get('russia::Тульская область');
    expect(anchor).toBeDefined();
    // Median of [54.0, 54.1, 54.2, 30.0] sorted is 54.1 (lower of
    // two middle values for even count). Mean would be ~48.
    expect(anchor!.lat).toBeLessThan(60);
    expect(anchor!.lat).toBeGreaterThan(50);
  });
});

describe('resolveCountryCoords', () => {
  it('returns coords + continent for a known country', () => {
    const r = resolveCountryCoords('Russia');
    expect(r).not.toBeNull();
    expect(r!.continent).toBeDefined();
    expect(typeof r!.lat).toBe('number');
    expect(typeof r!.lon).toBe('number');
  });

  it('returns null for a nonsense country string', () => {
    const r = resolveCountryCoords('Wakanda');
    expect(r).toBeNull();
  });

  it('matches via alias map (e.g. Russian Federation → Russia)', () => {
    const a = resolveCountryCoords('Russia');
    const b = resolveCountryCoords('Russian Federation');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!.lat).toBeCloseTo(a!.lat, 4);
    expect(b!.lon).toBeCloseTo(a!.lon, 4);
  });
});
