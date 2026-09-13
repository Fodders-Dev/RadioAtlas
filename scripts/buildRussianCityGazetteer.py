"""Rebuild the RU city lookup from GeoNames cities1000 (CC BY 4.0).

Run manually: python scripts/buildRussianCityGazetteer.py
No station data is sent to GeoNames. Ambiguous aliases remain in the source
so the runtime can reject them rather than selecting the largest city.
"""
import io
import json
from pathlib import Path
import urllib.request
import zipfile
import sys

URL = 'https://download.geonames.org/export/dump/cities1000.zip'
if len(sys.argv) > 1:
    archive = zipfile.ZipFile(sys.argv[1])
else:
    with urllib.request.urlopen(URL, timeout=120) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
rows = []
if 'geonamescache/data/cities1000.json' in archive.namelist():
    data = json.loads(archive.read('geonamescache/data/cities1000.json'))
    for city in data.values():
        if city['countrycode'] == 'RU':
            names = sorted(set([city['name'], *city['alternatenames']]) - {''})
            rows.append([city['geonameid'], city['name'], city['latitude'], city['longitude'], names])
else:
    for line in archive.read('cities1000.txt').decode('utf-8').splitlines():
        fields = line.split('\t')
        if fields[8] != 'RU' or fields[6] != 'P':
            continue
        names = sorted(set([fields[1], fields[2], *fields[3].split(',')]) - {''})
        rows.append([int(fields[0]), fields[1], float(fields[4]), float(fields[5]), names])
rows.sort(key=lambda row: row[0])
target = Path(__file__).resolve().parents[1] / 'apps/api/src/catalog/russianCities.ts'
target.write_text(
    '// Generated from GeoNames cities1000; CC BY 4.0. See docs/GEO-DATA.md.\n'
    '// Do not edit by hand; run scripts/buildRussianCityGazetteer.py.\n'
    'export const russianCities: Array<[number, string, number, number, string[]]> = [\n'
    + ',\n'.join(json.dumps(row, ensure_ascii=False, separators=(',', ':')) for row in rows)
    + '\n];\n', encoding='utf-8')
print(f'{len(rows)} populated places; {target.stat().st_size} bytes')
