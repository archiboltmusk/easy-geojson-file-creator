// Known ward extents. Picking one stretches the traced wards over that box, as a rough
// starting point before adding control points. The box comes from existing data in data/.

import type { WardMeta } from "../ward-schema"

export type AreaPreset = { id: string; label: string; bbox: [number, number, number, number]; meta: Partial<WardMeta> }

export const AREA_PRESETS: AreaPreset[] = [
  {
    id: "purulia",
    label: "Purulia Municipality, West Bengal",
    // data/west-bengal/purulia/metadata.json (22 of 23 wards, so this box may be slightly small).
    bbox: [86.344758, 23.308208, 86.391489, 23.346393],
    meta: { state: "West Bengal", district: "Purulia", municipality_name: "Purulia Municipality", municipality_type: "municipal_council", country: "IN" },
  },
]
