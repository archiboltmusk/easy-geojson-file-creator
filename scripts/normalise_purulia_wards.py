"""Normalise Purulia ward boundaries to the ward schema.

    python3 scripts/normalise_purulia_wards.py path/to/purulia_wards.geojson

Source: archiboltmusk/Purulia purulia_wards.geojson (each feature has a `ward` number).
Writes data/west-bengal/purulia/wards.geojson (schema/ward.schema.json). Stdlib only.
"""
import json
import math
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data/west-bengal/purulia/wards.geojson"
MIN_PART_M2 = 100  # drop tracing slivers smaller than this
SOURCE_URL = "https://github.com/archiboltmusk/Purulia/blob/7f6ef3cdc195b5ebd6fd6ecac9ad10fabd819af8/purulia_wards.geojson"


def ring_area_m2(ring):
    # Shoelace on an equirectangular projection; fine at ward scale.
    lat0 = math.radians(sum(p[1] for p in ring) / len(ring))
    k = 6371008.8 * math.pi / 180
    pts = [(x * k * math.cos(lat0), y * k) for x, y in ring]
    return sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1])) / 2


def orient(ring, ccw):
    # RFC 7946: exterior rings counter-clockwise, holes clockwise.
    return ring if (ring_area_m2(ring) > 0) == ccw else ring[::-1]


def normalise(geom):
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    kept = [
        [orient(p[0], True)] + [orient(h, False) for h in p[1:]]
        for p in polys
        if abs(ring_area_m2(p[0])) >= MIN_PART_M2
    ]
    if len(kept) == 1:
        return {"type": "Polygon", "coordinates": kept[0]}
    return {"type": "MultiPolygon", "coordinates": kept}


def main(src):
    features = []
    for f in json.loads(Path(src).read_text())["features"]:
        n = int(f["properties"]["ward"])
        features.append({
            "type": "Feature",
            "id": f"IN-WB-PURULIA-W{n:02d}",
            "properties": {
                "state": "West Bengal",
                "district": "Purulia",
                "municipality_name": "Purulia Municipality",
                "municipality_type": "municipal_council",
                "ward_number": n,
                "ward_name": None,  # wards are numbered, not named
                "year_delimited": None,  # unknown
                "source_url": SOURCE_URL,
                "license": "MIT",
                "country": "IN",
            },
            "geometry": normalise(f["geometry"]),
        })
    features.sort(key=lambda f: f["properties"]["ward_number"])
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")) + "\n")
    print(f"{len(features)} wards -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1])
