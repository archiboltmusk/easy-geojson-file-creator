# easy-geojson-file-creator (CivicShape)

Turn municipal map files into clean GeoJSON in the browser. No GIS software, no uploads.

Most Indian cities publish ward boundaries as shapefiles in local projections, KML from Google Earth, or only as PDFs in delimitation gazettes. CivicShape aims to let anyone (civic volunteers, researchers, municipal staff) turn what their city released into standard WGS 84 GeoJSON, check it on a map, and share it in one open, consistently structured directory.

## What works today

- Drop a **zipped Shapefile** (`.shp` + `.dbf` + `.prj`), **KML**, **KMZ** or **GeoJSON**.
- Coordinates are reprojected to **WGS 84 (EPSG:4326)**: automatically from the `.prj` or a GeoJSON `crs` member, or from a dropdown of Indian UTM zones and Kalianpur 1975 zones when the file doesn't say.
- The result is drawn over OpenStreetMap (MapLibre GL) so a wrong projection is obvious, then downloaded as `<name>.geojson`.
- Everything runs client-side. Your file never leaves the browser.

## Roadmap

- [x] Vector conversion: Shapefile, KML/KMZ, GeoJSON with reprojection and map preview
- [x] Reference dataset: [Purulia wards](data/west-bengal/purulia/)
- [ ] Map your file's columns to the ward schema (e.g. "which column is the ward number?")
- [ ] More inputs: GeoPackage (`.gpkg`) and CAD (`.dxf`)
- [ ] Trace a city from a PDF or scanned map: georeference the image over OpenStreetMap, then draw wards
- [ ] "Contribute to the directory" button that opens a pull request with your converted file

## Ward data directory

Converted boundaries are collected under [`data/`](data/), one folder per city:

```
data/
└── west-bengal/            # state, lowercase-kebab
    └── purulia/            # city, lowercase-kebab
        ├── wards.geojson   # FeatureCollection, one Polygon/MultiPolygon per ward
        └── metadata.json   # optional: source, accuracy, missing wards, processing steps
```

Every ward feature carries the same properties, so data from different cities can be combined:

```json
{
  "state": "West Bengal",
  "district": "Purulia",
  "municipality_name": "Purulia Municipality",
  "municipality_type": "municipal_council",
  "ward_number": 1,
  "ward_name": null,
  "year_delimited": null,
  "source_url": "https://...",
  "license": "MIT"
}
```

The full definition is [`schema/ward.schema.json`](schema/ward.schema.json), with a field-by-field table in [`data/README.md`](data/README.md).

## Contributing

### Add your city's wards

1. Convert your city's file with CivicShape (or any tool) to WGS 84 GeoJSON.
2. Rename or add properties so each feature matches the schema above. Record where the data came from in `source_url` and its license in `license`.
3. Save it as `data/<state>/<city>/wards.geojson`, and add a `metadata.json` if there's anything a user should know (traced by hand, wards missing, which year's delimitation).
4. Check it locally, then open a pull request:

   ```sh
   pnpm install
   pnpm data:validate   # schema + geometry checks, same as CI
   pnpm data:fix        # auto-fix open rings and winding order
   ```

CI runs the same check on every pull request that touches `data/`. It rejects missing properties, unclosed rings, wrong winding order, projected or swapped coordinates, and duplicate ward numbers.

Only contribute data you're allowed to share. Official gazette maps, open-data portals and your own tracing are usually fine; say which in `metadata.json`.

### Improve the app

```sh
pnpm install
pnpm dev      # http://localhost:3000
pnpm test     # vitest: conversion + reprojection
pnpm lint
pnpm build
```

Conversion logic lives in `lib/convert.ts` and `lib/crs.ts`; the UI is `components/Converter.tsx` and `components/MapPreview.tsx`. Check the roadmap above or open an issue before starting something large.

`.pnpmfile.cjs` points typescript-eslint at the TypeScript 6 API, since it doesn't load under TypeScript 7 yet. It can go once [typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940) ships.
