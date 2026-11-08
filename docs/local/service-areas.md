# Service areas and sample points

A subject's service areas are a center, a radius, an optional GeoJSON boundary, a time zone and a grid size (3×3 to 7×7). Saving an area regenerates its sample points:

- **Grid points:** the centres of an N×N lattice of cells over the area, kept where they fall inside the radius and boundary. Labels such as `3x3 R2C2` stay the same between saves, so unchanged points keep their ids.
- **City centroids:** one per Census place whose centroid falls inside the area, or the nearest one when none does.

Each point takes the city, state and Google canonical name of the nearest Census place, and the area's time zone, so provider adapters never geocode at run time. A point that no longer fits after an edit is deactivated rather than deleted, because runs will refer to it. ZIP-grid points (`kind = 'zip'`) come with the ZIP-grid story and are left alone here.

## Reference data

Points are made from `ref_us_places`: the Census gazetteer places file (public domain), joined to Google's geotargets list for canonical names such as `Raleigh,North Carolina,United States`. With the table empty, areas still get grid points but no cities or Google names, so load it once per database and again when a new vintage comes out:

1. Download and unzip the national **Places** file from the [Census gazetteer files](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) and the latest CSV from [Google's geotargets page](https://developers.google.com/google-ads/api/data/geotargets).
2. Run the loader with the app role's URL:

   ```sh
   cd packages/service
   DATABASE_URL=postgres://visibility_app:...@host/db pnpm load:reference-places 2025_Gaz_place_national.txt geotargets-YYYY-MM-DD.csv
   ```

The load replaces the whole table and is logged in `agency_access_log`. Existing points keep their old names until their area is saved again.
