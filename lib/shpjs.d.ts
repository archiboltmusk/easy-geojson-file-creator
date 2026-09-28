declare module "shpjs" {
  import type { FeatureCollection } from "geojson"
  type Layer = FeatureCollection & { fileName?: string }
  export default function shp(input: ArrayBuffer | string | Record<string, unknown>): Promise<Layer | Layer[]>
}
