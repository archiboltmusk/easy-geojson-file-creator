# easy-geojson-file-creator

## Contributing ward data

Ward boundaries go in `data/<state>/<city>/wards.geojson` (lowercase-kebab folders, e.g. `data/west-bengal/purulia/`), with an optional `metadata.json` beside them. Every feature must follow [`schema/ward.schema.json`](schema/ward.schema.json); see [`data/README.md`](data/README.md) for the fields.

```sh
pnpm data:validate   # schema + geometry checks, same as CI
pnpm data:fix        # auto-fix open rings and winding order
```
