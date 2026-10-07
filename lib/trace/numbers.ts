// Prepares each detected ward for the text reader and picks the ward number out of what it reads.

import type { DetectResult } from "./segment"

export type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

export type Crop = { width: number; height: number; data: Uint8ClampedArray }

/**
 * A black-on-white image of just the writing inside one ward (boundary lines stripped, cropped
 * tight around the ink), so the text reader sees the label and not the maze of lines around it.
 */
export function wardCrop(img: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, result: Pick<DetectResult, "labels" | "width" | "height" | "threshold">, label: number, inset = 4, pad = 16): Crop | null {
  const { width, labels } = result
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== label) continue
    const x = i % width
    const y = (i - x) / width
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  if (x1 < 0) return null
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  // Erode the ward mask by `inset` px (a pixel survives if its whole neighbourhood is this ward).
  let mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = labels[(y + y0) * width + x + x0] === label ? 1 : 0
  for (let k = 0; k < inset; k++) {
    const next = new Uint8Array(w * h)
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      next[i] = mask[i] & mask[i - 1] & mask[i + 1] & mask[i - w] & mask[i + w]
    }
    mask = next
  }
  // Ink inside the ward.
  const ink = new Uint8Array(w * h)
  let ix0 = Infinity, iy0 = Infinity, ix1 = -1, iy1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue
    const s = ((y + y0) * img.width + x + x0) * 4
    const lum = 0.299 * img.data[s] + 0.587 * img.data[s + 1] + 0.114 * img.data[s + 2]
    if (lum > result.threshold) continue
    ink[y * w + x] = 1
    if (x < ix0) ix0 = x
    if (x > ix1) ix1 = x
    if (y < iy0) iy0 = y
    if (y > iy1) iy1 = y
  }
  if (ix1 < 0) return null
  const W = ix1 - ix0 + 1 + 2 * pad
  const H = iy1 - iy0 + 1 + 2 * pad
  const data = new Uint8ClampedArray(W * H * 4).fill(255)
  for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
    if (!ink[y * w + x]) continue
    const d = ((y - iy0 + pad) * W + x - ix0 + pad) * 4
    data[d] = data[d + 1] = data[d + 2] = 0
  }
  return { width: W, height: H, data }
}

/** The most confident thing that looks like a ward number, or null. */
export function pickNumber(words: Pick<OcrWord, "text" | "confidence">[], minConfidence = 40): string | null {
  let best: { text: string; confidence: number } | null = null
  for (const w of words) {
    const text = w.text.replace(/[^0-9A-Za-z]/g, "")
    if (!/^\d{1,3}[A-Za-z]?$/.test(text) || w.confidence < minConfidence) continue
    if (!best || w.confidence > best.confidence) best = { text: text.replace(/^0+(?=\d)/, "").toUpperCase(), confidence: w.confidence }
  }
  return best?.text ?? null
}
