export type GlobeAssets = {
  geoDistance: typeof import('d3-geo').geoDistance;
  geoGraticule10: typeof import('d3-geo').geoGraticule10;
  geoOrthographic: typeof import('d3-geo').geoOrthographic;
  geoPath: typeof import('d3-geo').geoPath;
  earthTexture: {
    canvas: HTMLCanvasElement;
    data: Uint8ClampedArray;
    height: number;
    width: number;
  } | null;
  land: unknown;
  borders: unknown;
};

let assetsPromise: Promise<GlobeAssets> | null = null;

const loadEarthTexture = async () => {
  if (typeof Image === 'undefined' || typeof document === 'undefined') return null;
  return new Promise<GlobeAssets['earthTexture']>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      resolve({
        canvas,
        data: imageData.data,
        height: imageData.height,
        width: imageData.width
      });
    };
    image.onerror = () => resolve(null);
    image.src = '/globe/earth-blue-marble-2048.jpg';
  });
};

export const loadGlobeAssets = async () => {
  if (!assetsPromise) {
    assetsPromise = Promise.all([
      import('d3-geo'),
      import('topojson-client'),
      import('../../assets/countries-110m.json'),
      loadEarthTexture()
    ]).then(([d3, topojson, worldModule, earthTexture]) => {
      const worldData = (worldModule as { default?: any }).default ?? worldModule;
      const landObject = worldData.objects.land ?? worldData.objects.countries;
      return {
        geoDistance: d3.geoDistance,
        geoGraticule10: d3.geoGraticule10,
        geoOrthographic: d3.geoOrthographic,
        geoPath: d3.geoPath,
        earthTexture,
        land: topojson.feature(worldData as any, landObject),
        borders: worldData.objects?.countries
          ? topojson.mesh(worldData as any, worldData.objects.countries, (a: any, b: any) => a !== b)
          : null
      };
    });
  }
  return assetsPromise;
};
