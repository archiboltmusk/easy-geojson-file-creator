// Browser-only: reads the ward number inside each detected ward with Tesseract. Its files are served
// from /tesseract (see scripts/copy-maplibre-worker.mjs), about 7 MB on first use, then cached.
//
// Reading the whole map at once fails: the boundary lines drown out the digits. So each ward is cut
// out on its own, lines stripped, and read as a small block of text.

import { pickNumber, wardCrop } from "./numbers"
import type { DetectResult, RasterImage } from "./segment"

export async function readWardNumbers(img: RasterImage, result: DetectResult, onProgress?: (share: number) => void): Promise<Map<number, string>> {
  const { createWorker, PSM } = await import("tesseract.js")
  const worker = await createWorker("eng", 1, { workerPath: "/tesseract/worker.min.js", corePath: "/tesseract", langPath: "/tesseract" })
  const numbers = new Map<number, string>()
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, tessedit_char_whitelist: "0123456789ABCDEFabcdef" })
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")!
    const scratch = document.createElement("canvas")
    for (const [i, region] of result.regions.entries()) {
      onProgress?.(i / result.regions.length)
      const crop = wardCrop(img, result, region.label)
      if (!crop || crop.width * crop.height > 1_500_000) continue
      scratch.width = crop.width
      scratch.height = crop.height
      scratch.getContext("2d")!.putImageData(new ImageData(crop.data as Uint8ClampedArray<ArrayBuffer>, crop.width, crop.height), 0, 0)
      // Small digits read better enlarged.
      canvas.width = crop.width * 2
      canvas.height = crop.height * 2
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height)
      const { data } = await worker.recognize(canvas, {}, { blocks: true })
      const n = pickNumber((data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words))))
      if (n) numbers.set(region.label, n)
    }
    onProgress?.(1)
    return numbers
  } finally {
    await worker.terminate()
  }
}
