import { kml } from "@tmcw/togeojson"
import type { Feature, FeatureCollection, Geometry, Position } from "geojson"
import JSZip from "jszip"
import shp from "shpjs"
import { makeTransform, normalizeCrs } from "./crs"

export type SourceFormat = "shapefile" | "kml" | "kmz" | "geojson"

export type ConvertOptions = {
  /** CRS to assume when the file does not declare one (e.g. a Shapefile zip without .prj). */
  crs?: string
}

export type ConvertResult = {
  collection: FeatureCollection
  format: SourceFormat
  /** CRS the coordinates were read from, or null when they were already WGS 84 / unknown. */
  sourceCrs: string | null
  /** True when coordinates still look projected and the user must pick a CRS. */
  needsCrs: boolean
  bbox: [number, number, number, number] | null
  warnings: string[]
}

export const ACCEPTED_EXTENSIONS = [".zip", ".kml", ".kmz", ".geojson", ".json"]

const DECIMALS = 7

export function detectFormat(fileName: string): SourceFormat | null {
  const ext = fileName.toLowerCase().split(".").pop()
  if (ext === "zip") return "shapefile"
  if (ext === "kml") return "kml"
  if (ext === "kmz") return "kmz"
  if (ext === "geojson" || ext === "json") return "geojson"
  return null
}

export function outputName(fileName: string) {
  return `${fileName.replace(/\.[^/.]+$/, "") || "output"}.geojson`
}

export async function convertFile(fileName: string, data: ArrayBuffer, options: ConvertOptions = {}): Promise<ConvertResult> {
  const format = detectFormat(fileName)
  if (!format) throw new Error(`Unsupported file type. Use one of: ${ACCEPTED_EXTENSIONS.join(", ")}`)

  const warnings: string[] = []
  let collection: FeatureCollection
  let declaredCrs: string | null = null
  let actualFormat: SourceFormat = format

  if (format === "shapefile") {
    const zip = await JSZip.loadAsync(data)
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.startsWith("__MACOSX/"))
    const lower = names.map((n) => n.toLowerCase())
    if (lower.some((n) => n.endsWith(".shp"))) {
      if (!lower.some((n) => n.endsWith(".dbf"))) warnings.push("No .dbf file in the zip, so features have no attributes.")
      const parsed = await shp(data)
      const layers = Array.isArray(parsed) ? parsed : [parsed]
      if (layers.length > 1) warnings.push(`Merged ${layers.length} layers: ${layers.map((l) => l.fileName).join(", ")}.`)
      collection = { type: "FeatureCollection", features: layers.flatMap((l) => l.features as Feature[]) }
      // shpjs reprojects to WGS 84 itself when it can read the .prj; otherwise coordinates stay raw.
      const hasPrj = lower.some((n) => n.endsWith(".prj"))
      const raw = computeBbox(collection)
      if (hasPrj && raw && isLonLat(raw)) declaredCrs = "EPSG:4326"
      else if (hasPrj) warnings.push("The .prj file couldn't be read. Pick the coordinate system below.")
    } else {
      const kmlName = names.find((n) => n.toLowerCase().endsWith(".kml"))
      if (!kmlName) throw new Error("The zip has no .shp or .kml file inside. A Shapefile zip needs at least .shp (plus .dbf and .prj).")
      actualFormat = "kmz"
      collection = parseKml(await zip.files[kmlName].async("string"))
    }
  } else if (format === "kmz") {
    const zip = await JSZip.loadAsync(data)
    const kmlName = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith(".kml"))
    if (!kmlName) throw new Error("The KMZ has no .kml document inside.")
    collection = parseKml(await zip.files[kmlName].async("string"))
  } else if (format === "kml") {
    collection = parseKml(new TextDecoder().decode(data))
  } else {
    const parsed = parseGeoJson(new TextDecoder().decode(data))
    collection = parsed.collection
    if (parsed.crs) {
      declaredCrs = normalizeCrs(parsed.crs)
      if (!declaredCrs) warnings.push(`The file declares CRS "${parsed.crs}", which isn't supported. Pick one below.`)
    }
  }

  // KML is WGS 84 by definition.
  if (actualFormat === "kml" || actualFormat === "kmz") declaredCrs = "EPSG:4326"

  const chosen = options.crs ? normalizeCrs(options.crs) : null
  if (options.crs && !chosen) throw new Error(`Unknown coordinate system "${options.crs}".`)
  const sourceCrs = declaredCrs && declaredCrs !== "EPSG:4326" ? declaredCrs : !declaredCrs ? chosen : null
  const transform = sourceCrs ? makeTransform(sourceCrs) : null

  let dropped = 0
  const features: Feature[] = []
  for (const feature of collection.features) {
    if (!feature.geometry) {
      dropped++
      continue
    }
    features.push({ type: "Feature", properties: feature.properties ?? {}, geometry: mapGeometry(feature.geometry, (p) => round(transform ? transform(p) : p)) })
  }
  if (dropped) warnings.push(`Skipped ${dropped} feature${dropped === 1 ? "" : "s"} without geometry.`)
  if (!features.length) throw new Error("No features with geometry were found in this file.")

  const result: FeatureCollection = { type: "FeatureCollection", features }
  const bbox = computeBbox(result)
  const needsCrs = !!bbox && !isLonLat(bbox)
  if (needsCrs) warnings.push("Coordinates look projected (metres, not degrees). Choose the coordinate system the data was made in.")

  return { collection: result, format: actualFormat, sourceCrs, needsCrs, bbox, warnings }
}

function parseKml(text: string): FeatureCollection {
  const doc = new DOMParser().parseFromString(text, "text/xml")
  if (doc.getElementsByTagName("parsererror").length) throw new Error("This KML file is not valid XML.")
  return kml(doc) as FeatureCollection
}

function parseGeoJson(text: string): { collection: FeatureCollection; crs?: string } {
  let json: { type?: string; crs?: { properties?: { name?: string } }; features?: Feature[]; geometry?: Geometry }
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error("This file is not valid JSON.")
  }
  const crs = json.crs?.properties?.name
  if (json.type === "FeatureCollection" && Array.isArray(json.features)) return { collection: json as FeatureCollection, crs }
  if (json.type === "Feature") return { collection: { type: "FeatureCollection", features: [json as Feature] }, crs }
  if ((json.type && "coordinates" in json) || json.type === "GeometryCollection") return { collection: { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: json as Geometry }] }, crs }
  throw new Error("This JSON is not GeoJSON (expected a FeatureCollection, Feature or geometry).")
}

export function mapGeometry(geometry: Geometry, fn: (p: Position) => Position): Geometry {
  switch (geometry.type) {
    case "Point": return { type: "Point", coordinates: fn(geometry.coordinates) }
    case "MultiPoint":
    case "LineString": return { type: geometry.type, coordinates: geometry.coordinates.map(fn) } as Geometry
    case "MultiLineString":
    case "Polygon": return { type: geometry.type, coordinates: geometry.coordinates.map((r) => r.map(fn)) } as Geometry
    case "MultiPolygon": return { type: "MultiPolygon", coordinates: geometry.coordinates.map((p) => p.map((r) => r.map(fn))) }
    case "GeometryCollection": return { type: "GeometryCollection", geometries: geometry.geometries.map((g) => mapGeometry(g, fn)) }
  }
}

function round(p: Position): Position {
  const f = 10 ** DECIMALS
  return p.map((v) => Math.round(v * f) / f)
}

export function computeBbox(fc: FeatureCollection): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const f of fc.features) {
    if (!f.geometry) continue
    mapGeometry(f.geometry, (p) => {
      if (p[0] < minX) minX = p[0]
      if (p[1] < minY) minY = p[1]
      if (p[0] > maxX) maxX = p[0]
      if (p[1] > maxY) maxY = p[1]
      return p
    })
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null
}

function isLonLat([minX, minY, maxX, maxY]: [number, number, number, number]) {
  return minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90
}

export function summarize(fc: FeatureCollection) {
  const geometryTypes: Record<string, number> = {}
  const fields = new Set<string>()
  for (const f of fc.features) {
    const t = f.geometry?.type ?? "None"
    geometryTypes[t] = (geometryTypes[t] ?? 0) + 1
    for (const k of Object.keys(f.properties ?? {})) fields.add(k)
  }
  return { count: fc.features.length, geometryTypes, fields: [...fields] }
}
