import { readFile, writeFile } from 'node:fs/promises';
import { geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const source = new URL('../src/assets/countries-110m.json', import.meta.url);
const target = new URL('../src/assets/home-atlas.json', import.meta.url);
const topology = JSON.parse(await readFile(source, 'utf8'));
const countries = feature(topology, topology.objects.countries);
const land = feature(topology, topology.objects.land);
const projection = geoNaturalEarth1().fitSize([720, 340], land);
const path = geoPath(projection);
const data = {
  width: 720,
  height: 340,
  scale: projection.scale(),
  translate: projection.translate(),
  land: path(land),
  graticule: path(geoGraticule10()),
  countries: countries.features.flatMap((country) => {
    const d = path(country);
    if (!d) return [];
    const [[x0, y0], [x1, y1]] = path.bounds(country);
    return [{ id: String(country.id ?? country.properties?.name ?? ''), name: country.properties?.name ?? '', d, bounds: [x0, y0, x1, y1] }];
  })
};
await writeFile(target, `${JSON.stringify(data)}\n`);
