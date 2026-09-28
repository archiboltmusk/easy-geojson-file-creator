// MapLibre 6 loads its web worker as a separate ES module next to the library file.
// Bundlers don't emit it, so serve the prebuilt worker (and the chunk it imports) from /public.
import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const dist = join(dirname(createRequire(import.meta.url).resolve("maplibre-gl/package.json")), "dist")
const out = join(import.meta.dirname, "..", "public", "maplibre")
mkdirSync(out, { recursive: true })
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(join(dist, file), join(out, file))
