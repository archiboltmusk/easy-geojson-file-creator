// MapLibre 6 loads its web worker as a separate ES module next to the library file; pdf.js and
// Tesseract (ward-number reading) need their workers, WebAssembly and English model too.
// Bundlers don't emit them, so serve the prebuilt files from /public (self-hosted, no CDN).
import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const copies = [
  ["maplibre-gl", "dist", "maplibre", ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]],
  ["pdfjs-dist", "build", "pdfjs", ["pdf.worker.min.mjs"]],
  ["tesseract.js", "dist", "tesseract", ["worker.min.js"]],
  ["tesseract.js-core", ".", "tesseract", ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]],
  ["@tesseract.js-data/eng", "4.0.0_best_int", "tesseract", ["eng.traineddata.gz"]],
]
for (const [pkg, dir, target, files] of copies) {
  const from = join(dirname(require.resolve(`${pkg}/package.json`)), dir)
  const out = join(import.meta.dirname, "..", "public", target)
  mkdirSync(out, { recursive: true })
  for (const file of files) copyFileSync(join(from, file), join(out, file))
}
