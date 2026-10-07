// Georeferencing: turn picture (pixel) coordinates into longitude/latitude from matched control points.
// 3 points fit an affine transform (scale, rotation, shear). 4+ points fit a projective transform,
// which also undoes the tilt of a photo taken at an angle.

import type { Pt } from "./segment"

export type ControlPoint = { id: string; pixel: Pt; lngLat: Pt }

export type Georef = {
  kind: "affine" | "projective"
  /** 3x3 matrix, row-major, mapping [x, y, 1] to homogeneous [lng, lat, w]. */
  matrix: number[]
}

export function applyGeoref(g: Georef, [x, y]: Pt): Pt {
  const m = g.matrix
  const w = m[6] * x + m[7] * y + m[8]
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]
}

/** Solves A x = b (square) by Gaussian elimination with partial pivoting. Returns null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

/** Least squares via normal equations. */
function leastSquares(rows: number[][], rhs: number[]): number[] | null {
  const n = rows[0].length
  const AtA = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const Atb = new Array<number>(n).fill(0)
  rows.forEach((row, r) => {
    for (let i = 0; i < n; i++) {
      Atb[i] += row[i] * rhs[r]
      for (let j = 0; j < n; j++) AtA[i][j] += row[i] * row[j]
    }
  })
  return solve(AtA, Atb)
}

/** Similarity normalisation (Hartley): centre on the mean, scale so the mean distance is sqrt(2). */
function normaliser(points: Pt[]) {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length
  const d = points.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cy), 0) / points.length || 1
  const s = Math.SQRT2 / d
  return { forward: [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1], inverse: [1 / s, 0, cx, 0, 1 / s, cy, 0, 0, 1] }
}

function mul(a: number[], b: number[]) {
  const out = new Array<number>(9).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return out
}

function isCollinear(points: Pt[]) {
  const [a, b] = points
  let spread = 0
  for (const p of points) spread = Math.max(spread, Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])))
  const scale = Math.max(...points.map((p) => Math.hypot(p[0] - a[0], p[1] - a[1])))
  return !scale || spread < 1e-6 * scale * scale
}

export function fitGeoref(points: Pick<ControlPoint, "pixel" | "lngLat">[]): Georef | null {
  if (points.length < 3) return null
  const src = points.map((p) => p.pixel)
  const dst = points.map((p) => p.lngLat)
  if (isCollinear(src) || isCollinear(dst)) return null
  const ns = normaliser(src)
  const nd = normaliser(dst)
  const tx = (m: number[], [x, y]: Pt): Pt => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]]
  const s = src.map((p) => tx(ns.forward, p))
  const d = dst.map((p) => tx(nd.forward, p))

  let core: number[] | null
  let kind: Georef["kind"]
  if (points.length < 4) {
    kind = "affine"
    const rows = s.map(([x, y]) => [x, y, 1])
    const a = leastSquares(rows, d.map((p) => p[0]))
    const b = leastSquares(rows, d.map((p) => p[1]))
    core = a && b ? [...a, ...b, 0, 0, 1] : null
  } else {
    kind = "projective"
    const rows: number[][] = []
    const rhs: number[] = []
    s.forEach(([x, y], i) => {
      const [u, v] = d[i]
      rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
      rhs.push(u)
      rows.push([0, 0, 0, x, y, 1, -v * x, -v * y])
      rhs.push(v)
    })
    const h = leastSquares(rows, rhs)
    core = h ? [...h, 1] : null
  }
  if (!core || core.some((v) => !Number.isFinite(v))) return null
  const matrix = mul(nd.inverse, mul(core, ns.forward))
  return { kind, matrix: matrix.map((v) => v / matrix[8]) }
}

/** Maps a pixel box onto a lng/lat box (north up). Used for "the wards fill this known area" presets. */
export function georefFromBoxes(pixel: [number, number, number, number], lngLat: [number, number, number, number]): Georef {
  const [x0, y0, x1, y1] = pixel
  const [w, s, e, n] = lngLat
  return fitGeoref([
    { pixel: [x0, y0], lngLat: [w, n] },
    { pixel: [x1, y0], lngLat: [e, n] },
    { pixel: [x0, y1], lngLat: [w, s] },
  ])!
}

/** Approximate ground distance in metres between two lng/lat points (equirectangular, fine at city scale). */
export function metres([lng1, lat1]: Pt, [lng2, lat2]: Pt) {
  const k = Math.PI / 180
  const x = (lng2 - lng1) * k * Math.cos(((lat1 + lat2) / 2) * k)
  const y = (lat2 - lat1) * k
  return Math.hypot(x, y) * 6_371_000
}

/** How far each control point lands from where it was pinned, in metres. Only meaningful with more points than the minimum. */
export function residuals(g: Georef, points: Pick<ControlPoint, "pixel" | "lngLat">[]) {
  return points.map((p) => metres(applyGeoref(g, p.pixel), p.lngLat))
}
