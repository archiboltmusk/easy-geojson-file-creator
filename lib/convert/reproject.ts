import proj4 from "proj4";
import type { FeatureCollection, Geometry, Position } from "geojson";

const WGS84 = "EPSG:4326";

/** True when the .prj already describes plain WGS84 lon/lat, so no transform is needed. */
export function isWGS84(prjWkt: string): boolean {
	const wkt = prjWkt.replace(/\s+/g, "").toUpperCase();
	return wkt.startsWith("GEOGCS[") && /WGS_?(19)?84/.test(wkt);
}

function mapGeometry(g: Geometry, fn: (p: Position) => Position): Geometry {
	const walk = (c: unknown): unknown =>
		typeof (c as number[])[0] === "number" ? fn(c as Position) : (c as unknown[]).map(walk);
	if (g.type === "GeometryCollection") {
		return { ...g, geometries: g.geometries.map((x) => mapGeometry(x, fn)) };
	}
	return { ...g, coordinates: walk(g.coordinates) } as Geometry;
}

/**
 * Reproject a FeatureCollection from the CRS described by an ESRI/OGC .prj WKT
 * string to EPSG:4326. Returns the input unchanged when it is already WGS84.
 */
export function reprojectGeoJSON(fc: FeatureCollection, prjWkt: string): FeatureCollection {
	if (!prjWkt.trim() || isWGS84(prjWkt)) return fc;
	let forward: (xy: number[]) => number[];
	try {
		const converter = proj4(prjWkt.trim(), WGS84);
		forward = (xy) => converter.forward(xy);
	} catch (e) {
		throw new Error(`Unsupported projection in .prj: ${(e as Error).message}`);
	}
	const fn = (p: Position): Position => {
		const [x, y] = forward([p[0], p[1]]);
		return p.length > 2 ? [x, y, ...p.slice(2)] : [x, y];
	};
	return {
		...fc,
		features: fc.features.map((f) => (f.geometry ? { ...f, geometry: mapGeometry(f.geometry, fn) } : f)),
	};
}
