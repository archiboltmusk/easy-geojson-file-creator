"use client"

import { Code2, CircleHelp, Info, Map, ShieldCheck, Sparkles, X } from "lucide-react"
import { useState } from "react"
import Converter from "@/components/Converter"

export default function Home() {
  const [showGuide, setShowGuide] = useState(false)

  return (
    <main className="min-h-screen overflow-hidden">
      <header className="mx-auto flex max-w-[1320px] items-center justify-between px-6 py-5 lg:px-10">
        <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-[#0d5b4b] text-white"><Map size={19} strokeWidth={2.5} /></div><span className="text-[18px] font-bold tracking-[-0.04em]">CivicShape</span><span className="hidden rounded-full border border-[#cbd8cf] px-2 py-1 text-[10px] font-bold uppercase tracking-[.14em] text-[#60736a] sm:inline-flex">Open source</span></div>
        <nav className="flex items-center gap-6 text-sm text-[#63706a]"><button onClick={() => setShowGuide(!showGuide)} className="hidden items-center gap-2 hover:text-[#0d5b4b] sm:flex"><CircleHelp size={16} />How it works</button><a className="hidden items-center gap-2 hover:text-[#0d5b4b] sm:flex" href="https://github.com/archiboltmusk/easy-geojson-file-creator" target="_blank" rel="noreferrer"><Code2 size={16} />GitHub</a></nav>
      </header>

      <section className="mx-auto max-w-[1320px] px-6 pb-12 pt-10 lg:px-10 lg:pt-16">
        <div className="grid gap-10 lg:grid-cols-[1.05fr_.95fr] lg:items-end">
          <div><div className="mb-6 inline-flex items-center gap-2 rounded-full bg-[#d9eee4] px-3 py-1.5 text-xs font-bold text-[#0d5b4b]"><Sparkles size={14} />Built for local data</div><h1 className="max-w-[650px] text-[clamp(2.9rem,6vw,5.6rem)] font-bold leading-[.94] tracking-[-.075em] text-[#163b31]">Make your city data <span className="text-[#e37e42]">map-ready.</span></h1><p className="mt-7 max-w-[535px] text-[17px] leading-7 text-[#65716b]">A friendly, open-source tool for turning everyday municipal data into clean GeoJSON — no GIS degree required.</p><div className="mt-8 flex flex-wrap items-center gap-3 text-xs text-[#718079]"><span className="flex items-center gap-1.5"><ShieldCheck size={15} className="text-[#0d8062]" />Runs in your browser</span><span className="size-1 rounded-full bg-[#b9c5bd]" /><span>Free forever</span><span className="size-1 rounded-full bg-[#b9c5bd]" /><span>Built in public</span></div></div>
          <div className="relative hidden min-h-[235px] overflow-hidden rounded-[28px] bg-[#dcebe2] p-6 lg:block"><div className="absolute inset-0 opacity-35" style={{ backgroundImage: "linear-gradient(#aecabb 1px, transparent 1px), linear-gradient(90deg, #aecabb 1px, transparent 1px)", backgroundSize: "34px 34px" }} /><div className="absolute -right-12 top-7 h-48 w-[115%] rotate-[-11deg] rounded-[45%] border-[18px] border-[#8dbca7] opacity-70" /><div className="absolute left-16 top-24 grid size-11 place-items-center rounded-full bg-[#ed8b4d] text-white shadow-lg"><Map size={21} /></div><div className="absolute bottom-12 right-28 grid size-9 place-items-center rounded-full bg-[#d2ad45] text-white shadow-lg"><Map size={17} /></div><div className="absolute bottom-6 left-7 rounded-full bg-white/80 px-3 py-1.5 text-[11px] font-bold text-[#44705f]">Your city, your data</div></div>
        </div>

        <Converter />
      </section>

      <section className="mx-auto max-w-[1320px] px-6 pb-16 lg:px-10"><div className="grid gap-4 border-t border-[#dce4dd] pt-8 md:grid-cols-3"><div className="flex gap-3"><span className="text-2xl font-bold text-[#d5b84b]">01</span><div><h3 className="font-bold text-[#29483d]">Drop the file you got</h3><p className="mt-1 text-sm leading-5 text-[#7d8982]">Zipped Shapefile, KML/KMZ from Google Earth, or GeoJSON.</p></div></div><div className="flex gap-3"><span className="text-2xl font-bold text-[#e98a4d]">02</span><div><h3 className="font-bold text-[#29483d]">Check it on the map</h3><p className="mt-1 text-sm leading-5 text-[#7d8982]">Shapes are reprojected to WGS 84 and drawn over OpenStreetMap.</p></div></div><div className="flex gap-3"><span className="text-2xl font-bold text-[#5a9d7d]">03</span><div><h3 className="font-bold text-[#29483d]">Download GeoJSON</h3><p className="mt-1 text-sm leading-5 text-[#7d8982]">A clean FeatureCollection, ready to share or publish.</p></div></div></div></section>

      {showGuide && <div className="fixed bottom-5 right-5 z-20 w-[calc(100%-40px)] max-w-[350px] rounded-2xl border border-[#cbded0] bg-white p-5 shadow-xl"><div className="flex items-center justify-between"><strong className="text-[#193a30]">How CivicShape works</strong><button onClick={() => setShowGuide(false)}><X size={16} className="text-[#849189]" /></button></div><p className="mt-2 text-sm leading-6 text-[#6b7871]">CivicShape reads Shapefile, KML/KMZ and GeoJSON files, reprojects them to WGS 84 (picking up the .prj when there is one), and packages the result as a standard GeoJSON FeatureCollection. Your file stays in your browser.</p><div className="mt-3 flex items-center gap-2 text-xs font-bold text-[#0d8062]"><Info size={14} />Nothing is uploaded</div></div>}
    </main>
  )
}
