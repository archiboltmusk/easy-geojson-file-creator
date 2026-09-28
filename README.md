# easy-geojson-file-creator (CivicShape)

Turn municipal map files into clean GeoJSON in the browser. No GIS software, no uploads.

## What works today

- Drop a **zipped Shapefile** (`.shp` + `.dbf` + `.prj`), **KML**, **KMZ** or **GeoJSON**.
- Coordinates are reprojected to **WGS 84 (EPSG:4326)**: automatically from the `.prj` or a GeoJSON `crs` member, or from a dropdown of Indian UTM zones and Kalianpur 1975 zones when the file doesn't say.
- The result is drawn over OpenStreetMap (MapLibre GL) so a wrong projection is obvious, then downloaded as `<name>.geojson`.

## Develop

```sh
pnpm install
pnpm dev      # http://localhost:3000
pnpm test     # vitest: conversion + reprojection
pnpm build
```

Conversion logic lives in `lib/convert.ts` and `lib/crs.ts`; the UI is `components/Converter.tsx` and `components/MapPreview.tsx`.
