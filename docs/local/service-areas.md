# Service areas and sample points

A subject's service areas are a center, a radius, an optional GeoJSON boundary, a time zone, a grid size (3×3 to 7×7) and a ZIP point limit (default 12). Saving an area regenerates its sample points:

- **Grid points:** the centres of an N×N lattice of cells over the area, kept where they fall inside the radius and boundary. Labels such as `3x3 R2C2` stay the same between saves, so unchanged points keep their ids.
- **City centroids:** one per Census place whose centroid falls inside the area, or the nearest one when none does.
- **ZIP points:** the ZCTAs (Census approximations of ZIP codes) whose internal point falls inside the area, most populous first, up to the area's limit. They're for routes that localize by IP egress, which can only target a city or ZIP. ZCTAs with no residents (campuses, airports) are skipped. An area with none inside gets the nearest populated one. Without population loaded, larger land area ranks first instead.

Each point takes the city, state and Google canonical name of the nearest Census place, the ZIP of the nearest ZCTA, and the area's time zone, so provider adapters never geocode at run time. The nearest place is a stand-in for reverse geocoding, so a ZIP on a city's edge can be named after its neighbour. A point that no longer fits after an edit is deactivated rather than deleted, because runs will refer to it.

## Reference data

Points are made from two public-domain Census tables. With them empty, areas still get grid points but no cities, ZIPs or Google names, so load both once per database and again when a new vintage comes out. Existing points keep their old values until their area is saved again. Each load replaces the whole table and is logged in `agency_access_log`.

### Places

`ref_us_places` is the Census gazetteer places file, joined to Google's geotargets list for canonical names such as `Raleigh,North Carolina,United States`:

1. Download and unzip the national **Places** file from the [Census gazetteer files](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) and the latest CSV from [Google's geotargets page](https://developers.google.com/google-ads/api/data/geotargets).
2. Run the loader with the app role's URL:

   ```sh
   cd packages/service
   DATABASE_URL=postgres://visibility_app:...@host/db pnpm load:reference-places 2025_Gaz_place_national.txt geotargets-YYYY-MM-DD.csv
   ```

### ZCTAs

`ref_us_zctas` is the Census gazetteer ZCTA file plus total population from the 2020 Decennial Census (table P1), since the gazetteer has none. Both vintages are stored.

1. Download and unzip the national **ZIP Code Tabulation Areas** file from the [Census gazetteer files](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html), and fetch population for every ZCTA (no API key needed):

   ```sh
   curl -o dhc-2020-p1-zcta.json 'https://data.census.gov/api/access/data/table?id=DECENNIALDHC2020.P1&g=010XX00US$8600000'
   ```

2. Run the loader with the app role's URL:

   ```sh
   cd packages/service
   DATABASE_URL=postgres://visibility_app:...@host/db pnpm load:reference-zctas 2025_Gaz_zcta_national.txt dhc-2020-p1-zcta.json
   ```

The population file is optional; without it ZIP points rank by land area.
