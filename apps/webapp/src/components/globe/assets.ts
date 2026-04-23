export type GlobeAssets = {
  geoDistance: typeof import('d3-geo').geoDistance;
  geoGraticule10: typeof import('d3-geo').geoGraticule10;
  geoOrthographic: typeof import('d3-geo').geoOrthographic;
  geoPath: typeof import('d3-geo').geoPath;
  land: unknown;
  borders: unknown;
};

let assetsPromise: Promise<GlobeAssets> | null = null;

export const loadGlobeAssets = async () => {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      import('d3-geo'),
      import('topojson-client'),
      import('../../assets/countries-110m.json')
    ]).then(([d3, topojson, worldModule]) => {
      const worldData = (worldModule as { default?: any }).default ?? worldModule;
      const landObject = worldData.objects.land ?? worldData.objects.countries;
      return {
        geoDistance: d3.geoDistance,
        geoGraticule10: d3.geoGraticule10,
        geoOrthographic: d3.geoOrthographic,
        geoPath: d3.geoPath,
        land: topojson.feature(worldData as any, landObject),
        borders: worldData.objects?.countries
          ? topojson.mesh(worldData as any, worldData.objects.countries, (a: any, b: any) => a !== b)
          : null
      };
    });
  }
  return assetsPromise;
};
