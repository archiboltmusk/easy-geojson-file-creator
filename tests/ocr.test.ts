import { readFileSync } from "node:fs"
import { PNG } from "pngjs"
import { createWorker, PSM } from "tesseract.js"
import { expect, it } from "vitest"
import { pickNumber, wardCrop } from "../lib/trace/numbers"
import { detectRegions } from "../lib/trace/segment"

// End to end on the sample drawing: find the wards, then read the number written in each one.
it("reads every ward number on the Purulia sample drawing", async () => {
  const png = PNG.sync.read(readFileSync("public/samples/purulia-wards-drawing.png"))
  const img = { width: png.width, height: png.height, data: png.data }
  const result = detectRegions(img)
  expect(result.regions).toHaveLength(22)

  const worker = await createWorker("eng", 1, { langPath: `${process.cwd()}/node_modules/@tesseract.js-data/eng/4.0.0_best_int`, gzip: true, cacheMethod: "none", logger: () => {}, errorHandler: () => {} })
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: "0123456789ABCDEFabcdef" })
  const read: string[] = []
  try {
    for (const r of result.regions) {
      const crop = wardCrop(img, result, r.label)
      if (!crop) continue
      const out = new PNG({ width: crop.width, height: crop.height })
      out.data = Buffer.from(crop.data)
      const { data } = await worker.recognize(PNG.sync.write(out), {}, { blocks: true })
      const n = pickNumber((data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))))
      if (n) read.push(n)
    }
  } finally {
    await worker.terminate()
  }
  expect(read.map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 22 }, (_, i) => i + 1))
}, 120_000)
