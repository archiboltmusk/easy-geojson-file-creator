import { kml } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import { unzipSync, strFromU8 } from "fflate";
import type { FeatureCollection } from "geojson";

/** Parse KML text into a GeoJSON FeatureCollection (KML is always WGS84). */
export function kmlToGeoJSON(text: string): FeatureCollection {
	const doc = new DOMParser().parseFromString(text, "text/xml");
	if (!doc.getElementsByTagName("kml").length) {
		throw new Error("Not a KML file: missing <kml> root element");
	}
	// xmldom's Document is structurally compatible with what togeojson reads.
	const fc = kml(doc as unknown as Document) as FeatureCollection;
	return { type: "FeatureCollection", features: fc.features.filter((f) => f.geometry) };
}

/** Unzip a KMZ and parse its main KML (doc.kml, else the first .kml found). */
export function kmzToGeoJSON(data: ArrayBuffer | Uint8Array): FeatureCollection {
	const files = unzipSync(data instanceof Uint8Array ? data : new Uint8Array(data));
	const names = Object.keys(files).filter((n) => n.toLowerCase().endsWith(".kml"));
	const main = names.find((n) => n.toLowerCase().split("/").pop() === "doc.kml") ?? names[0];
	if (!main) throw new Error("KMZ archive contains no .kml file");
	return kmlToGeoJSON(strFromU8(files[main]));
}
