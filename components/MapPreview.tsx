"use client"

import type { FeatureCollection } from "geojson"
import type { Map as MapLibreMap } from "maplibre-gl"
import { useEffect, useRef, useState } from "react"

const OSM_STYLE = {
  version: 8 as const,
  sources: { osm: { type: "raster" as const, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" } },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
}

const isType = (...types: string[]): ["match", ["geometry-type"], string[], boolean, boolean] => ["match", ["geometry-type"], types, true, false]

type Props = { data: FeatureCollection; bbox: [number, number, number, number] | null }

export default function MapPreview({ data, bbox }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibreMap | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let instance: MapLibreMap | undefined
    import("maplibre-gl").then(({ Map, NavigationControl, setWorkerUrl }) => {
      if (cancelled || !container.current) return
      setWorkerUrl("/maplibre/maplibre-gl-worker.mjs")
      instance = new Map({ container: container.current, style: OSM_STYLE, center: [78.9, 22.5], zoom: 3.5 })
      const m = instance
      m.addControl(new NavigationControl({ showCompass: false }), "top-right")
      m.on("load", () => {
        m.addSource("data", { type: "geojson", data: { type: "FeatureCollection", features: [] } })
        m.addLayer({ id: "fill", type: "fill", source: "data", filter: isType("Polygon", "MultiPolygon"), paint: { "fill-color": "#ed8b4d", "fill-opacity": 0.25 } })
        m.addLayer({ id: "line", type: "line", source: "data", filter: ["!", isType("Point", "MultiPoint")], paint: { "line-color": "#0d5b4b", "line-width": 2 } })
        m.addLayer({ id: "point", type: "circle", source: "data", filter: isType("Point", "MultiPoint"), paint: { "circle-color": "#ed8b4d", "circle-radius": 5, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } })
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
    const instance = map.current
    if (!ready || !instance) return
    ;(instance.getSource("data") as { setData: (d: FeatureCollection) => void } | undefined)?.setData(data)
    if (bbox) instance.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 40, maxZoom: 16, duration: 0 })
  }, [ready, data, bbox])

  return <div ref={container} className="h-full min-h-[340px] w-full overflow-hidden rounded-[22px] border border-[#dce6df]" aria-label="Map preview of converted features" />
}
