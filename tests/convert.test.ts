import shpwrite from "@mapbox/shp-write"
import type { FeatureCollection, Polygon } from "geojson"
import JSZip from "jszip"
import proj4 from "proj4"
import { describe, expect, it } from "vitest"
import { convertFile, detectFormat, outputName } from "../lib/convert"
import "../lib/crs"

// Rough square around Purulia, West Bengal (UTM zone 45N).
const ring = [[86.36, 23.33], [86.37, 23.33], [86.37, 23.34], [86.36, 23.34], [86.36, 23.33]]
const ward: FeatureCollection = { type: "FeatureCollection", features: [{ type: "Feature", properties: { WARD_NO: 1 }, geometry: { type: "Polygon", coordinates: [ring] } }] }
const toUtm = proj4("EPSG:4326", "EPSG:32645")
const utmWard: FeatureCollection = { ...ward, features: [{ ...ward.features[0], geometry: { type: "Polygon", coordinates: [ring.map((p) => toUtm.forward(p))] } }] }
const UTM45_WKT = 'PROJCS["WGS_1984_UTM_Zone_45N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",87.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

async function shapefileZip(fc: FeatureCollection, prj?: string | null): Promise<ArrayBuffer> {
  const written = await shpwrite.zip(fc, { outputType: "arraybuffer", compression: "STORE" } as never)
  const zip = await JSZip.loadAsync(written as ArrayBuffer)
  for (const name of Object.keys(zip.files)) {
    if (name.toLowerCase().endsWith(".prj")) {
      if (prj === null) zip.remove(name)
      else if (prj) zip.file(name, prj)
    }
  }
  return zip.generateAsync({ type: "arraybuffer" })
}

function expectNearPurulia(fc: FeatureCollection) {
  const coords = (fc.features[0].geometry as Polygon).coordinates[0]
  coords.forEach((p, i) => {
    expect(p[0]).toBeCloseTo(ring[i][0], 5)
    expect(p[1]).toBeCloseTo(ring[i][1], 5)
  })
}

describe("detectFormat / outputName", () => {
  it("maps extensions", () => {
    expect(detectFormat("wards.ZIP")).toBe("shapefile")
    expect(detectFormat("a.kmz")).toBe("kmz")
    expect(detectFormat("a.json")).toBe("geojson")
    expect(detectFormat("a.pdf")).toBeNull()
    expect(outputName("purulia wards.kml")).toBe("purulia wards.geojson")
  })
})

describe("convertFile", () => {
  it("reads a WGS 84 shapefile zip with attributes", async () => {
    const r = await convertFile("wards.zip", await shapefileZip(ward))
    expect(r.format).toBe("shapefile")
    expect(r.needsCrs).toBe(false)
    expect(r.collection.features[0].properties).toMatchObject({ WARD_NO: 1 })
    expectNearPurulia(r.collection)
  })

  it("reprojects a UTM shapefile using its .prj", async () => {
    const r = await convertFile("wards.zip", await shapefileZip(utmWard, UTM45_WKT))
    expect(r.needsCrs).toBe(false)
    expectNearPurulia(r.collection)
  })

  it("asks for a CRS when the .prj is missing, then applies the chosen one", async () => {
    const zip = await shapefileZip(utmWard, null)
    const first = await convertFile("wards.zip", zip)
    expect(first.needsCrs).toBe(true)
    const second = await convertFile("wards.zip", zip, { crs: "EPSG:32645" })
    expect(second.needsCrs).toBe(false)
    expect(second.sourceCrs).toBe("EPSG:32645")
    expectNearPurulia(second.collection)
  })

  it("parses KML and KMZ", async () => {
    const doc = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Ward 1</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring.map((p) => p.join(",")).join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`
    const k = await convertFile("wards.kml", enc(doc))
    expect(k.collection.features[0].properties).toMatchObject({ name: "Ward 1" })
    expectNearPurulia(k.collection)

    const zip = new JSZip()
    zip.file("doc.kml", doc)
    const kmz = await convertFile("wards.kmz", await zip.generateAsync({ type: "arraybuffer" }))
    expect(kmz.format).toBe("kmz")
    expectNearPurulia(kmz.collection)
  })

  it("honours a legacy GeoJSON crs member and wraps bare geometries", async () => {
    const legacy = { ...utmWard, crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::32645" } } }
    const r = await convertFile("wards.geojson", enc(JSON.stringify(legacy)))
    expect(r.sourceCrs).toBe("EPSG:32645")
    expect("crs" in r.collection).toBe(false)
    expectNearPurulia(r.collection)

    const bare = await convertFile("a.json", enc(JSON.stringify(ward.features[0].geometry)))
    expect(bare.collection.features).toHaveLength(1)
  })

  it("puts Kalianpur zone IIb coordinates back near the source point", async () => {
    const toKal = proj4("EPSG:4326", "EPSG:24380")
    const fc: FeatureCollection = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: toKal.forward([86.36, 23.33]) } }] }
    const r = await convertFile("p.geojson", enc(JSON.stringify(fc)), { crs: "EPSG:24380" })
    const [lon, lat] = (r.collection.features[0].geometry as { coordinates: number[] }).coordinates
    expect(lon).toBeCloseTo(86.36, 5)
    expect(lat).toBeCloseTo(23.33, 5)
  })

  it("rejects bad input with readable errors", async () => {
    await expect(convertFile("a.pdf", enc(""))).rejects.toThrow(/Unsupported/)
    await expect(convertFile("a.geojson", enc("{"))).rejects.toThrow(/not valid JSON/)
    await expect(convertFile("a.geojson", enc('{"type":"FeatureCollection","features":[]}'))).rejects.toThrow(/No features/)
    await expect(convertFile("a.geojson", enc(JSON.stringify(ward)), { crs: "EPSG:999999" })).rejects.toThrow(/Unknown coordinate system/)
  })
})
