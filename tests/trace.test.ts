import type { FeatureCollection, Polygon } from "geojson"
import { readFileSync } from "node:fs"
import polygonClipping from "polygon-clipping"
import { describe, expect, it } from "vitest"
import { applyGeoref, fitGeoref, georefFromBoxes, residuals } from "../lib/trace/georef"
import { pickNumber, wardCrop } from "../lib/trace/numbers"
import { detectRegions, ringArea, type Pt } from "../lib/trace/segment"
import { exportWards, mergeWards, splitWard, wardsFromRegions, type Ward } from "../lib/trace/wards"
import { EMPTY_META, guessColumns, mapToWardSchema, metaIssues, parseWardNumber, wardNumberIssues } from "../lib/ward-schema"
import { blank, drawLine, drawRing, fillRect } from "./helpers/raster"

const META = { ...EMPTY_META, state: "West Bengal", district: "Purulia", municipality_name: "Purulia Municipality", source_url: "https://example.org/map", license: "CC-BY-4.0" }

function polyArea(p: Pt[][]) {
  return p.reduce((s, ring, i) => s + (i === 0 ? 1 : -1) * Math.abs(ringArea(ring)), 0)
}
function area(mp: Pt[][][]) {
  return mp.reduce((s, p) => s + polyArea(p), 0)
}
function iou(a: Pt[], b: Pt[]) {
  const A: Pt[][] = [[...a, a[0]]]
  const B: Pt[][] = [[...b, b[0]]]
  const inter = area(polygonClipping.intersection(A, B) as Pt[][][])
  const uni = area(polygonClipping.union(A, B) as Pt[][][])
  return uni ? inter / uni : 0
}

describe("detectRegions", () => {
  it("finds the cells of a hand-drawn grid and makes neighbours share edges", () => {
    const img = blank(300, 200)
    drawRing(img, [[20, 20], [280, 20], [280, 180], [20, 180]], 4)
    drawLine(img, [150, 20], [150, 180], 4)
    drawLine(img, [20, 100], [150, 100], 4)
    const { regions } = detectRegions(img)
    expect(regions).toHaveLength(3)
    const [big, a, b] = regions
    expect(big.area).toBeGreaterThan(a.area * 1.5)
    // Lines are 4px wide; wards grow into them, so the three cells cover the framed area almost exactly.
    const total = regions.reduce((s, r) => s + r.area, 0)
    expect(total).toBeGreaterThan(258 * 158 * 0.97)
    expect(total).toBeLessThan(262 * 162 * 1.03)
    // Shared boundary vertices are identical, so merging the two small cells gives one polygon.
    const [wa, wb] = wardsFromRegions([a, b])
    expect(mergeWards(wa, wb).ring.length).toBeGreaterThanOrEqual(4)
  })

  it("ignores noise and the digits written inside wards", () => {
    const img = blank(200, 200)
    drawRing(img, [[10, 10], [190, 10], [190, 190], [10, 190]], 3)
    drawRing(img, [[90, 90], [100, 90], [100, 104], [90, 104]], 2) // a "0" drawn in the ward
    const { regions } = detectRegions(img)
    expect(regions).toHaveLength(1)
    expect(regions[0].ring.length).toBeLessThanOrEqual(8)
  })

  it("splits wards that are only told apart by fill colour when edge detection is on", () => {
    const img = blank(200, 100)
    fillRect(img, 10, 10, 100, 90, [240, 200, 120])
    fillRect(img, 100, 10, 190, 90, [150, 210, 240])
    expect(detectRegions(img).regions.length).toBeLessThan(2)
    expect(detectRegions(img, { edge: 60 }).regions).toHaveLength(2)
  })

  it("recovers the Purulia wards from a drawing of them", () => {
    const wards = JSON.parse(readFileSync("data/west-bengal/purulia/wards.geojson", "utf8")) as FeatureCollection<Polygon>
    const [w, s, e, n] = [86.3435, 23.307, 86.3925, 23.3475]
    const W = 1100
    const H = Math.round((W * (n - s)) / ((e - w) * Math.cos((23.33 * Math.PI) / 180)))
    const toPx = ([lng, lat]: number[]): Pt => [((lng - w) / (e - w)) * W, ((n - lat) / (n - s)) * H]
    const img = blank(W, H)
    for (const f of wards.features) drawRing(img, f.geometry.coordinates[0].map(toPx), 2.5)

    const detected = detectRegions(img)
    const g = georefFromBoxes([0, 0, W, H], [w, s, e, n])
    const found = detected.regions.map((r) => r.ring.map((p) => applyGeoref(g, p)))
    let matched = 0
    for (const f of wards.features) {
      const truth = f.geometry.coordinates[0].slice(0, -1) as Pt[]
      const best = Math.max(...found.map((r) => iou(truth, r)))
      if (best > 0.85) matched++
    }
    // The seed is hand-traced, so a few wards leave slivers or overlap neighbours; most should come back cleanly.
    expect(matched).toBeGreaterThanOrEqual(20)
  })
})

describe("georeferencing", () => {
  const truth = (p: Pt): Pt => [86.35 + p[0] * 1e-5 - p[1] * 2e-6, 23.34 - p[1] * 1e-5 + p[0] * 1e-6]
  const pts: Pt[] = [[0, 0], [800, 30], [40, 600], [700, 650], [400, 300]]

  it("fits an affine transform from three points", () => {
    const g = fitGeoref(pts.slice(0, 3).map((p) => ({ pixel: p, lngLat: truth(p) })))!
    expect(g.kind).toBe("affine")
    const [lng, lat] = applyGeoref(g, [400, 300])
    expect(lng).toBeCloseTo(truth([400, 300])[0], 9)
    expect(lat).toBeCloseTo(truth([400, 300])[1], 9)
  })

  it("fits a projective transform from four or more points and undoes photo tilt", () => {
    // A tilted photo: a homography from pixels to lng/lat.
    const tilt = (p: Pt): Pt => {
      const d = 1 + 0.0003 * p[0] + 0.0002 * p[1]
      return truth([p[0] / d, p[1] / d])
    }
    const g = fitGeoref(pts.map((p) => ({ pixel: p, lngLat: tilt(p) })))!
    expect(g.kind).toBe("projective")
    expect(Math.max(...residuals(g, pts.map((p) => ({ pixel: p, lngLat: tilt(p) }))))).toBeLessThan(0.01)
    const q: Pt = [123, 456]
    expect(applyGeoref(g, q)[0]).toBeCloseTo(tilt(q)[0], 7)
  })

  it("refuses points in a line", () => {
    expect(fitGeoref([[0, 0], [1, 1], [2, 2]].map((p) => ({ pixel: p as Pt, lngLat: truth(p as Pt) })))).toBeNull()
    expect(fitGeoref([])).toBeNull()
  })
})

describe("ward editing and export", () => {
  const square: Ward = { id: "a", ring: [[0, 0], [10, 0], [10, 10], [0, 10]], number: "3", name: "", numberSource: "manual" }

  it("splits a ward between two corners", () => {
    const [a, b] = splitWard({ ...square, ring: [[0, 0], [10, 0], [20, 0], [20, 10], [10, 10], [0, 10]] }, 1, 4)
    expect(Math.abs(ringArea(a.ring)) + Math.abs(ringArea(b.ring))).toBe(200)
    expect(a.number).toBe("3")
    expect(b.number).toBe("")
    expect(() => splitWard(square, 0, 1)).toThrow()
  })

  it("merges touching wards and rejects separate ones", () => {
    const right: Ward = { ...square, id: "b", ring: [[10, 0], [20, 0], [20, 10], [10, 10]], number: "" }
    expect(Math.abs(ringArea(mergeWards(square, right).ring))).toBe(200)
    expect(() => mergeWards(square, { ...right, ring: right.ring.map(([x, y]) => [x + 50, y] as Pt) })).toThrow()
  })

  it("exports ward-schema GeoJSON with RFC 7946 winding", () => {
    const g = georefFromBoxes([0, 0, 10, 10], [86.3, 23.3, 86.4, 23.4])
    const { collection, problems } = exportWards([square, { ...square, id: "x", number: "" }], g, { ...META, year_delimited: "2022" })
    expect(problems).toEqual(["A ward has no number."])
    const [f] = collection.features
    expect(f.properties).toMatchObject({ ward_number: 3, ward_name: null, year_delimited: 2022, municipality_type: "municipal_council", country: "IN" })
    const ring = f.geometry.coordinates[0] as Pt[]
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(ringArea(ring.slice(0, -1))).toBeGreaterThan(0) // counter-clockwise in lng/lat
    expect(ring).toContainEqual([86.3, 23.4])
  })

  it("picks the ward number out of what the text reader saw", () => {
    const w = (text: string, confidence: number) => ({ text, confidence })
    expect(pickNumber([w("Ward", 95), w("07", 60), w("12a,", 80), w("9", 10)])).toBe("12A")
    expect(pickNumber([w("~", 90)])).toBeNull()
  })

  it("cuts out one ward's writing without its boundary lines", () => {
    const img = blank(300, 200)
    drawRing(img, [[20, 20], [280, 20], [280, 180], [20, 180]], 4)
    drawLine(img, [150, 20], [150, 180], 4)
    fillRect(img, 70, 90, 78, 106, [0, 0, 0]) // a "1" in the left ward
    const result = detectRegions(img)
    const left = result.regions.find((r) => r.centroid[0] < 150)!
    const crop = wardCrop(img, result, left.label, 4, 10)!
    expect([crop.width, crop.height]).toEqual([28, 36])
    const right = result.regions.find((r) => r.centroid[0] > 150)!
    expect(wardCrop(img, result, right.label)).toBeNull() // no writing, only lines
  })
})

describe("ward schema", () => {
  it("parses ward numbers", () => {
    expect(parseWardNumber("7")).toBe(7)
    expect(parseWardNumber(" Ward No. 12 ")).toBe(12)
    expect(parseWardNumber("12a")).toBe("12A")
    expect(parseWardNumber("abc")).toBeNull()
    expect(parseWardNumber(3.5)).toBeNull()
  })

  it("flags missing metadata and duplicate numbers", () => {
    expect(metaIssues(EMPTY_META).length).toBeGreaterThanOrEqual(5)
    expect(metaIssues(META)).toEqual([])
    expect(wardNumberIssues([1, 2, 2, null])).toHaveLength(2)
  })

  it("maps vector file columns onto the schema", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { WARD_NO: "4", WARD_NAME: "Station Para" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
        { type: "Feature", properties: { WARD_NO: "?" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
        { type: "Feature", properties: { WARD_NO: "5" }, geometry: { type: "Point", coordinates: [0, 0] } },
      ],
    }
    const mapping = guessColumns(["OBJECTID", "WARD_NO", "WARD_NAME"])
    expect(mapping).toEqual({ wardNumber: "WARD_NO", wardName: "WARD_NAME" })
    const { collection, skipped } = mapToWardSchema(fc, mapping, META)
    expect(collection.features).toHaveLength(1)
    expect(collection.features[0].properties).toMatchObject({ ward_number: 4, ward_name: "Station Para", district: "Purulia" })
    expect(skipped).toHaveLength(2)
  })
})

describe("shared-boundary edits", () => {
  const left: Ward = { id: "l", ring: [[0, 0], [10, 0], [10, 10], [0, 10]], number: "1", name: "", numberSource: "manual" }
  const right: Ward = { id: "r", ring: [[10, 0], [20, 0], [20, 10], [10, 10]], number: "2", name: "", numberSource: "manual" }

  it("adds and removes corners on both sides of a shared edge", async () => {
    const { insertOnSharedEdge, removeSharedVertex, sharedVertices, moveVertices } = await import("../lib/trace/wards")
    let wards = insertOnSharedEdge([left, right], [10, 0], [10, 10], [10, 5])
    expect(wards.map((w) => w.ring.length)).toEqual([5, 5])
    wards = moveVertices(wards, sharedVertices(wards, [10, 5]), [13, 5])
    expect(mergeWards(wards[0], wards[1]).ring).toHaveLength(4)
    expect(Math.abs(ringArea(wards[0].ring)) + Math.abs(ringArea(wards[1].ring))).toBe(200)
    wards = removeSharedVertex(wards, [13, 5])
    expect(wards.map((w) => w.ring.length)).toEqual([4, 4])
  })
})
