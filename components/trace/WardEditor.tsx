"use client"

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { ringCentroid, type Pt } from "@/lib/trace/segment"
import { insertOnSharedEdge, moveVertices, nearestEdge, removeSharedVertex, sharedVertices, type Ward } from "@/lib/trace/wards"

export type EditorMode = "select" | "draw" | "split" | "pin"

export type Pin = { id: string; label: string; pixel: Pt; done: boolean }

type Props = {
  image: string
  width: number
  height: number
  wards: Ward[]
  selected: string[]
  mode: EditorMode
  onSelect: (ids: string[]) => void
  /** commit=false while dragging (no undo step yet), true when the edit is finished. */
  onEdit: (wards: Ward[], commit: boolean) => void
  onDrawn?: (ring: Pt[]) => void
  onSplit?: (wardId: string, i: number, j: number) => void
  pins?: Pin[]
  onPin?: (pixel: Pt) => void
  className?: string
}

const PALETTE = ["#e37e42", "#0d8062", "#d2ad45", "#5a7fd6", "#b8568f", "#4aa3a0", "#8a6bd1", "#6f9a3a"]

type Drag =
  | { kind: "vertex"; start: Ward[]; targets: { wardId: string; index: number }[]; moved: boolean }
  | { kind: "pan"; from: Pt; view: View; moved: boolean }

type View = { x: number; y: number; w: number; h: number }

export default function WardEditor({ image, width, height, wards, selected, mode, onSelect, onEdit, onDrawn, onSplit, pins = [], onPin, className }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const [view, setView] = useState<View>({ x: 0, y: 0, w: width, h: height })
  const [draft, setDraft] = useState<Pt[]>([])
  const [hover, setHover] = useState<Pt | null>(null)
  const [splitFrom, setSplitFrom] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const [pxPerUnit, setPxPerUnit] = useState(1)

  useEffect(() => setView({ x: 0, y: 0, w: width, h: height }), [width, height])
  useEffect(() => { setDraft([]); setSplitFrom(null) }, [mode])
  useEffect(() => setSplitFrom(null), [selected])

  // Screen pixels per picture pixel, so handles and lines keep a constant on-screen size.
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const update = () => setPxPerUnit(el.getScreenCTM()?.a || el.clientWidth / view.w || 1)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [view.w, view.h])
  const u = 1 / pxPerUnit

  function toPicture(e: { clientX: number; clientY: number }): Pt {
    const el = svg.current!
    const m = el.getScreenCTM()!.inverse()
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m)
    return [p.x, p.y]
  }

  // Wheel zoom around the cursor. Attached natively so preventDefault works (React wheel listeners are passive).
  useEffect(() => {
    const el = svg.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [px, py] = toPicture(e)
      setView((v) => {
        const k = Math.exp(e.deltaY * 0.0015)
        const w = Math.min(width * 1.5, Math.max(width / 40, v.w * k))
        const h = (w / v.w) * v.h
        return { x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * h) / v.h, w, h }
      })
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [width])

  const selectedWards = wards.filter((w) => selected.includes(w.id))

  function finishDraft() {
    if (draft.length >= 3) onDrawn?.(draft)
    setDraft([])
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return
      if (mode === "draw" && e.key === "Enter") finishDraft()
      if (e.key === "Escape") { setDraft([]); setSplitFrom(null) }
      if (mode === "draw" && e.key === "Backspace") setDraft((d) => d.slice(0, -1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  function onBackgroundDown(e: ReactPointerEvent) {
    if (e.button !== 0) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    drag.current = { kind: "pan", from: [e.clientX, e.clientY], view, moved: false }
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current
    if (mode === "draw") setHover(toPicture(e))
    if (!d) return
    if (d.kind === "pan") {
      const dx = (e.clientX - d.from[0]) / pxPerUnit
      const dy = (e.clientY - d.from[1]) / pxPerUnit
      if (Math.abs(dx) + Math.abs(dy) > 2 / pxPerUnit) d.moved = true
      setView({ ...d.view, x: d.view.x - dx, y: d.view.y - dy })
    } else {
      d.moved = true
      onEdit(moveVertices(d.start, d.targets, toPicture(e)), false)
    }
  }

  function onPointerUp(e: ReactPointerEvent) {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === "vertex") {
      if (d.moved) onEdit(moveVertices(d.start, d.targets, toPicture(e)), true)
      return
    }
    if (d.moved) return
    // A click (not a pan) on empty space.
    const p = toPicture(e)
    if (mode === "draw") setDraft((dr) => [...dr, p])
    else if (mode === "pin") onPin?.(p)
    else if (mode === "select") onSelect([])
  }

  function onWardDown(e: ReactPointerEvent, ward: Ward) {
    if (mode === "pin" || mode === "draw") return // let the background handle it
    e.stopPropagation()
    if (mode === "split") return
    const multi = e.shiftKey || e.metaKey || e.ctrlKey
    onSelect(multi ? (selected.includes(ward.id) ? selected.filter((s) => s !== ward.id) : [...selected, ward.id]) : [ward.id])
    ;(svg.current as Element).setPointerCapture(e.pointerId)
    drag.current = { kind: "pan", from: [e.clientX, e.clientY], view, moved: true }
  }

  function onWardDoubleClick(e: React.MouseEvent, ward: Ward) {
    if (mode !== "select" || !selected.includes(ward.id)) return
    const edge = nearestEdge(ward.ring, toPicture(e))
    if (edge.distance > 12 * u) return
    const a = ward.ring[edge.index]
    const b = ward.ring[(edge.index + 1) % ward.ring.length]
    onEdit(insertOnSharedEdge(wards, a, b, edge.point), true)
  }

  function onVertexDown(e: ReactPointerEvent, ward: Ward, index: number) {
    e.stopPropagation()
    if (mode === "split") {
      if (splitFrom === null) setSplitFrom(index)
      else if (splitFrom !== index) {
        onSplit?.(ward.id, splitFrom, index)
        setSplitFrom(null)
      }
      return
    }
    if (mode !== "select") return
    if (e.altKey) {
      onEdit(removeSharedVertex(wards, ward.ring[index]), true)
      return
    }
    ;(svg.current as Element).setPointerCapture(e.pointerId)
    drag.current = { kind: "vertex", start: wards, targets: sharedVertices(wards, ward.ring[index]), moved: false }
  }

  function onVertexContext(e: React.MouseEvent, ward: Ward, index: number) {
    e.preventDefault()
    if (mode === "select") onEdit(removeSharedVertex(wards, ward.ring[index]), true)
  }

  const colorOf = (i: number) => PALETTE[i % PALETTE.length]
  const cursor = mode === "draw" || mode === "pin" ? "crosshair" : "grab"

  return (
    <div className={`relative overflow-hidden rounded-[18px] border border-[#dce6df] bg-[#eef3ef] ${className ?? ""}`}>
      <svg
        ref={svg}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className="block h-full w-full touch-none select-none"
        style={{ cursor }}
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => mode === "draw" && finishDraft()}
        onContextMenu={(e) => e.preventDefault()}
        role="application"
        aria-label="Ward editor"
      >
        <image href={image} x={0} y={0} width={width} height={height} preserveAspectRatio="none" style={{ pointerEvents: "none" }} />
        {wards.map((w, i) => {
          const sel = selected.includes(w.id)
          const missing = !w.number
          return (
            <polygon
              key={w.id}
              points={w.ring.map((p) => p.join(",")).join(" ")}
              fill={colorOf(i)}
              fillOpacity={mode === "pin" ? 0.08 : sel ? 0.45 : 0.22}
              stroke={sel ? "#0b3d32" : missing ? "#c2410c" : colorOf(i)}
              strokeWidth={(sel ? 2.5 : 1.5) * u}
              strokeDasharray={missing && !sel ? `${4 * u} ${3 * u}` : undefined}
              style={{ cursor: mode === "select" ? "pointer" : undefined, pointerEvents: mode === "pin" || mode === "draw" ? "none" : undefined }}
              onPointerDown={(e) => onWardDown(e, w)}
              onDoubleClick={(e) => onWardDoubleClick(e, w)}
            />
          )
        })}
        {wards.map((w) => {
          const [cx, cy] = ringCentroid(w.ring)
          return (
            <text key={`t${w.id}`} x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fontSize={13 * u} fontWeight={700} fill={w.number ? "#0b3d32" : "#c2410c"} stroke="#fff" strokeWidth={3 * u} paintOrder="stroke" style={{ pointerEvents: "none" }}>
              {w.number || "?"}
            </text>
          )
        })}
        {(mode === "select" || mode === "split") && selectedWards.map((w) => w.ring.map((p, i) => (
          <circle
            key={`${w.id}-${i}`}
            cx={p[0]}
            cy={p[1]}
            r={(mode === "split" && splitFrom === i ? 7 : 4.5) * u}
            fill={mode === "split" && splitFrom === i ? "#e37e42" : "#fff"}
            stroke="#0b3d32"
            strokeWidth={1.5 * u}
            style={{ cursor: mode === "split" ? "pointer" : "move" }}
            onPointerDown={(e) => onVertexDown(e, w, i)}
            onContextMenu={(e) => onVertexContext(e, w, i)}
          />
        )))}
        {draft.length > 0 && (
          <g style={{ pointerEvents: "none" }}>
            <polyline points={[...draft, ...(hover ? [hover] : [])].map((p) => p.join(",")).join(" ")} fill="#e37e42" fillOpacity={0.15} stroke="#e37e42" strokeWidth={2 * u} />
            {draft.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={4 * u} fill={i === 0 ? "#e37e42" : "#fff"} stroke="#e37e42" strokeWidth={1.5 * u} />)}
          </g>
        )}
        {pins.map((p) => (
          <g key={p.id} transform={`translate(${p.pixel[0]} ${p.pixel[1]})`} style={{ pointerEvents: "none" }}>
            <circle r={9 * u} fill={p.done ? "#0d5b4b" : "#e37e42"} stroke="#fff" strokeWidth={2 * u} />
            <text textAnchor="middle" dominantBaseline="central" fontSize={10 * u} fontWeight={700} fill="#fff">{p.label}</text>
          </g>
        ))}
      </svg>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-white/90 px-3 py-1 text-[11px] font-bold text-[#44705f]">
        {mode === "select" && "Click a ward to edit. Drag corners. Double-click an edge to add a corner, right-click a corner to remove it. Scroll to zoom, drag to pan."}
        {mode === "draw" && "Click to place corners. Double-click or Enter to finish, Backspace to undo a corner, Esc to cancel."}
        {mode === "split" && (splitFrom === null ? "Click the first corner of the cut." : "Now click the corner where the cut ends.")}
        {mode === "pin" && "Click a spot you can also find on the map, like a road crossing."}
      </div>
      <div className="absolute right-3 top-3 flex flex-col gap-1">
        <button type="button" aria-label="Zoom in" onClick={() => setView((v) => ({ x: v.x + v.w / 6, y: v.y + v.h / 6, w: (v.w * 2) / 3, h: (v.h * 2) / 3 }))} className="grid size-8 place-items-center rounded-lg bg-white text-lg font-bold text-[#29483d] shadow">+</button>
        <button type="button" aria-label="Zoom out" onClick={() => setView((v) => ({ x: v.x - v.w / 4, y: v.y - v.h / 4, w: v.w * 1.5, h: v.h * 1.5 }))} className="grid size-8 place-items-center rounded-lg bg-white text-lg font-bold text-[#29483d] shadow">−</button>
        <button type="button" aria-label="Fit picture" onClick={() => setView({ x: 0, y: 0, w: width, h: height })} className="grid size-8 place-items-center rounded-lg bg-white text-[10px] font-bold text-[#29483d] shadow">Fit</button>
      </div>
    </div>
  )
}
