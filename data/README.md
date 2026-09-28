# Ward boundary data

One file per city:

```
data/<state>/<city>/wards.geojson
```

- `<state>` and `<city>` are lowercase-kebab slugs, e.g. `data/tamil-nadu/chennai/wards.geojson`. The state folder must match the `state` property.
- An optional `metadata.json` beside it can record accuracy notes, missing wards and processing steps; the validator ignores it.
- Each file is a GeoJSON `FeatureCollection` in WGS84 `[longitude, latitude]`, one `Polygon` or `MultiPolygon` feature per ward.
- Every feature carries the properties in [`schema/ward.schema.json`](../schema/ward.schema.json):

| Property | Type | Example |
| --- | --- | --- |
| `state` | string | `"Tamil Nadu"` |
| `district` | string | `"Chennai"` |
| `municipality_name` | string | `"Greater Chennai Corporation"` |
| `municipality_type` | enum | `municipal_corporation`, `municipal_council`, `nagar_panchayat`, `town_panchayat`, `cantonment_board`, `notified_area_committee`, `industrial_township`, `other` |
| `ward_number` | integer, or string like `"12A"` | `42` |
| `ward_name` | string or `null` | `"Mylapore"` |
| `year_delimited` | integer, or `null` if unknown | `2022` |
| `source_url` | http(s) URL | link to the notification or dataset |
| `license` | string (SPDX where possible) | `"ODbL-1.0"`, `"CC-BY-4.0"`, `"GODL-India"` |
| `country` (optional) | ISO 3166-1 alpha-2 | `"IN"` |

The feature may also carry a stable top-level `id`, e.g. `IN-WB-PURULIA-W01`. Extra properties are allowed.

## Checking your file

```sh
pnpm install
pnpm data:validate          # check everything under data/
pnpm data:fix               # close open rings and fix winding order in place
```

The same check runs on every pull request that touches `data/` or `schema/`. It fails on:

- missing or malformed properties
- rings that are not closed or have fewer than 4 positions
- wrong winding order (RFC 7946: exterior counterclockwise, holes clockwise)
- coordinates outside lon -180..180 / lat -90..90 (usually projected or swapped lat/lon)
- duplicate `ward_number`, or mixed `state` / `municipality_name` in one file
- files outside the `data/<state>/<city>/wards.geojson` layout
