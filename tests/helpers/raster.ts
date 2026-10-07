import type { RasterImage, Pt } from "../../lib/trace/segment"

export function blank(width: number, height: number, rgb: [number, number, number] = [255, 255, 255]): RasterImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4)
  return { width, height, data }
}

export function drawLine(img: RasterImage, a: Pt, b: Pt, thickness = 3, rgb: [number, number, number] = [20, 20, 20]) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2))
  const r = thickness / 2
  for (let s = 0; s <= steps; s++) {
    const cx = a[0] + ((b[0] - a[0]) * s) / steps
    const cy = a[1] + ((b[1] - a[1]) * s) / steps
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r) continue
        img.data.set([...rgb, 255], (y * img.width + x) * 4)
      }
    }
  }
}

export function drawRing(img: RasterImage, ring: Pt[], thickness = 3) {
  for (let i = 0; i < ring.length; i++) drawLine(img, ring[i], ring[(i + 1) % ring.length], thickness)
}

export function fillRect(img: RasterImage, x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set([...rgb, 255], (y * img.width + x) * 4)
}
