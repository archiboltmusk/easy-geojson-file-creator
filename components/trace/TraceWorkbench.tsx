"use client"

import dynamic from "next/dynamic"
import { AlertTriangle, Combine, Download, Loader2, MapPin, MousePointer2, PenLine, Redo2, RotateCcw, ScanLine, Scissors, Trash2, Undo2, Upload, X } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import WardDetailsForm, { inputClass } from "@/components/WardDetailsForm"
import { applyGeoref, fitGeoref, georefFromBoxes, residuals, type Georef } from "@/lib/trace/georef"
import { AREA_PRESETS } from "@/lib/trace/presets"
import { DEFAULT_DETECT, detectRegions, type Pt } from "@/lib/trace/segment"
import { exportWards, mergeWards, newWardId, splitWard, wardsBBox, wardsFromRegions, type Ward } from "@/lib/trace/wards"
import { EMPTY_META, metaIssues, parseWardNumber, wardNumberIssues, type WardMeta } from "@/lib/ward-schema"
import type { EditorMode } from "./WardEditor"

const WardEditor = dynamic(() => import("./WardEditor"), { ssr: false })
const PinMap = dynamic(() => import("./PinMap"), { ssr: false, loading: () => <div className="grid h-full min-h-[360px] place-items-center rounded-[18px] border border-[#dce6df] bg-[#edf6f0] text-sm text-[#60786b]">Loading map…</div> })
const MapPreview = dynamic(() => import("../MapPreview"), { ssr: false })

type Picture = { canvas: HTMLCanvasElement; url: string; name: string; pageCount: number; page: number }
type ControlPin = { id: string; pixel: Pt; lngLat: Pt | null }
type Step = 1 | 2 | 3 | 4

const STEPS: { n: Step; label: string }[] = [
  { n: 1, label: "Picture" },
  { n: 2, label: "Fix wards" },
  { n: 3, label: "Place on map" },
  { n: 4, label: "Download" },
]

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/geo+json" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

export default function TraceWorkbench() {
  const [file, setFile] = useState<File | null>(null)
  const [picture, setPicture] = useState<Picture | null>(null)
  const [step, setStep] = useState<Step>(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [ocrProgress, setOcrProgress] = useState<number | null>(null)
  const [notice, setNotice] = useState<{ tone: "info" | "warn"; text: string } | null>(null)
  const [opts, setOpts] = useState({ darkness: DEFAULT_DETECT.darkness as number | null, edge: 0, closeGaps: DEFAULT_DETECT.closeGaps })
  const [showSettings, setShowSettings] = useState(false)
  const [wards, setWards] = useState<Ward[]>([])
  const [past, setPast] = useState<Ward[][]>([])
  const [future, setFuture] = useState<Ward[][]>([])
  const dragBase = useRef<Ward[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [mode, setMode] = useState<EditorMode>("select")
  const [pins, setPins] = useState<ControlPin[]>([])
  const [presetId, setPresetId] = useState("")
  const [opacity, setOpacity] = useState(0.55)
  const [meta, setMeta] = useState<WardMeta>(EMPTY_META)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const runId = useRef(0)

  // --- history -------------------------------------------------------------
  function commit(next: Ward[], base = wards) {
    setPast((p) => [...p.slice(-60), base])
    setFuture([])
    setWards(next)
  }
  function onEdit(next: Ward[], done: boolean) {
    if (!done) {
      dragBase.current ??= wards
      setWards(next)
      return
    }
    commit(next, dragBase.current ?? wards)
    dragBase.current = null
  }
  function undo() {
    if (!past.length) return
    setFuture((f) => [wards, ...f])
    setWards(past[past.length - 1])
    setPast((p) => p.slice(0, -1))
  }
  function redo() {
    if (!future.length) return
    setPast((p) => [...p, wards])
    setWards(future[0])
    setFuture((f) => f.slice(1))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select") || step !== 2) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo() }
      if ((e.key === "Delete" || e.key === "Backspace") && mode === "select" && selected.length) { e.preventDefault(); removeSelected() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  // --- loading & detection ---------------------------------------------------
  async function openFile(f: File | undefined, page = 1) {
    if (!f) return
    setNotice(null)
    setBusy(f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "Opening PDF…" : "Opening picture…")
    try {
      const { loadPicture } = await import("@/lib/trace/picture")
      const pic = await loadPicture(f, page)
      setFile(f)
      setPicture({ ...pic, url: pic.canvas.toDataURL("image/png") })
      setWards([]); setPast([]); setFuture([]); setSelected([]); setPins([])
      setBusy(null)
      await detect(pic.canvas)
    } catch (e) {
      setBusy(null)
      setNotice({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't open this file." })
    }
  }

  async function openSample() {
    const res = await fetch("/samples/purulia-wards-drawing.png")
    const blob = await res.blob()
    await openFile(new File([blob], "purulia-wards-drawing.png", { type: "image/png" }))
    setPresetId("purulia")
    setMeta((m) => ({ ...m, ...AREA_PRESETS[0].meta }))
  }

  async function detect(canvas = picture?.canvas) {
    if (!canvas) return
    const run = ++runId.current
    setBusy("Finding ward boundaries…")
    setMode("select")
    await nextFrame()
    const { pixels } = await import("@/lib/trace/picture")
    const img = pixels(canvas)
    const result = detectRegions(img, opts)
    const found = wardsFromRegions(result.regions)
    const labelToId = new Map(result.regions.map((r, i) => [r.label, found[i].id]))
    commit(found)
    setSelected([])
    setBusy(null)
    setStep(2)
    if (!found.length) {
      setNotice({ tone: "warn", text: "No wards found. Try “Detection settings” (boundaries may be lighter, or wards told apart by colour), or draw them by hand." })
      return
    }
    setNotice({ tone: "info", text: `Found ${found.length} shapes. Reading ward numbers…` })
    setOcrProgress(0)
    try {
      const { readWardNumbers } = await import("@/lib/trace/ocr")
      const numbers = await readWardNumbers(img, result, (p) => run === runId.current && setOcrProgress(p))
      if (run !== runId.current) return
      const byId = new Map([...numbers].map(([label, n]) => [labelToId.get(label), n]))
      setWards((ws) => ws.map((w) => (!w.number && byId.has(w.id) ? { ...w, number: byId.get(w.id)!, numberSource: "ocr" } : w)))
      setNotice({ tone: "info", text: `Found ${found.length} shapes and read ${numbers.size} ward numbers. Numbers read automatically are marked “read”; check each one.` })
    } catch (e) {
      console.warn("Reading ward numbers failed", e)
      if (run === runId.current) setNotice({ tone: "warn", text: `Found ${found.length} shapes, but couldn't read the numbers automatically. Type them in the list.` })
    } finally {
      if (run === runId.current) setOcrProgress(null)
    }
  }

  // --- ward edits -------------------------------------------------------------
  const selectedWards = wards.filter((w) => selected.includes(w.id))

  function updateWard(id: string, patch: Partial<Ward>) {
    commit(wards.map((w) => (w.id === id ? { ...w, ...patch } : w)))
  }
  function removeSelected() {
    commit(wards.filter((w) => !selected.includes(w.id)))
    setSelected([])
  }
  function merge() {
    if (selectedWards.length < 2) return
    try {
      const merged = selectedWards.slice(1).reduce((acc, w) => mergeWards(acc, w), selectedWards[0])
      commit([...wards.filter((w) => !selected.includes(w.id) || w.id === merged.id).map((w) => (w.id === merged.id ? merged : w))])
      setSelected([merged.id])
    } catch (e) {
      setNotice({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't merge these wards." })
    }
  }
  function onSplit(id: string, i: number, j: number) {
    const w = wards.find((x) => x.id === id)
    if (!w) return
    try {
      const [a, b] = splitWard(w, i, j)
      commit(wards.flatMap((x) => (x.id === id ? [a, b] : [x])))
      setSelected([b.id])
      setMode("select")
      setNotice({ tone: "info", text: "Split done. Give the new ward its number." })
    } catch (e) {
      setNotice({ tone: "warn", text: e instanceof Error ? e.message : "Couldn't split here." })
    }
  }
  function onDrawn(ring: Pt[]) {
    const w: Ward = { id: newWardId(), ring, number: "", name: "", numberSource: "none" }
    commit([...wards, w])
    setSelected([w.id])
    setMode("select")
  }

  // --- georeferencing -------------------------------------------------------------
  const donePins = useMemo(() => pins.filter((p): p is ControlPin & { lngLat: Pt } => !!p.lngLat), [pins])
  const pending = pins.find((p) => !p.lngLat) ?? null
  const preset = AREA_PRESETS.find((p) => p.id === presetId) ?? null
  const georef: Georef | null = useMemo(() => {
    if (donePins.length >= 3) return fitGeoref(donePins)
    const box = wardsBBox(wards)
    return preset && box ? georefFromBoxes(box, preset.bbox) : null
  }, [donePins, preset, wards])
  const errors = georef && donePins.length >= 4 ? residuals(georef, donePins) : null

  function onPixelPin(pixel: Pt) {
    if (pending) setPins((ps) => ps.map((p) => (p.id === pending.id ? { ...p, pixel } : p)))
    else setPins((ps) => [...ps, { id: newWardId(), pixel, lngLat: null }])
  }
  function onMapPin(lngLat: Pt) {
    if (pending) setPins((ps) => ps.map((p) => (p.id === pending.id ? { ...p, lngLat } : p)))
    else setNotice({ tone: "info", text: "First click a spot on the picture, then the same spot on the map." })
  }

  const lngLatWards = useMemo(() => (georef ? exportWards(wards.map((w) => ({ ...w, number: w.number || "0" })), georef, meta).collection : null), [georef, wards, meta])
  const overlay = useMemo(() => {
    if (!georef || !picture) return null
    const { width: w, height: h } = picture.canvas
    const corners = ([[0, 0], [w, 0], [w, h], [0, h]] as Pt[]).map((p) => applyGeoref(georef, p)) as [Pt, Pt, Pt, Pt]
    return { url: picture.url, corners }
  }, [georef, picture])
  // Refit the map only when the placement changes (a point or preset added), not on every ward edit.
  const [focus, setFocus] = useState<[number, number, number, number] | null>(null)
  const placementKey = `${step}:${donePins.length}:${presetId}`
  const [lastPlacement, setLastPlacement] = useState("")
  if (placementKey !== lastPlacement) {
    setLastPlacement(placementKey)
    if (lngLatWards?.features.length) {
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
      for (const f of lngLatWards.features) for (const [x, y] of f.geometry.coordinates[0]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
      setFocus([x0, y0, x1, y1])
    } else if (preset) setFocus(preset.bbox)
  }

  // --- export ------------------------------------------------------------------------
  const numberIssues = wardNumberIssues(wards.map((w) => parseWardNumber(w.number)))
  const exported = georef ? exportWards(wards, georef, meta) : null
  const detailIssues = metaIssues(meta)
  const fileName = `${slug(meta.municipality_name) || "wards"}.geojson`

  const reset = () => {
    runId.current++
    setFile(null); setPicture(null); setWards([]); setPast([]); setFuture([]); setSelected([]); setPins([]); setStep(1); setNotice(null); setOcrProgress(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  const canGo = (s: Step) => s === 1 || (s === 2 && !!picture) || (s === 3 && wards.length > 0) || (s === 4 && wards.length > 0 && !!georef)
  const toolBtn = (active: boolean) => `flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold ${active ? "bg-[#0d5b4b] text-white" : "bg-white text-[#29483d] hover:bg-[#eef6f1]"} disabled:opacity-40`

  return (
    <div className="mt-6 overflow-hidden rounded-[28px] border border-[#dbe3dc] bg-white shadow-[0_18px_60px_rgba(30,66,51,.08)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5ebe5] px-5 py-4 sm:px-8">
        <ol className="flex flex-wrap items-center gap-2 text-xs font-bold">
          {STEPS.map((s) => (
            <li key={s.n}>
              <button type="button" disabled={!canGo(s.n)} onClick={() => setStep(s.n)} className={`flex items-center gap-2 rounded-full px-3 py-1.5 ${step === s.n ? "bg-[#0d5b4b] text-white" : "text-[#60736a] hover:bg-[#eef6f1]"} disabled:cursor-not-allowed disabled:opacity-40`}>
                <span className={`grid size-5 place-items-center rounded-full text-[10px] ${step === s.n ? "bg-white text-[#0d5b4b]" : "bg-[#e3ece6]"}`}>{s.n}</span>{s.label}
              </button>
            </li>
          ))}
        </ol>
        {picture && <button onClick={reset} className="flex items-center gap-1.5 text-xs font-bold text-[#60736a] hover:text-[#0d5b4b]"><RotateCcw size={14} />Start over</button>}
      </div>

      <div className="p-5 sm:p-8">
        {notice && (
          <div role={notice.tone === "warn" ? "alert" : "status"} className={`mb-4 flex items-start gap-2 rounded-2xl border p-3 text-sm ${notice.tone === "warn" ? "border-[#f1c7a9] bg-[#fdf3ec] text-[#8a4a1f]" : "border-[#cfe3d7] bg-[#f1f8f3] text-[#2d5646]"}`}>
            {notice.tone === "warn" && <AlertTriangle size={17} className="mt-0.5 shrink-0" />}
            <span className="flex-1">{notice.text}{ocrProgress !== null && ` ${Math.round(ocrProgress * 100)}%`}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss"><X size={15} /></button>
          </div>
        )}

        {step === 1 && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); openFile(e.dataTransfer.files[0]) }}
            className={`rounded-[22px] border-2 border-dashed p-8 text-center transition ${dragging ? "border-[#0d8062] bg-[#eef8f2]" : "border-[#c8d8ce] bg-[#f8fbf8]"}`}
          >
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-white text-[#0d8062] shadow-sm">{busy ? <Loader2 size={22} className="animate-spin" /> : <Upload size={22} />}</div>
            <h3 className="mt-4 text-lg font-bold text-[#29483d]">{busy ?? "Drop a photo or PDF of your ward map"}</h3>
            <p className="mx-auto mt-1 max-w-[520px] text-sm text-[#89958e]">A straight-on photo or scan with clear boundary lines works best. CivicShape outlines the wards and reads their numbers as a first draft; you then fix it, place it on the map and download GeoJSON.</p>
            <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" className="sr-only" onChange={(e) => openFile(e.target.files?.[0])} />
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button onClick={() => inputRef.current?.click()} disabled={!!busy} className="rounded-full bg-[#0d5b4b] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#0a4b3e]">Choose a photo or PDF</button>
              <button onClick={openSample} disabled={!!busy} className="rounded-full border border-[#b9d0c2] bg-white px-5 py-2.5 text-xs font-bold text-[#0d5b4b] hover:bg-[#eff8f1]">Try a Purulia sample</button>
            </div>
            <p className="mt-4 text-[11px] text-[#a0aaa3]">Your picture never leaves this browser. Reading numbers loads a free text reader (Tesseract, about 7 MB) the first time.</p>
          </div>
        )}

        {step === 2 && picture && (
          <div className="grid gap-5 lg:grid-cols-[1fr_330px]">
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-xl bg-[#f1f6f2] p-1.5">
                <button className={toolBtn(mode === "select")} onClick={() => setMode("select")}><MousePointer2 size={14} />Select</button>
                <button className={toolBtn(mode === "draw")} onClick={() => { setMode("draw"); setSelected([]) }}><PenLine size={14} />Draw ward</button>
                <button className={toolBtn(mode === "split")} disabled={selected.length !== 1} onClick={() => setMode("split")} title="Select one ward, then click two of its corners"><Scissors size={14} />Split</button>
                <button className={toolBtn(false)} disabled={selected.length < 2} onClick={merge} title="Shift-click to select touching wards"><Combine size={14} />Merge</button>
                <button className={toolBtn(false)} disabled={!selected.length} onClick={removeSelected}><Trash2 size={14} />Delete</button>
                <span className="mx-1 h-5 w-px bg-[#d4e0d8]" />
                <button className={toolBtn(false)} disabled={!past.length} onClick={undo} aria-label="Undo"><Undo2 size={14} /></button>
                <button className={toolBtn(false)} disabled={!future.length} onClick={redo} aria-label="Redo"><Redo2 size={14} /></button>
              </div>
              <WardEditor image={picture.url} width={picture.canvas.width} height={picture.canvas.height} wards={wards} selected={selected} mode={mode} onSelect={setSelected} onEdit={onEdit} onDrawn={onDrawn} onSplit={onSplit} className="h-[min(70vh,640px)]" />
            </div>

            <aside className="flex min-h-0 flex-col gap-3">
              <div className="rounded-2xl border border-[#f1dcc2] bg-[#fdf7ef] p-3 text-xs leading-5 text-[#7a5225]">
                <strong>This is a first draft.</strong> Automatic outlines miss faint lines, pick up legends and roads, and misread numbers. Check every ward against the picture before you download.
              </div>

              {selectedWards.length === 1 && (
                <div className="rounded-2xl border border-[#cfe3d7] bg-[#f5faf7] p-3">
                  <div className="text-xs font-bold text-[#29483d]">Selected ward</div>
                  <div className="mt-2 grid grid-cols-[90px_1fr] gap-2">
                    <label className="text-[11px] font-bold text-[#728078]">Number<input autoFocus value={selectedWards[0].number} onChange={(e) => updateWard(selectedWards[0].id, { number: e.target.value, numberSource: "manual" })} className={inputClass} /></label>
                    <label className="text-[11px] font-bold text-[#728078]">Name (optional)<input value={selectedWards[0].name} onChange={(e) => updateWard(selectedWards[0].id, { name: e.target.value })} className={inputClass} /></label>
                  </div>
                </div>
              )}
              {selectedWards.length > 1 && <div className="rounded-2xl border border-[#cfe3d7] bg-[#f5faf7] p-3 text-xs text-[#29483d]">{selectedWards.length} wards selected. Merge joins them if they touch.</div>}

              <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[#dce6df]">
                <div className="flex items-center justify-between border-b border-[#e5ebe5] px-3 py-2 text-xs font-bold text-[#29483d]"><span>{wards.length} wards</span>{ocrProgress !== null && <span className="flex items-center gap-1 text-[#60736a]"><Loader2 size={12} className="animate-spin" />Reading numbers</span>}</div>
                <ul className="max-h-[300px] flex-1 overflow-auto p-1.5 lg:max-h-[330px]">
                  {[...wards].sort((a, b) => (a.number || "zzz").localeCompare(b.number || "zzz", undefined, { numeric: true })).map((w) => (
                    <li key={w.id}>
                      <div onClick={(e) => setSelected(e.shiftKey ? [...selected, w.id] : [w.id])} className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${selected.includes(w.id) ? "bg-[#e3f0e8]" : "hover:bg-[#f3f7f4]"}`}>
                        <input aria-label="Ward number" value={w.number} placeholder="?" onClick={(e) => e.stopPropagation()} onFocus={() => setSelected([w.id])} onChange={(e) => updateWard(w.id, { number: e.target.value, numberSource: "manual" })} className={`w-14 rounded-md border px-2 py-1 font-bold ${w.number ? "border-[#d9e3dc]" : "border-[#f0b48a] bg-[#fff7f1]"}`} />
                        <span className="flex-1 truncate text-[#60736a]">{w.name || (w.number ? `Ward ${w.number}` : "Needs a number")}</span>
                        {w.numberSource === "ocr" && <span className="rounded-full bg-[#fff1d6] px-1.5 py-0.5 text-[10px] font-bold text-[#8a6212]" title="Read automatically; please check">read</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              {numberIssues.length > 0 && <ul className="space-y-1 text-xs text-[#8a4a1f]">{numberIssues.map((i) => <li key={i}>{i}</li>)}</ul>}

              <details open={showSettings} onToggle={(e) => setShowSettings((e.target as HTMLDetailsElement).open)} className="rounded-2xl border border-[#dce6df] p-3 text-xs text-[#29483d]">
                <summary className="cursor-pointer font-bold">Detection settings</summary>
                <label className="mt-3 block text-[#60736a]">Boundary darkness {opts.darkness === null ? "(auto)" : opts.darkness}
                  <input type="range" min={40} max={230} value={opts.darkness ?? 128} onChange={(e) => setOpts({ ...opts, darkness: +e.target.value })} className="w-full" />
                </label>
                <label className="mt-2 block text-[#60736a]">Close gaps in lines: {opts.closeGaps}px
                  <input type="range" min={0} max={6} value={opts.closeGaps} onChange={(e) => setOpts({ ...opts, closeGaps: +e.target.value })} className="w-full" />
                </label>
                <label className="mt-2 flex items-center gap-2 text-[#60736a]"><input type="checkbox" checked={opts.edge > 0} onChange={(e) => setOpts({ ...opts, edge: e.target.checked ? 70 : 0 })} />Wards are shown as coloured areas</label>
                <div className="mt-3 flex gap-2">
                  <button onClick={() => detect()} disabled={!!busy} className="flex items-center gap-1.5 rounded-lg bg-[#0d5b4b] px-3 py-2 font-bold text-white"><ScanLine size={14} />{busy ? "Working…" : "Detect again"}</button>
                  {opts.darkness !== null && <button onClick={() => setOpts({ ...opts, darkness: null })} className="rounded-lg px-3 py-2 font-bold text-[#60736a]">Auto darkness</button>}
                </div>
                <p className="mt-2 text-[#89958e]">Detecting again replaces your edits (Undo brings them back). PDFs: page {picture.page} of {picture.pageCount}.</p>
                {picture.pageCount > 1 && file && (
                  <select value={picture.page} onChange={(e) => openFile(file, +e.target.value)} className={inputClass}>
                    {Array.from({ length: picture.pageCount }, (_, i) => <option key={i} value={i + 1}>Page {i + 1}</option>)}
                  </select>
                )}
              </details>

              <button onClick={() => { setStep(3); setMode("pin") }} disabled={!wards.length} className="flex items-center justify-center gap-2 rounded-xl bg-[#0d5b4b] px-4 py-3 text-sm font-bold text-white hover:bg-[#0a4b3e] disabled:bg-[#9fb5ad]"><MapPin size={16} />Next: place on the map</button>
            </aside>
          </div>
        )}

        {step === 3 && picture && (
          <div>
            <p className="mb-3 max-w-[760px] text-sm text-[#60736a]">Match at least <strong>3 spots</strong> (4 or more for a tilted photo): click a spot on the picture, then the same spot on the map. Road crossings, rail stations and river bends work well. Spread them out.</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <WardEditor image={picture.url} width={picture.canvas.width} height={picture.canvas.height} wards={wards} selected={[]} mode="pin" onSelect={() => {}} onEdit={() => {}} pins={pins.map((p, i) => ({ id: p.id, label: String(i + 1), pixel: p.pixel, done: !!p.lngLat }))} onPin={onPixelPin} className="h-[min(60vh,520px)]" />
              <div className="h-[min(60vh,520px)]">
                <PinMap pins={donePins.map((p) => ({ id: p.id, label: String(pins.indexOf(p) + 1), lngLat: p.lngLat }))} onPick={onMapPin} wards={lngLatWards} overlay={overlay} overlayOpacity={opacity} focus={focus} picking={!!pending} />
              </div>
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-[#dce6df] p-3 text-xs">
                <div className="font-bold text-[#29483d]">Control points</div>
                {pins.length === 0 && <p className="mt-1 text-[#89958e]">None yet.</p>}
                <ul className="mt-2 space-y-1">
                  {pins.map((p, i) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <span className={`grid size-5 place-items-center rounded-full text-[10px] font-bold text-white ${p.lngLat ? "bg-[#0d5b4b]" : "bg-[#e37e42]"}`}>{i + 1}</span>
                      <span className="flex-1 text-[#60736a]">{p.lngLat ? `${p.lngLat[1].toFixed(5)}, ${p.lngLat[0].toFixed(5)}` : "Now click this spot on the map"}{errors && p.lngLat && ` · off by ${Math.round(errors[donePins.indexOf(p as ControlPin & { lngLat: Pt })])} m`}</span>
                      <button onClick={() => setPins(pins.filter((x) => x.id !== p.id))} aria-label="Remove point"><X size={14} className="text-[#849189]" /></button>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[#89958e]">
                  {donePins.length >= 3 && georef ? `Placed with ${donePins.length} points (${georef.kind === "projective" ? "corrects tilt" : "straight scan"}).${donePins.length === 3 ? " Add a 4th to see how well the points agree." : ""}` : donePins.length >= 3 ? "These points are in a line; spread them out." : `${3 - donePins.length} more point${3 - donePins.length === 1 ? "" : "s"} needed.`}
                  {errors && Math.max(...errors) > 150 && " A point is far off; check it or remove it."}
                </p>
              </div>
              <div className="rounded-2xl border border-[#dce6df] p-3 text-xs text-[#29483d]">
                <label className="font-bold">Quick start for a known town
                  <select value={presetId} onChange={(e) => { setPresetId(e.target.value); const p = AREA_PRESETS.find((x) => x.id === e.target.value); if (p) setMeta((m) => ({ ...m, ...Object.fromEntries(Object.entries(p.meta).filter(([k]) => !m[k as keyof WardMeta] || k === "municipality_type")) })) }} className={inputClass}>
                    <option value="">None</option>
                    {AREA_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </label>
                <p className="mt-1 text-[#89958e]">Stretches the wards over the town&apos;s known extent. Rough only (assumes north is up); control points replace it once you have 3.</p>
                <label className="mt-3 block font-bold">Picture on map: {Math.round(opacity * 100)}%
                  <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} className="w-full" />
                </label>
                <button onClick={() => setStep(4)} disabled={!georef} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0d5b4b] px-4 py-3 text-sm font-bold text-white hover:bg-[#0a4b3e] disabled:bg-[#9fb5ad]">Next: details and download</button>
              </div>
            </div>
          </div>
        )}

        {step === 4 && georef && exported && (
          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div>
              <h3 className="text-sm font-bold text-[#29483d]">About these wards</h3>
              <p className="mb-3 mt-1 text-xs text-[#89958e]">Saved on every ward, following the project&apos;s ward schema.</p>
              <WardDetailsForm meta={meta} onChange={setMeta} />
              {[...numberIssues, ...detailIssues].length > 0 && (
                <ul className="mt-4 list-disc space-y-1 rounded-2xl border border-[#f1c7a9] bg-[#fdf3ec] p-3 pl-7 text-xs text-[#8a4a1f]">
                  {[...numberIssues, ...detailIssues].map((i) => <li key={i}>{i}</li>)}
                  {exported.problems.length > 0 && <li>Wards without a valid number are left out of the file.</li>}
                </ul>
              )}
              <button onClick={() => download(fileName, exported.collection)} disabled={!exported.collection.features.length} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0d5b4b] px-4 py-3 text-sm font-bold text-white hover:bg-[#0a4b3e] disabled:bg-[#9fb5ad]"><Download size={16} />Download {fileName} ({exported.collection.features.length} wards)</button>
              <p className="mt-2 text-[11px] text-[#89958e]">To share it with everyone, add it to the project as data/{slug(meta.state) || "state"}/{slug(meta.district) || "city"}/wards.geojson. Traced wards are approximate; say so in the source description.</p>
            </div>
            <div className="h-[420px]">
              <MapPreview data={exported.collection} bbox={focus} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
