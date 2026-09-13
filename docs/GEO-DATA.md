# City-level station locations

`apps/api/src/catalog/russianCities.ts` is a derived Russian subset of
[GeoNames cities1000](https://download.geonames.org/export/dump/), including
alternative city names. GeoNames data is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Coordinates identify populated places, not radio studios or transmitters.
The map credits GeoNames in its attribution control.

Snapshot prepared 2026-09-13 from the GeoNames mirror in
[geonamescache 3.0.2](https://pypi.org/project/geonamescache/3.0.2/), released
2026-07-28. The wheel SHA-256 is
`b830e8942f2d58c7e68782dcf4dff2ffe8c4104a35ee881ed1ad4023cefcdba4`.
Only its public city JSON was extracted; the package is not installed or used
at runtime. Direct GeoNames downloads timed out on this connection.

Reproduce from that snapshot:

```powershell
python -m pip download --no-deps --dest .tmp geonamescache==3.0.2
python scripts/buildRussianCityGazetteer.py .tmp/geonamescache-3.0.2-py3-none-any.whl
```

Running the generator without an argument downloads the current upstream
cities1000 ZIP. Review the resulting diff and ambiguity tests before adopting
an updated snapshot. The generated lookup lives in the API bundle only.

Resolution is limited to RU and exact aliases in the station's `state` field.
It ignores station names, rejects ambiguous aliases, and never picks a city
by popularity or synthesizes positions inside a country. Explicit catalogue
coordinates take priority. Other countries and unresolved regions remain
unlocated. `cityLocation` is separate from `lat`/`lon` in the points API, so
legacy clients retain their existing semantics. The calm Explorer opts in and
labels these locations as city-level approximations.
