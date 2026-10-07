// The editable ward model (pixel coordinates) and the edits the editor offers.

import type { Feature, FeatureCollection, Polygon } from "geojson"
import polygonClipping from "polygon-clipping"
import { parseWardNumber, wardProperties, type WardMeta, type WardProperties } from "../ward-schema"
import { applyGeoref, type Georef } from "./georef"
import { ringArea, type DetectedRegion, type Pt } from "./segment"

export type Ward = {
  id: string
  /** Open ring (first point not repeated), pixel coordinates. */
  ring: Pt[]
  number: string
  name: string
  /** Where the number came from, so the UI can ask people to double-check guesses. */
  numberSource: "ocr" | "manual" | "none"
}

let counter = 0
export const newWardId = () => `w${Date.now().toString(36)}${(counter++).toString(36)}`

export function wardsFromRegions(regions: DetectedRegion[], numbers: Map<number, string> = new Map()): Ward[] {
  return regions.map((r) => {
    const n = numbers.get(r.label)
    return { id: newWardId(), ring: r.ring.map((p) => [p[0], p[1]] as Pt), number: n ?? "", name: "", numberSource: n ? "ocr" : "none" }
  })
}

const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6

/** Every (ward, vertex) sitting on the same spot, so shared corners move together. */
export function sharedVertices(wards: Ward[], at: Pt): { wardId: string; index: number }[] {
  const hits: { wardId: string; index: number }[] = []
  for (const w of wards) w.ring.forEach((p, index) => { if (same(p, at)) hits.push({ wardId: w.id, index }) })
  return hits
}

export function moveVertices(wards: Ward[], targets: { wardId: string; index: number }[], to: Pt): Ward[] {
  const byWard = new Map<string, number[]>()
  for (const t of targets) byWard.set(t.wardId, [...(byWard.get(t.wardId) ?? []), t.index])
  return wards.map((w) => {
    const idx = byWard.get(w.id)
    if (!idx) return w
    const ring = w.ring.slice()
    for (const i of idx) ring[i] = [to[0], to[1]]
    return { ...w, ring }
  })
}

export function insertVertex(ward: Ward, afterIndex: number, at: Pt): Ward {
  const ring = ward.ring.slice()
  ring.splice(afterIndex + 1, 0, [at[0], at[1]])
  return { ...ward, ring }
}

export function removeVertex(ward: Ward, index: number): Ward | null {
  if (ward.ring.length <= 3) return null
  return { ...ward, ring: ward.ring.filter((_, i) => i !== index) }
}

/** Cuts a ward in two along a straight line between two of its corners. */
export function splitWard(ward: Ward, i: number, j: number): [Ward, Ward] {
  const n = ward.ring.length
  const a = Math.min(i, j)
  const b = Math.max(i, j)
  if (b - a < 2 || n - (b - a) < 2) throw new Error("Pick two corners that are not next to each other.")
  const first = ward.ring.slice(a, b + 1)
  const second = [...ward.ring.slice(b), ...ward.ring.slice(0, a + 1)]
  return [
    { ...ward, ring: first },
    { ...ward, id: newWardId(), ring: second, number: "", name: "", numberSource: "none" },
  ]
}

const closed = (ring: Pt[]): Pt[] => [...ring, ring[0]]

/** Joins two wards that touch. Keeps the first ward's number and name. */
export function mergeWards(a: Ward, b: Ward): Ward {
  const result = polygonClipping.union([closed(a.ring)], [closed(b.ring)])
  if (result.length !== 1) throw new Error("These wards don't share a boundary, so they can't be merged.")
  const outer = result[0][0].slice(0, -1) as Pt[]
  // Keep the screen-clockwise orientation the rest of the editor uses.
  const ring = ringArea(outer) < 0 ? outer.reverse() : outer
  return { ...a, ring, number: a.number || b.number, name: a.name || b.name, numberSource: a.number ? a.numberSource : b.numberSource }
}

/** Pixel ring -> closed lng/lat ring, exterior counter-clockwise per RFC 7946. */
export function toLngLatRing(ring: Pt[], g: Georef): [number, number][] {
  const round = (v: number) => Math.round(v * 1e7) / 1e7
  const pts = ring.map((p) => applyGeoref(g, p)).map(([x, y]) => [round(x), round(y)] as Pt)
  if (ringArea(pts) < 0) pts.reverse()
  return closed(pts)
}

export type WardExport = { collection: FeatureCollection<Polygon, WardProperties>; problems: string[] }

export function exportWards(wards: Ward[], g: Georef, meta: WardMeta): WardExport {
  const problems: string[] = []
  const features: Feature<Polygon, WardProperties>[] = []
  for (const w of wards) {
    const number = parseWardNumber(w.number)
    if (number === null) {
      problems.push(w.number ? `"${w.number}" is not a ward number (use digits, optionally one letter, e.g. 12A).` : "A ward has no number.")
      continue
    }
    features.push({ type: "Feature", properties: wardProperties(meta, number, w.name || null), geometry: { type: "Polygon", coordinates: [toLngLatRing(w.ring, g)] } })
  }
  features.sort((x, y) => String(x.properties.ward_number).localeCompare(String(y.properties.ward_number), undefined, { numeric: true }))
  return { collection: { type: "FeatureCollection", features }, problems }
}

export function wardsBBox(wards: Ward[]): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const w of wards) for (const [x, y] of w.ring) {
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null
}

/** Adds a corner on edge a-b of every ward that has that edge, so neighbours stay joined. */
export function insertOnSharedEdge(wards: Ward[], a: Pt, b: Pt, at: Pt): Ward[] {
  return wards.map((w) => {
    const n = w.ring.length
    for (let i = 0; i < n; i++) {
      const p = w.ring[i]
      const q = w.ring[(i + 1) % n]
      if ((same(p, a) && same(q, b)) || (same(p, b) && same(q, a))) return insertVertex(w, i, at)
    }
    return w
  })
}

/** Removes a corner from every ward that has it. Wards that would drop below 3 corners keep theirs. */
export function removeSharedVertex(wards: Ward[], at: Pt): Ward[] {
  return wards.map((w) => {
    const i = w.ring.findIndex((p) => same(p, at))
    return i < 0 ? w : removeVertex(w, i) ?? w
  })
}

/** Nearest edge of a ring to a point: index of its first corner and the closest point on it. */
export function nearestEdge(ring: Pt[], [px, py]: Pt): { index: number; point: Pt; distance: number } {
  let best = { index: 0, point: ring[0], distance: Infinity }
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]
    const [bx, by] = ring[(i + 1) % ring.length]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
    const point: Pt = [ax + t * dx, ay + t * dy]
    const distance = Math.hypot(px - point[0], py - point[1])
    if (distance < best.distance) best = { index: i, point, distance }
  }
  return best
}
