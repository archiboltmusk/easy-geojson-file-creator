// Turns a picture of a ward map into polygons, in pixel coordinates.
//
// The idea is deliberately simple so people can reason about its mistakes:
// 1. Pixels that are dark (boundary lines, text) or sit on a sharp colour change
//    (edges between coloured wards) become "ink".
// 2. Ink is thickened a little to close small gaps in the lines.
// 3. Every connected patch of non-ink is a candidate ward. Patches touching the
//    picture's edge are the outside, tiny patches are noise (e.g. inside a "0").
// 4. Wards then grow into the ink until they meet their neighbours, so adjacent
//    wards end up sharing one boundary instead of leaving a line-wide gap.
// 5. Each ward's outline is traced and simplified. Shared stretches of boundary
//    are simplified once and reused, so neighbours stay gap-free.
//
// It is a first draft. Legends, north arrows, roads drawn in black and faded
// photos all confuse it, which is why the editor exists.

export type Pt = [number, number]

export type RasterImage = { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

export type DetectOptions = {
  /** Pixels darker than this (0–255 luminance) count as boundary ink. Null picks a threshold automatically (Otsu). */
  darkness?: number | null
  /** Colour jump between neighbouring pixels that counts as a boundary (0 turns this off). Helps with maps that fill each ward with a colour. */
  edge?: number
  /** How far (px) to thicken ink so small breaks in boundary lines close. */
  closeGaps?: number
  /** Ignore patches smaller than this share of the picture. */
  minAreaRatio?: number
  /** Simplification tolerance in px. */
  simplify?: number
}

export type DetectedRegion = { label: number; ring: Pt[]; area: number; centroid: Pt }

export type DetectResult = {
  width: number
  height: number
  /** Per-pixel ward label: >0 ward, -1 outside, 0 unassigned. */
  labels: Int32Array
  regions: DetectedRegion[]
  threshold: number
}

export const DEFAULT_DETECT: Required<Omit<DetectOptions, "darkness">> & { darkness: number | null } = {
  darkness: null,
  edge: 0,
  closeGaps: 1,
  minAreaRatio: 0.0008,
  simplify: 1.2,
}

const OUTSIDE = -1

export function luminance(img: RasterImage): Uint8Array {
  const { width, height, data } = img
  const out = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = data[p + 3] / 255
    // Transparent pixels read as white paper.
    out[i] = Math.round((0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) * a + 255 * (1 - a))
  }
  return out
}

export function otsu(lum: Uint8Array): number {
  const hist = new Array<number>(256).fill(0)
  for (const v of lum) hist[v]++
  const total = lum.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

function inkMask(img: RasterImage, lum: Uint8Array, threshold: number, edge: number): Uint8Array {
  const { width, height, data } = img
  const ink = new Uint8Array(width * height)
  for (let i = 0; i < ink.length; i++) if (lum[i] <= threshold) ink[i] = 1
  if (edge > 0) {
    const diff = (a: number, b: number) => Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2])
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const p = i * 4
        if ((x + 1 < width && diff(p, p + 4) > edge) || (y + 1 < height && diff(p, p + width * 4) > edge)) ink[i] = 1
      }
    }
  }
  return ink
}

function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  if (r <= 0) return mask
  const tmp = new Uint8Array(mask.length)
  for (let y = 0; y < height; y++) {
    let run = -1
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) run = x
      if (run >= 0 && x - run <= r) tmp[y * width + x] = 1
    }
    run = -1
    for (let x = width - 1; x >= 0; x--) {
      if (mask[y * width + x]) run = x
      if (run >= 0 && run - x <= r) tmp[y * width + x] = 1
    }
  }
  const out = new Uint8Array(mask.length)
  for (let x = 0; x < width; x++) {
    let run = -1
    for (let y = 0; y < height; y++) {
      if (tmp[y * width + x]) run = y
      if (run >= 0 && y - run <= r) out[y * width + x] = 1
    }
    run = -1
    for (let y = height - 1; y >= 0; y--) {
      if (tmp[y * width + x]) run = y
      if (run >= 0 && run - y <= r) out[y * width + x] = 1
    }
  }
  return out
}

/** Labels 4-connected patches of non-ink. Returns labels (0 for ink) and per-label stats. */
function components(ink: Uint8Array, width: number, height: number) {
  const labels = new Int32Array(width * height)
  const queue = new Int32Array(width * height)
  const areas = [0]
  const touchesBorder = [false]
  let next = 1
  for (let start = 0; start < labels.length; start++) {
    if (ink[start] || labels[start]) continue
    const label = next++
    let head = 0
    let tail = 0
    let area = 0
    let border = false
    labels[start] = label
    queue[tail++] = start
    while (head < tail) {
      const i = queue[head++]
      area++
      const x = i % width
      const y = (i - x) / width
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) border = true
      if (x > 0 && !ink[i - 1] && !labels[i - 1]) { labels[i - 1] = label; queue[tail++] = i - 1 }
      if (x < width - 1 && !ink[i + 1] && !labels[i + 1]) { labels[i + 1] = label; queue[tail++] = i + 1 }
      if (y > 0 && !ink[i - width] && !labels[i - width]) { labels[i - width] = label; queue[tail++] = i - width }
      if (y < height - 1 && !ink[i + width] && !labels[i + width]) { labels[i + width] = label; queue[tail++] = i + width }
    }
    areas.push(area)
    touchesBorder.push(border)
  }
  return { labels, areas, touchesBorder }
}

/** Multi-source BFS: every unassigned pixel takes the label of the nearest assigned one. */
function grow(labels: Int32Array, width: number, height: number) {
  const queue = new Int32Array(labels.length)
  let tail = 0
  for (let i = 0; i < labels.length; i++) if (labels[i] !== 0) queue[tail++] = i
  let head = 0
  while (head < tail) {
    const i = queue[head++]
    const l = labels[i]
    const x = i % width
    if (x > 0 && labels[i - 1] === 0) { labels[i - 1] = l; queue[tail++] = i - 1 }
    if (x < width - 1 && labels[i + 1] === 0) { labels[i + 1] = l; queue[tail++] = i + 1 }
    if (i >= width && labels[i - width] === 0) { labels[i - width] = l; queue[tail++] = i - width }
    if (i + width < labels.length && labels[i + width] === 0) { labels[i + width] = l; queue[tail++] = i + width }
  }
}

/**
 * A small patch completely surrounded by one ward is almost always the inside of a digit
 * or a symbol ("0", "8", a temple icon), so it becomes part of that ward.
 */
function absorbEnclosed(labels: Int32Array, width: number, count: number) {
  const area = new Float64Array(count + 1)
  const neighbours = Array.from({ length: count + 1 }, () => new Set<number>())
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]
    if (l > 0) area[l]++
    const x = i % width
    const right = x < width - 1 ? labels[i + 1] : l
    const down = i + width < labels.length ? labels[i + width] : l
    for (const m of [right, down]) {
      if (m === l) continue
      if (l > 0) neighbours[l].add(m)
      if (m > 0) neighbours[m].add(l)
    }
  }
  // Touching the picture edge counts as a neighbour too.
  for (let x = 0; x < width; x++) {
    for (const i of [x, labels.length - width + x]) if (labels[i] > 0) neighbours[labels[i]].add(-2)
  }
  for (let i = 0; i < labels.length; i += width) {
    if (labels[i] > 0) neighbours[labels[i]].add(-2)
    if (labels[i + width - 1] > 0) neighbours[labels[i + width - 1]].add(-2)
  }
  const into = new Int32Array(count + 1)
  for (let l = 1; l <= count; l++) {
    const [only] = neighbours[l]
    if (neighbours[l].size === 1 && only > 0 && area[l] < 0.05 * area[only]) into[l] = only
  }
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i]
    if (l > 0 && into[l]) labels[i] = into[l]
  }
}

export function detectRegions(img: RasterImage, options: DetectOptions = {}): DetectResult {
  const opts = { ...DEFAULT_DETECT, ...options }
  const { width, height } = img
  const lum = luminance(img)
  // Otsu splits ink from paper; the cap stops it calling pale ward fills "ink" on maps without dark lines.
  const threshold = opts.darkness ?? Math.min(otsu(lum), 150)
  const ink = dilate(inkMask(img, lum, threshold, opts.edge), width, height, Math.round(opts.closeGaps))
  const { labels, areas, touchesBorder } = components(ink, width, height)

  const minArea = Math.max(12, opts.minAreaRatio * width * height)
  // Renumber: outside and noise first, then keep wards with compact labels 1..n.
  const remap = new Int32Array(areas.length)
  let n = 0
  for (let l = 1; l < areas.length; l++) remap[l] = touchesBorder[l] ? OUTSIDE : areas[l] < minArea ? 0 : ++n
  for (let i = 0; i < labels.length; i++) labels[i] = remap[labels[i]]
  // If nothing touches the border (e.g. a map cropped tight to its frame), there is no outside;
  // growing still works, the outermost ward just reaches the picture edge.
  grow(labels, width, height)
  absorbEnclosed(labels, width, n)

  const regions = traceRegions(labels, width, height, n, opts.simplify).filter((r) => r.area >= minArea / 2)
  regions.sort((a, b) => b.area - a.area)
  return { width, height, labels, regions, threshold }
}

// --- Outline tracing -------------------------------------------------------

// Corners of the pixel grid are indexed y * (width + 1) + x.
// Direction codes: 0 east, 1 south, 2 west, 3 north (image y points down).
const DX = [1, 0, -1, 0]
const DY = [0, 1, 0, -1]

function labelAt(labels: Int32Array, width: number, height: number, x: number, y: number) {
  return x < 0 || y < 0 || x >= width || y >= height ? -2 : labels[y * width + x]
}

/** A corner is a junction when three or more labels meet there, or two meet diagonally. */
function isJunction(labels: Int32Array, width: number, height: number, cx: number, cy: number) {
  const a = labelAt(labels, width, height, cx - 1, cy - 1)
  const b = labelAt(labels, width, height, cx, cy - 1)
  const c = labelAt(labels, width, height, cx - 1, cy)
  const d = labelAt(labels, width, height, cx, cy)
  const distinct = new Set([a, b, c, d]).size
  return distinct >= 3 || (distinct === 2 && a === d && b === c)
}

/** Traces every loop of one label's outline (clockwise on screen, interior on the right). Returns the largest. */
function traceOuter(labels: Int32Array, width: number, height: number, label: number, box: [number, number, number, number]): number[] | null {
  const W = width + 1
  const out = new Map<number, number[]>() // corner -> outgoing directions
  const add = (cx: number, cy: number, dir: number) => {
    const k = cy * W + cx
    const list = out.get(k)
    if (list) list.push(dir)
    else out.set(k, [dir])
  }
  const [x0, y0, x1, y1] = box
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (labels[y * width + x] !== label) continue
      if (labelAt(labels, width, height, x, y - 1) !== label) add(x, y, 0)
      if (labelAt(labels, width, height, x + 1, y) !== label) add(x + 1, y, 1)
      if (labelAt(labels, width, height, x, y + 1) !== label) add(x + 1, y + 1, 2)
      if (labelAt(labels, width, height, x - 1, y) !== label) add(x, y + 1, 3)
    }
  }
  let best: number[] | null = null
  let bestArea = 0
  for (const [startCorner, dirs] of out) {
    while (dirs.length) {
      const loop: number[] = []
      let corner = startCorner
      let dir = dirs.pop()!
      let area = 0
      for (;;) {
        loop.push(corner)
        const cx = corner % W
        const cy = (corner - cx) / W
        const nx = cx + DX[dir]
        const ny = cy + DY[dir]
        area += cx * ny - nx * cy
        corner = ny * W + nx
        const options = out.get(corner)
        if (!options || !options.length) break
        // Prefer turning right (towards the interior), then straight, then left.
        let pick = -1
        for (const turn of [1, 0, 3]) {
          const want = (dir + turn) % 4
          const idx = options.indexOf(want)
          if (idx >= 0) { pick = idx; break }
        }
        if (pick < 0) pick = 0
        dir = options.splice(pick, 1)[0]
      }
      // Clockwise on screen (y down) gives positive shoelace area; holes are negative.
      if (area > bestArea) {
        bestArea = area
        best = loop
      }
    }
  }
  return best
}

export function simplifyLine(points: Pt[], tolerance: number): Pt[] {
  if (points.length <= 2) return points.slice()
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  const tol2 = tolerance * tolerance
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = points[a]
    const [bx, by] = points[b]
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    let maxD = -1
    let maxI = -1
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]
      let d: number
      if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
        d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
      }
      if (d > maxD) { maxD = d; maxI = i }
    }
    if (maxD > tol2) {
      keep[maxI] = 1
      stack.push([a, maxI], [maxI, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

export function ringArea(ring: Pt[]): number {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

export function ringCentroid(ring: Pt[]): Pt {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    const f = x1 * y2 - x2 * y1
    a += f
    cx += (x1 + x2) * f
    cy += (y1 + y2) * f
  }
  if (!a) return ring[0] ?? [0, 0]
  return [cx / (3 * a), cy / (3 * a)]
}

function traceRegions(labels: Int32Array, width: number, height: number, count: number, tolerance: number): DetectedRegion[] {
  const boxes: [number, number, number, number][] = Array.from({ length: count + 1 }, () => [Infinity, Infinity, -1, -1])
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const l = labels[y * width + x]
      if (l <= 0) continue
      const b = boxes[l]
      if (x < b[0]) b[0] = x
      if (y < b[1]) b[1] = y
      if (x > b[2]) b[2] = x
      if (y > b[3]) b[3] = y
    }
  }
  const W = width + 1
  const toPt = (c: number): Pt => [c % W, Math.floor(c / W)]
  // Simplified shared chains, keyed by their endpoints and first step, so both neighbours reuse one result.
  const chainCache = new Map<string, Pt[]>()
  const regions: DetectedRegion[] = []
  for (let label = 1; label <= count; label++) {
    if (boxes[label][2] < 0) continue
    const loop = traceOuter(labels, width, height, label, boxes[label])
    if (!loop || loop.length < 4) continue
    const junctions: number[] = []
    for (let i = 0; i < loop.length; i++) {
      const [cx, cy] = toPt(loop[i])
      if (isJunction(labels, width, height, cx, cy)) junctions.push(i)
    }
    let ring: Pt[]
    if (junctions.length === 0) {
      // Only one neighbour all the way round: start at a fixed corner so the result is stable.
      let s = 0
      for (let i = 1; i < loop.length; i++) if (loop[i] < loop[s]) s = i
      const pts = [...loop.slice(s), ...loop.slice(0, s), loop[s]].map(toPt)
      ring = simplifyLine(pts, tolerance).slice(0, -1)
    } else {
      ring = []
      for (let j = 0; j < junctions.length; j++) {
        const from = junctions[j]
        const to = junctions[(j + 1) % junctions.length]
        const chain: number[] = []
        for (let i = from; ; i = (i + 1) % loop.length) {
          chain.push(loop[i])
          if (i === to && chain.length > 1) break
        }
        const forward = chain[0] < chain[chain.length - 1] || (chain[0] === chain[chain.length - 1] && chain[1] <= chain[chain.length - 2])
        const canon = forward ? chain : chain.slice().reverse()
        const key = `${canon[0]}:${canon[canon.length - 1]}:${canon[1]}:${canon.length}`
        let simplified = chainCache.get(key)
        if (!simplified) {
          simplified = simplifyLine(canon.map(toPt), tolerance)
          chainCache.set(key, simplified)
        }
        const part = forward ? simplified : simplified.slice().reverse()
        ring.push(...part.slice(0, -1))
      }
    }
    if (ring.length < 3) continue
    const area = ringArea(ring)
    if (area <= 0) continue
    regions.push({ label, ring, area, centroid: ringCentroid(ring) })
  }
  return regions
}

/** Label under a point, or 0. */
export function labelAtPoint(result: Pick<DetectResult, "labels" | "width" | "height">, x: number, y: number) {
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || py < 0 || px >= result.width || py >= result.height) return 0
  return result.labels[py * result.width + px]
}
