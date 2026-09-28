# Data

Boundary files live at `data/<State>/<City>/<city>_<boundary_type>s.geojson`, each with a `metadata.json` beside it.
`West_Bengal/Purulia/` is the reference example.

## Civic schema (v0.1)

Every feature is a `Polygon` or `MultiPolygon` in WGS84 (RFC 7946) with these properties:

| Property | Example | Notes |
|---|---|---|
| `id` | `IN-WB-PURULIA-W01` | Country-state-city-type+number; also set as the feature `id` |
| `name` | `Ward 1` | Display name |
| `ward_no` | `1` | Number, for `boundary_type: "ward"` |
| `boundary_type` | `ward` | `ward`, `zone`, `block`, `gram_panchayat`, ... |
| `local_body` | `Purulia Municipality` | The body that governs the area |
| `district` | `Purulia` | |
| `state` | `West Bengal` | |
| `country` | `IN` | ISO 3166-1 alpha-2 |

## metadata.json

Says where the data came from (`source` with URL, licence and attribution), how accurate it is, what is missing, and what was changed (`processing`). See `West_Bengal/Purulia/metadata.json`.
