"use client"

import type { FeatureCollection } from "geojson"
import dynamic from "next/dynamic"
import { AlertTriangle, Check, Download, FileJson, Loader2, RotateCcw, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { ACCEPTED_EXTENSIONS, convertFile, outputName, summarize, type ConvertResult } from "@/lib/convert"
import { CRS_PRESETS } from "@/lib/crs"
import SchemaMapper from "./SchemaMapper"

const MapPreview = dynamic(() => import("./MapPreview"), { ssr: false, loading: () => <div className="grid h-full min-h-[340px] place-items-center rounded-[22px] border border-[#dce6df] bg-[#edf6f0] text-sm text-[#60786b]">Loading map…</div> })

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] }

const FORMAT_LABEL = { shapefile: "Shapefile", kml: "KML", kmz: "KMZ", geojson: "GeoJSON" }

export default function Converter() {
  const [source, setSource] = useState<{ name: string; data: ArrayBuffer } | null>(null)
  const [crs, setCrs] = useState("")
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function run(name: string, data: ArrayBuffer, chosenCrs: string) {
    setBusy(true)
    setError(null)
    try {
      setResult(await convertFile(name, data, { crs: chosenCrs || undefined }))
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : "Something went wrong reading this file.")
    } finally {
      setBusy(false)
    }
  }

  async function handleFile(file?: File) {
    if (!file) return
    const data = await file.arrayBuffer()
    setSource({ name: file.name, data })
    setCrs("")
    await run(file.name, data, "")
  }

  function changeCrs(next: string) {
    setCrs(next)
    if (source) run(source.name, source.data, next)
  }

  function download(data = result?.collection, name = source ? outputName(source.name) : "") {
    if (!data || !name) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/geo+json" }))
    const a = document.createElement("a")
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  function reset() {
    setSource(null)
    setResult(null)
    setError(null)
    setCrs("")
    if (inputRef.current) inputRef.current.value = ""
  }

  const summary = result ? summarize(result.collection) : null
  const step = result && !result.needsCrs ? 2 : 1
  const showCrsPicker = !!result && (result.needsCrs || !!crs)

  return (
    <div className="mt-6 overflow-hidden rounded-[28px] border border-[#dbe3dc] bg-white shadow-[0_18px_60px_rgba(30,66,51,.08)]">
      <div className="flex items-center justify-between border-b border-[#e5ebe5] px-5 py-4 sm:px-8">
        <div className="flex items-center gap-3 text-sm font-bold text-[#193a30]"><span className="grid size-7 place-items-center rounded-full bg-[#0d5b4b] text-xs text-white">{step}</span>{step === 1 ? "Drop a map file" : "Check the map, then download"}</div>
        {source && <button onClick={reset} className="flex items-center gap-1.5 text-xs font-bold text-[#60736a] hover:text-[#0d5b4b]"><RotateCcw size={14} />Start over</button>}
      </div>
      <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[.9fr_1.1fr] lg:p-10">
        <div>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }}
            className={`rounded-[22px] border-2 border-dashed p-6 text-center transition ${dragging ? "border-[#0d8062] bg-[#eef8f2]" : "border-[#c8d8ce] bg-[#f8fbf8]"}`}
          >
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-white text-[#0d8062] shadow-sm">{busy ? <Loader2 size={22} className="animate-spin" /> : <Upload size={22} />}</div>
            <h3 className="mt-4 text-lg font-bold text-[#29483d]">{source ? source.name : "Drop your map file here"}</h3>
            <p className="mt-1 text-sm text-[#89958e]">Zipped Shapefile, KML, KMZ or GeoJSON</p>
            <input ref={inputRef} type="file" accept={ACCEPTED_EXTENSIONS.join(",")} className="sr-only" onChange={(e) => handleFile(e.target.files?.[0])} />
            <button onClick={() => inputRef.current?.click()} className="mt-5 rounded-full border border-[#b9d0c2] bg-white px-5 py-2.5 text-xs font-bold text-[#0d5b4b] hover:bg-[#eff8f1]">{source ? "Choose another file" : "Choose a file"}</button>
            <p className="mt-4 text-[11px] text-[#a0aaa3]">Your file never leaves this browser.</p>
          </div>

          {error && <div role="alert" className="mt-4 flex gap-2 rounded-2xl border border-[#f1c7a9] bg-[#fdf3ec] p-4 text-sm text-[#8a4a1f]"><AlertTriangle size={18} className="shrink-0" />{error}</div>}

          {showCrsPicker && (
            <label className="mt-4 block rounded-2xl border border-[#dce6df] bg-[#f7fbf8] p-4 text-xs font-bold text-[#728078]">
              Coordinate system of the source data
              <select value={crs} onChange={(e) => changeCrs(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[#d9e3dc] bg-white px-3 py-2.5 text-sm font-normal text-[#29483d]">
                <option value="">Choose your state / zone…</option>
                {CRS_PRESETS.map((p) => <option key={p.code} value={p.code}>{p.label} ({p.code}) · {p.region}</option>)}
              </select>
              <span className="mt-2 block font-normal">If the shapes land in the wrong place, try a neighbouring zone.</span>
            </label>
          )}

          {result && summary && (
            <div className="mt-4 rounded-2xl border border-[#dce6df] bg-[#f7fbf8] p-4 text-sm text-[#29483d]">
              <div className="flex items-center justify-between font-bold"><span className="flex items-center gap-2"><FileJson size={18} className="text-[#0d8062]" />{outputName(source?.name ?? "")}</span>{!result.needsCrs && <Check size={17} className="text-[#0d8062]" />}</div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-[#60736a]">
                <dt>Read as</dt><dd>{FORMAT_LABEL[result.format]}</dd>
                <dt>Features</dt><dd>{summary.count} ({Object.entries(summary.geometryTypes).map(([t, n]) => `${n} ${t}`).join(", ")})</dd>
                <dt>Reprojected</dt><dd>{result.sourceCrs ? `${result.sourceCrs} → WGS 84` : "No, already WGS 84"}</dd>
                <dt>Columns</dt><dd className="break-words">{summary.fields.join(", ") || "None"}</dd>
              </dl>
              {result.warnings.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-[#8a4a1f]">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
              <button onClick={() => download()} disabled={result.needsCrs} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0d5b4b] px-4 py-3 text-sm font-bold text-white hover:bg-[#0a4b3e] disabled:cursor-not-allowed disabled:bg-[#9fb5ad]"><Download size={16} />Download GeoJSON</button>
              {!result.needsCrs && summary.fields.length > 0 && <SchemaMapper key={source?.name} collection={result.collection} fields={summary.fields} onDownload={download} />}
            </div>
          )}
        </div>
        <div className="relative">
          <MapPreview data={result && !result.needsCrs ? result.collection : EMPTY} bbox={result && !result.needsCrs ? result.bbox : null} />
          {!result && <span className="pointer-events-none absolute bottom-4 left-4 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-bold text-[#44705f]">Your shapes appear here. Wrong place? The coordinate system is off.</span>}
        </div>
      </div>
    </div>
  )
}
