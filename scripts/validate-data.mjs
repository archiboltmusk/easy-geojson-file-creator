#!/usr/bin/env node
// Validates ward GeoJSON under data/<state>/<city>/wards.geojson against
// schema/ward.schema.json plus geometry rules JSON Schema can't express.
//
//   node scripts/validate-data.mjs [paths...]        check (default: data/)
//   node scripts/validate-data.mjs --fix [paths...]  also rewind and close rings in place

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = JSON.parse(readFileSync(join(ROOT, "schema", "ward.schema.json"), "utf8"));
const DATA_FILENAME = "wards.geojson";
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(SCHEMA);

export const slugify = (s) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

// Shoelace formula on lon/lat; positive means counterclockwise.
export function signedArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

const samePosition = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function polygonsOf(geometry) {
  if (geometry?.type === "Polygon") return [geometry.coordinates];
  if (geometry?.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

// Checks one polygon's rings. With fix=true, closes open rings and rewinds
// them to RFC 7946 order (exterior counterclockwise, holes clockwise).
function checkPolygon(rings, where, errors, fix) {
  let changed = false;
  rings.forEach((ring, r) => {
    const label = `${where} ring ${r} (${r === 0 ? "exterior" : "hole"})`;
    if (!Array.isArray(ring) || ring.length === 0) return;

    for (const [i, pos] of ring.entries()) {
      if (!Array.isArray(pos) || !pos.every(Number.isFinite)) {
        errors.push(`${label}: position ${i} is not a finite number pair`);
        return;
      }
      const [lon, lat] = pos;
      if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
        errors.push(
          `${label}: position ${i} [${lon}, ${lat}] is out of bounds (lon -180..180, lat -90..90); ` +
            `coordinates must be WGS84 [longitude, latitude], not projected or swapped`,
        );
        return;
      }
    }

    if (!samePosition(ring[0], ring[ring.length - 1])) {
      if (fix) {
        ring.push([...ring[0]]);
        changed = true;
      } else {
        errors.push(`${label}: ring is not closed (first and last positions differ)`);
        return;
      }
    }
    if (ring.length < 4) {
      errors.push(`${label}: ring has ${ring.length} positions, needs at least 4`);
      return;
    }

    const area = signedArea(ring);
    if (area === 0) {
      errors.push(`${label}: ring has zero area`);
      return;
    }
    const wantCCW = r === 0;
    if (area > 0 !== wantCCW) {
      if (fix) {
        ring.reverse();
        changed = true;
      } else {
        errors.push(
          `${label}: wrong winding order, ${wantCCW ? "exterior rings must be counterclockwise" : "holes must be clockwise"} (RFC 7946)`,
        );
      }
    }
  });
  return changed;
}

// Validates a parsed FeatureCollection. `layout` is {state, city} folder slugs
// when the file lives under data/, else null. Returns {errors, changed}.
export function validateCollection(fc, { layout = null, fix = false } = {}) {
  const errors = [];
  let changed = false;

  if (!validateSchema(fc)) {
    for (const e of validateSchema.errors) {
      // oneOf on geometry repeats every branch's failure; report the summary only.
      if (e.keyword === "const" && /\/geometry\/type$/.test(e.instancePath)) continue;
      errors.push(`schema: ${e.instancePath || "(root)"} ${e.message}${e.params?.allowedValues ? ` (${e.params.allowedValues.join(", ")})` : ""}`);
    }
  }

  const features = Array.isArray(fc?.features) ? fc.features : [];
  const seenWards = new Map();
  const states = new Set();
  const municipalities = new Set();

  features.forEach((f, i) => {
    const p = f?.properties ?? {};
    const where = `feature ${i}${p.ward_number !== undefined ? ` (ward ${p.ward_number})` : ""}`;

    polygonsOf(f?.geometry).forEach((rings, k) => {
      const at = f.geometry.type === "MultiPolygon" ? `${where} polygon ${k}` : where;
      if (Array.isArray(rings) && checkPolygon(rings, at, errors, fix)) changed = true;
    });

    if (p.ward_number !== undefined) {
      const key = String(p.ward_number).toUpperCase();
      if (seenWards.has(key)) errors.push(`${where}: duplicate ward_number, also used by feature ${seenWards.get(key)}`);
      else seenWards.set(key, i);
    }
    if (typeof p.state === "string") states.add(p.state);
    if (typeof p.municipality_name === "string") municipalities.add(p.municipality_name);
  });

  if (states.size > 1) errors.push(`all features must share one state, found: ${[...states].join(", ")}`);
  if (municipalities.size > 1)
    errors.push(`all features must share one municipality_name, found: ${[...municipalities].join(", ")}`);

  if (layout && states.size === 1) {
    const [state] = states;
    if (slugify(state) !== layout.state)
      errors.push(`folder data/${layout.state}/ does not match state "${state}"; expected data/${slugify(state)}/`);
  }

  return { errors, changed };
}

// data/<state>/<city>/wards.geojson, both folders lowercase-kebab slugs.
export function checkLayout(relPath) {
  const parts = relPath.split(sep);
  if (parts[0] !== "data") return { layout: null, errors: [] };
  if (parts.length !== 4 || parts[3] !== DATA_FILENAME)
    return { layout: null, errors: [`must be at data/<state>/<city>/${DATA_FILENAME}`] };
  const [, state, city] = parts;
  const errors = [state, city]
    .filter((s) => !SLUG.test(s))
    .map((s) => `folder "${s}" must be a lowercase-kebab slug, e.g. "${slugify(s)}"`);
  return { layout: { state, city }, errors };
}

function collectFiles(target, out) {
  if (!existsSync(target)) throw new Error(`no such path: ${target}`);
  if (statSync(target).isDirectory()) {
    for (const name of readdirSync(target).sort()) {
      if (name.startsWith(".")) continue;
      collectFiles(join(target, name), out);
    }
  } else if (/\.geojson$/i.test(target)) {
    out.push(target);
  }
  return out;
}

function main(argv) {
  const fix = argv.includes("--fix");
  const targets = argv.filter((a) => a !== "--fix");
  if (targets.length === 0) targets.push(join(ROOT, "data"));

  const files = targets.flatMap((t) => collectFiles(resolve(t), []));
  const annotate = process.env.GITHUB_ACTIONS === "true";
  let failed = 0;

  for (const file of files) {
    const rel = relative(ROOT, file);
    const { layout, errors } = checkLayout(rel);
    let fc;
    try {
      fc = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      errors.push(`invalid JSON: ${e.message}`);
    }
    if (fc !== undefined) {
      const result = validateCollection(fc, { layout, fix });
      errors.push(...result.errors);
      if (result.changed) {
        writeFileSync(file, JSON.stringify(fc) + "\n");
        console.log(`fixed ${rel}: closed and/or rewound rings`);
      }
    }

    if (errors.length) {
      failed++;
      console.log(`✗ ${rel}`);
      for (const e of errors) {
        console.log(`    ${e}`);
        if (annotate) console.log(`::error file=${rel}::${e}`);
      }
    } else {
      console.log(`✓ ${rel}`);
    }
  }

  console.log(`\n${files.length} file(s) checked, ${failed} with errors.`);
  if (failed && !fix) console.log("Tip: `pnpm data:fix` closes open rings and fixes winding order automatically.");
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
