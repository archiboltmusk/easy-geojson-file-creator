import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { kmlToGeoJSON, kmzToGeoJSON, reprojectGeoJSON, isWGS84 } from "./index";
import type { FeatureCollection, Point, Polygon } from "geojson";

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>Ward 1</name><Polygon><outerBoundaryIs><LinearRing>
    <coordinates>86.3,23.3 86.4,23.3 86.4,23.4 86.3,23.3</coordinates>
  </LinearRing></outerBoundaryIs></Polygon></Placemark>
  <Placemark><name>Office</name><Point><coordinates>86.36,23.33,0</coordinates></Point></Placemark>
</Document></kml>`;

// UTM zone 45N (covers Purulia), as QGIS/ArcGIS write it.
const UTM45N_PRJ = `PROJCS["WGS_1984_UTM_Zone_45N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",87.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;
const WGS84_PRJ = `GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]`;

describe("kmlToGeoJSON", () => {
	it("parses placemarks with names and geometry", () => {
		const fc = kmlToGeoJSON(KML);
		expect(fc.features).toHaveLength(2);
		expect(fc.features[0].properties?.name).toBe("Ward 1");
		expect(fc.features[0].geometry.type).toBe("Polygon");
		expect((fc.features[1].geometry as Point).coordinates).toEqual([86.36, 23.33, 0]);
	});

	it("rejects non-KML input", () => {
		expect(() => kmlToGeoJSON("<gpx></gpx>")).toThrow(/Not a KML/);
	});
});

describe("kmzToGeoJSON", () => {
	it("reads doc.kml from the archive", () => {
		const kmz = zipSync({ "doc.kml": strToU8(KML), "files/icon.png": new Uint8Array([1]) });
		expect(kmzToGeoJSON(kmz).features).toHaveLength(2);
	});

	it("falls back to any .kml when doc.kml is absent", () => {
		const kmz = zipSync({ "sub/wards.KML": strToU8(KML) });
		expect(kmzToGeoJSON(kmz.buffer as ArrayBuffer).features).toHaveLength(2);
	});

	it("errors on archives without KML", () => {
		expect(() => kmzToGeoJSON(zipSync({ "a.txt": strToU8("x") }))).toThrow(/no \.kml/);
	});
});

describe("reprojectGeoJSON", () => {
	const utm: FeatureCollection = {
		type: "FeatureCollection",
		features: [
			{ type: "Feature", properties: { id: 1 }, geometry: { type: "Point", coordinates: [500000, 2580000, 12] } },
			{
				type: "Feature",
				properties: {},
				geometry: { type: "Polygon", coordinates: [[[500000, 2580000], [510000, 2580000], [510000, 2590000], [500000, 2580000]]] },
			},
		],
	};

	it("converts UTM 45N metres to lon/lat, keeping Z and properties", () => {
		const out = reprojectGeoJSON(utm, UTM45N_PRJ);
		const [lon, lat, z] = (out.features[0].geometry as Point).coordinates;
		expect(lon).toBeCloseTo(87, 6); // on the central meridian
		expect(lat).toBeCloseTo(23.32, 1);
		expect(z).toBe(12);
		expect(out.features[0].properties).toEqual({ id: 1 });
		const ring = (out.features[1].geometry as Polygon).coordinates[0];
		expect(ring[1][0]).toBeGreaterThan(87);
		expect(ring[1][0]).toBeLessThan(87.2);
	});

	it("does not mutate the input", () => {
		reprojectGeoJSON(utm, UTM45N_PRJ);
		expect((utm.features[0].geometry as Point).coordinates[0]).toBe(500000);
	});

	it("passes WGS84 or empty .prj through untouched", () => {
		expect(isWGS84(WGS84_PRJ)).toBe(true);
		expect(isWGS84(UTM45N_PRJ)).toBe(false);
		expect(reprojectGeoJSON(utm, WGS84_PRJ)).toBe(utm);
		expect(reprojectGeoJSON(utm, "")).toBe(utm);
	});

	it("reports unsupported projections clearly", () => {
		expect(() => reprojectGeoJSON(utm, "garbage")).toThrow(/Unsupported projection/);
	});
});
