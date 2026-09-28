import proj4 from "proj4"

export type CrsPreset = { code: string; label: string; region: string }

// Kalianpur 1975 (Everest 1830) Lambert zones used by Survey of India era municipal maps.
// 3-parameter datum shift: expect roughly tens of metres of accuracy, fine for ward boundaries.
const kalianpur = "+a=6377299.151 +rf=300.8017255 +towgs84=295,736,257,0,0,0,0 +units=m +no_defs"
const lcc = (lat: number, lon: number) => `+proj=lcc +lat_1=${lat} +lat_0=${lat} +lon_0=${lon} +k_0=0.99878641 +x_0=2743195.5 +y_0=914398.5 ${kalianpur}`

proj4.defs([
  ["EPSG:24378", lcc(32.5, 68)],
  ["EPSG:24379", lcc(26, 74)],
  ["EPSG:24380", lcc(26, 90)],
  ["EPSG:24381", lcc(19, 80)],
  ["EPSG:24383", lcc(12, 80)],
])

export const CRS_PRESETS: CrsPreset[] = [
  { code: "EPSG:32642", label: "WGS 84 / UTM zone 42N", region: "Gujarat west, Rajasthan west" },
  { code: "EPSG:32643", label: "WGS 84 / UTM zone 43N", region: "Maharashtra, Karnataka, Kerala, Gujarat, Punjab, Delhi" },
  { code: "EPSG:32644", label: "WGS 84 / UTM zone 44N", region: "UP, MP, Telangana, Andhra, Tamil Nadu, Chhattisgarh" },
  { code: "EPSG:32645", label: "WGS 84 / UTM zone 45N", region: "West Bengal, Bihar, Jharkhand, Odisha, Sikkim" },
  { code: "EPSG:32646", label: "WGS 84 / UTM zone 46N", region: "Assam, Meghalaya, Tripura, Mizoram, Manipur" },
  { code: "EPSG:32647", label: "WGS 84 / UTM zone 47N", region: "Arunachal Pradesh east" },
  { code: "EPSG:24378", label: "Kalianpur 1975 / India zone I", region: "J&K, Himachal, Punjab (old SOI maps)" },
  { code: "EPSG:24379", label: "Kalianpur 1975 / India zone IIa", region: "Rajasthan, UP west, MP north (old SOI maps)" },
  { code: "EPSG:24380", label: "Kalianpur 1975 / India zone IIb", region: "West Bengal, Bihar, North-East (old SOI maps)" },
  { code: "EPSG:24381", label: "Kalianpur 1975 / India zone IIIa", region: "Maharashtra, Odisha, Telangana (old SOI maps)" },
  { code: "EPSG:24383", label: "Kalianpur 1975 / India zone IVa", region: "Karnataka, Tamil Nadu, Kerala (old SOI maps)" },
  { code: "EPSG:3857", label: "Web Mercator", region: "Exports from web maps" },
]

/** Accepts "EPSG:32645", "32645", "urn:ogc:def:crs:EPSG::32645" or a proj4/WKT string. */
export function normalizeCrs(input: string): string | null {
  const trimmed = input.trim()
  if (/^(urn:ogc:def:crs:)?OGC:(1\.3:)?CRS84$/i.test(trimmed)) return "EPSG:4326"
  const epsg = trimmed.match(/EPSG:{1,2}(\d+)$/i) ?? trimmed.match(/^(\d{4,6})$/)
  const code = epsg ? `EPSG:${epsg[1]}` : trimmed
  try {
    proj4(code, "EPSG:4326")
    return code
  } catch {
    return null
  }
}

export function makeTransform(from: string): (xy: number[]) => number[] {
  const converter = proj4(from, "EPSG:4326")
  return ([x, y, ...rest]) => [...converter.forward([x, y]), ...rest]
}
