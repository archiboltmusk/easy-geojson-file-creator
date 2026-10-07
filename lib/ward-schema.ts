// Properties from schema/ward.schema.json (PR #4), shared by the photo tracer and the file converter.

import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson"

export const MUNICIPALITY_TYPES = [
  "municipal_corporation",
  "municipal_council",
  "nagar_panchayat",
  "town_panchayat",
  "cantonment_board",
  "notified_area_committee",
  "industrial_township",
  "other",
] as const

export type MunicipalityType = (typeof MUNICIPALITY_TYPES)[number]

export type WardMeta = {
  state: string
  district: string
  municipality_name: string
  municipality_type: MunicipalityType
  year_delimited: string
  source_url: string
  license: string
  country: string
}

export const EMPTY_META: WardMeta = {
  state: "",
  district: "",
  municipality_name: "",
  municipality_type: "municipal_council",
  year_delimited: "",
  source_url: "",
  license: "",
  country: "IN",
}

export type WardProperties = {
  state: string
  district: string
  municipality_name: string
  municipality_type: MunicipalityType
  ward_number: number | string
  ward_name: string | null
  year_delimited: number | null
  source_url: string
  license: string
  country: string
}

/** "7" -> 7, "12A" -> "12A", "Ward 5" -> 5, anything else -> null. */
export function parseWardNumber(value: unknown): number | string | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null
  if (typeof value !== "string") return null
  const m = value.trim().match(/^(?:ward\s*(?:no\.?|number)?\s*)?(\d+)([A-Za-z]?)$/i)
  if (!m) return null
  return m[2] ? `${Number(m[1])}${m[2].toUpperCase()}` : Number(m[1])
}

export function metaIssues(meta: WardMeta): string[] {
  const issues: string[] = []
  if (!meta.state.trim()) issues.push("State is missing.")
  if (!meta.district.trim()) issues.push("District is missing.")
  if (!meta.municipality_name.trim()) issues.push("Municipality name is missing.")
  if (!/^https?:\/\/\S+$/.test(meta.source_url.trim())) issues.push("Source URL must start with http:// or https://.")
  if (!meta.license.trim()) issues.push("License is missing (e.g. CC-BY-4.0, ODbL-1.0).")
  const year = meta.year_delimited.trim()
  if (year && !(/^\d{4}$/.test(year) && +year >= 1900 && +year <= 2100)) issues.push("Year delimited must be a year like 2022, or empty.")
  if (meta.country && !/^[A-Z]{2}$/.test(meta.country)) issues.push("Country must be a two-letter code like IN.")
  return issues
}

export function wardProperties(meta: WardMeta, wardNumber: number | string, wardName: string | null): WardProperties {
  const year = meta.year_delimited.trim()
  return {
    state: meta.state.trim(),
    district: meta.district.trim(),
    municipality_name: meta.municipality_name.trim(),
    municipality_type: meta.municipality_type,
    ward_number: wardNumber,
    ward_name: wardName?.trim() ? wardName.trim() : null,
    year_delimited: year ? Number(year) : null,
    source_url: meta.source_url.trim(),
    license: meta.license.trim(),
    country: meta.country.trim() || "IN",
  }
}

/** Problems with a set of wards: missing/duplicate numbers. */
export function wardNumberIssues(numbers: (number | string | null)[]): string[] {
  const issues: string[] = []
  const missing = numbers.filter((n) => n === null).length
  if (missing) issues.push(`${missing} ward${missing > 1 ? "s have" : " has"} no ward number.`)
  const seen = new Map<string, number>()
  for (const n of numbers) if (n !== null) seen.set(String(n), (seen.get(String(n)) ?? 0) + 1)
  const dups = [...seen].filter(([, c]) => c > 1).map(([n]) => n)
  if (dups.length) issues.push(`Ward number${dups.length > 1 ? "s" : ""} used more than once: ${dups.join(", ")}.`)
  return issues
}

export type ColumnMapping = { wardNumber: string; wardName: string | null }

/** Guesses which source columns hold the ward number and name. */
export function guessColumns(fields: string[]): ColumnMapping {
  const find = (patterns: RegExp[]) => {
    for (const p of patterns) {
      const hit = fields.find((f) => p.test(f))
      if (hit) return hit
    }
    return null
  }
  return {
    wardNumber: find([/^ward_?(no|num|number)$/i, /^ward_?id$/i, /^ward$/i, /ward.*(no|num)/i, /^(no|number)$/i, /ward/i]) ?? fields[0] ?? "",
    wardName: find([/^ward_?name$/i, /^name$/i, /name/i]),
  }
}

const isPolygonal = (g: Geometry | null): g is Polygon | MultiPolygon => !!g && (g.type === "Polygon" || g.type === "MultiPolygon")

export type MappedWards = { collection: FeatureCollection<Polygon | MultiPolygon, WardProperties>; skipped: string[] }

/** Rewrites any polygon FeatureCollection into the ward schema using a column mapping. */
export function mapToWardSchema(collection: FeatureCollection, mapping: ColumnMapping, meta: WardMeta): MappedWards {
  const skipped: string[] = []
  const features: Feature<Polygon | MultiPolygon, WardProperties>[] = []
  collection.features.forEach((f, i) => {
    if (!isPolygonal(f.geometry)) {
      skipped.push(`Feature ${i + 1} is a ${f.geometry?.type ?? "empty geometry"}, not a polygon.`)
      return
    }
    const props = f.properties ?? {}
    const number = parseWardNumber(props[mapping.wardNumber])
    if (number === null) {
      skipped.push(`Feature ${i + 1}: "${String(props[mapping.wardNumber] ?? "")}" in ${mapping.wardNumber} is not a ward number.`)
      return
    }
    const rawName = mapping.wardName ? props[mapping.wardName] : null
    features.push({ type: "Feature", properties: wardProperties(meta, number, rawName == null ? null : String(rawName)), geometry: f.geometry })
  })
  return { collection: { type: "FeatureCollection", features }, skipped }
}
