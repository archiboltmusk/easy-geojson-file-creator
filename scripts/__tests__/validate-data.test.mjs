import { test } from "node:test";
import assert from "node:assert/strict";
import { validateCollection, checkLayout, signedArea } from "../validate-data.mjs";

const props = (over = {}) => ({
  state: "Karnataka",
  district: "Bengaluru Urban",
  municipality_name: "Example City Corporation",
  municipality_type: "municipal_corporation",
  ward_number: 1,
  ward_name: "Example Ward",
  year_delimited: 2023,
  source_url: "https://example.org/delimitation",
  license: "CC-BY-4.0",
  ...over,
});

// Counterclockwise unit square near Bengaluru.
const square = () => [[[77.5, 12.9], [77.6, 12.9], [77.6, 13.0], [77.5, 13.0], [77.5, 12.9]]];
const fc = (...features) => ({ type: "FeatureCollection", features });
const ward = (coordinates = square(), p = {}) => ({
  type: "Feature",
  properties: props(p),
  geometry: { type: "Polygon", coordinates },
});
const layout = { state: "karnataka", city: "example-city" };

test("valid collection passes", () => {
  assert.deepEqual(validateCollection(fc(ward()), { layout }).errors, []);
});

test("missing and malformed properties are schema errors", () => {
  const f = ward();
  delete f.properties.license;
  f.properties.municipality_type = "city";
  f.properties.source_url = "not a url";
  const { errors } = validateCollection(fc(f));
  assert.ok(errors.some((e) => e.includes("license")));
  assert.ok(errors.some((e) => e.includes("municipality_type")));
  assert.ok(errors.some((e) => e.includes("source_url")));
});

test("open ring is reported, and --fix closes it", () => {
  const coords = square();
  coords[0].pop();
  const data = fc(ward(coords));
  assert.ok(validateCollection(data).errors.some((e) => e.includes("not closed")));
  const fixed = validateCollection(data, { fix: true });
  assert.deepEqual(fixed.errors, []);
  assert.equal(fixed.changed, true);
});

test("clockwise exterior is reported, and --fix rewinds it", () => {
  const coords = square();
  coords[0].reverse();
  const data = fc(ward(coords));
  assert.ok(validateCollection(data).errors.some((e) => e.includes("winding")));
  validateCollection(data, { fix: true });
  assert.ok(signedArea(data.features[0].geometry.coordinates[0]) > 0);
});

test("out-of-bounds or swapped/projected coordinates fail", () => {
  const projected = [[[8627000, 1450000], [8628000, 1450000], [8628000, 1451000], [8627000, 1450000]]];
  assert.ok(validateCollection(fc(ward(projected))).errors.some((e) => e.includes("out of bounds")));
});

test("duplicate ward numbers and mixed municipalities fail", () => {
  const { errors } = validateCollection(fc(ward(), ward(square(), { municipality_name: "Other" })));
  assert.ok(errors.some((e) => e.includes("duplicate ward_number")));
  assert.ok(errors.some((e) => e.includes("one municipality_name")));
});

test("state folder must match the state property", () => {
  const { errors } = validateCollection(fc(ward()), { layout: { state: "kerala", city: "x" } });
  assert.ok(errors.some((e) => e.includes("expected data/karnataka/")));
});

test("layout rules", () => {
  assert.deepEqual(checkLayout("data/karnataka/bengaluru/wards.geojson").errors, []);
  assert.ok(checkLayout("data/Karnataka/Bengaluru/wards.geojson").errors.length === 2);
  assert.ok(checkLayout("data/karnataka/wards.geojson").errors.length === 1);
});
