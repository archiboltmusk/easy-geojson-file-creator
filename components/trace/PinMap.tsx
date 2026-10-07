"use client"

import type { FeatureCollection } from "geojson"
import type { ImageSource, Map as MapLibreMap, Marker } from "maplibre-gl"
import { Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { Pt } from "@/lib/trace/segment"

const OSM_STYLE = {
  version: 8 as const,
  sources: { osm: { type: "raster" as const, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
}

export type MapPin = { id: string; label: string; lngLat: Pt }

type Props = {
  pins: MapPin[]
  onPick?: (lngLat: Pt) => void
  wards: FeatureCollection | null
  /** The picture warped onto the map: data URL plus its corners (top-left, top-right, bottom-right, bottom-left). */
  overlay: { url: string; corners: [Pt, Pt, Pt, Pt] } | null
  overlayOpacity: number
  focus: [number, number, number, number] | null
  picking: boolean
}

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] }

export default function PinMap({ pins, onPick, wards, overlay, overlayOpacity, focus, picking }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const markers = useRef<Marker[]>([])
  const pickRef = useRef(onPick)
  const [ready, setReady] = useState(false)
  const [query, setQuery] = useState("")
  const [searchError, setSearchError] = useState<string | null>(null)
  pickRef.current = onPick

  useEffect(() => {
    let cancelled = false
    let instance: MapLibreMap | undefined
    import("maplibre-gl").then(({ Map, NavigationControl, setWorkerUrl }) => {
      if (cancelled || !container.current) return
      setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")
      instance = new Map({ container: container.current, style: OSM_STYLE, center: [78.9, 22.5], zoom: 3.5 })
      const m = instance
      m.addControl(new NavigationControl({ showCompass: false }), "top-right")
      m.on("click", (e) => pickRef.current?.([e.lngLat.lng, e.lngLat.lat]))
      m.on("load", () => {
        m.addSource("wards", { type: "geojson", data: EMPTY })
        m.addLayer({ id: "ward-fill", type: "fill", source: "wards", paint: { "fill-color": "#ed8b4d", "fill-opacity": 0.12 } })
        m.addLayer({ id: "ward-line", type: "line", source: "wards", paint: { "line-color": "#0d5b4b", "line-width": 2 } })
        map.current = m
        setReady(true)
      })
    })
    return () => {
      cancelled = true
      instance?.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    ;(m.getSource("wards") as { setData: (d: FeatureCollection) => void } | undefined)?.setData(wards ?? EMPTY)
  }, [ready, wards])

  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    const src = m.getSource("picture") as ImageSource | undefined
    if (!overlay) {
      if (m.getLayer("picture")) m.removeLayer("picture")
      if (src) m.removeSource("picture")
      return
    }
    if (src) src.updateImage({ url: overlay.url, coordinates: overlay.corners })
    else {
      m.addSource("picture", { type: "image", url: overlay.url, coordinates: overlay.corners })
      m.addLayer({ id: "picture", type: "raster", source: "picture", paint: { "raster-opacity": overlayOpacity } }, "ward-fill")
    }
  }, [ready, overlay])

  useEffect(() => {
    const m = map.current
    if (ready && m?.getLayer("picture")) m.setPaintProperty("picture", "raster-opacity", overlayOpacity)
  }, [ready, overlayOpacity, overlay])

  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    let cancelled = false
    import("maplibre-gl").then(({ Marker }) => {
      if (cancelled) return
      markers.current.forEach((mk) => mk.remove())
      markers.current = pins.map((p) => {
        const el = document.createElement("div")
        el.className = "grid size-[22px] place-items-center rounded-full border-2 border-white bg-[#0d5b4b] text-[11px] font-bold text-white shadow"
        el.textContent = p.label
        return new Marker({ element: el }).setLngLat(p.lngLat).addTo(m)
      })
    })
    return () => { cancelled = true }
  }, [ready, pins])

  useEffect(() => {
    const m = map.current
    if (ready && m && focus) m.fitBounds([[focus[0], focus[1]], [focus[2], focus[3]]], { padding: 30, maxZoom: 16, duration: 600 })
  }, [ready, focus])

  useEffect(() => {
    const canvas = map.current?.getCanvas()
    if (canvas) canvas.style.cursor = picking ? "crosshair" : ""
  }, [ready, picking])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setSearchError(null)
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`)
      const [hit] = (await res.json()) as { boundingbox: [string, string, string, string] }[]
      if (!hit) return setSearchError("No place found.")
      const [s, n, w, e2] = hit.boundingbox.map(Number)
      map.current?.fitBounds([[w, s], [e2, n]], { padding: 20, maxZoom: 15, duration: 600 })
    } catch {
      setSearchError("Search failed. Pan the map by hand instead.")
    }
  }

  return (
    <div className="relative h-full min-h-[360px] overflow-hidden rounded-[18px] border border-[#dce6df]">
      <div ref={container} className="h-full min-h-[360px] w-full" aria-label="Map for placing control points" />
      <form onSubmit={search} className="absolute left-3 top-3 z-10 flex w-[min(280px,calc(100%-70px))] items-center gap-2 rounded-xl bg-white px-3 py-2 shadow">
        <Search size={15} className="shrink-0 text-[#60736a]" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find your town (e.g. Purulia)" className="w-full bg-transparent text-sm outline-none" />
      </form>
      {searchError && <div className="absolute left-3 top-14 z-10 rounded-lg bg-white px-3 py-1.5 text-xs text-[#8a4a1f] shadow">{searchError}</div>}
    </div>
  )
}
