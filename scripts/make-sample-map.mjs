// Draws public/samples/purulia-wards-drawing.png from data/west-bengal/purulia/wards.geojson:
// a clean, printed-looking ward map to try the photo tracer on. It is NOT an official map.
// Needs Playwright with a Chromium build: `npx playwright@1 install chromium` (or set CHROMIUM_PATH).
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const wards = JSON.parse(readFileSync(join(root, "data/west-bengal/purulia/wards.geojson"), "utf8"))
const [w, s, e, n] = [86.3425, 23.3065, 86.3935, 23.3485]
const W = 1400
const H = Math.round((W * (n - s)) / ((e - w) * Math.cos((23.33 * Math.PI) / 180)))
const M = 80 // margin for the title
const px = ([lng, lat]) => [((lng - w) / (e - w)) * W, M + ((n - lat) / (n - s)) * H]

// Label position: the sampled interior point farthest from the ward's edge.
function inside([x, y], ring) {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
function edgeDist([x, y], ring) {
  let d = Infinity
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i], [bx, by] = ring[i + 1]
    const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy
    const t = l ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l)) : 0
    d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy))
  }
  return d
}
function labelPoint(ring) {
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1])
  let best = [xs[0], ys[0]], bestD = -1
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 3)
    for (let y = Math.min(...ys); y <= Math.max(...ys); y += 3)
      if (inside([x, y], ring)) { const d = edgeDist([x, y], ring); if (d > bestD) { bestD = d; best = [x, y] } }
  return best
}

const shapes = wards.features.map((f) => {
  const ring = f.geometry.coordinates[0].map(px)
  const [lx, ly] = labelPoint(ring)
  return `<path d="M${ring.map((p) => p.map((v) => v.toFixed(1)).join(",")).join("L")}Z" fill="none" stroke="#2b2b2b" stroke-width="3" stroke-linejoin="round"/>
  <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" font-family="Arial, sans-serif" font-weight="700" font-size="22" text-anchor="middle" dominant-baseline="central" fill="#1a1a1a">${f.properties.ward_number}</text>`
}).join("\n")

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + M + 20}" viewBox="0 0 ${W} ${H + M + 20}">
<rect width="100%" height="100%" fill="#fbf8f1"/>
<text x="${W / 2}" y="46" font-family="Georgia, serif" font-size="30" text-anchor="middle" fill="#333">PURULIA MUNICIPALITY · WARD MAP (sample drawing, not official)</text>
${shapes}
</svg>`

const { chromium } = await import("playwright")
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await browser.newPage({ viewport: { width: W, height: H + M + 20 } })
await page.setContent(`<body style="margin:0">${svg}</body>`)
await page.screenshot({ path: join(root, "public/samples/purulia-wards-drawing.png"), type: "png" })
await browser.close()
console.log(`wrote ${W}x${H + M + 20} sample`)
