"use client"

import { MUNICIPALITY_TYPES, type WardMeta } from "@/lib/ward-schema"

const FIELDS: { key: Exclude<keyof WardMeta, "municipality_type">; label: string; placeholder: string }[] = [
  { key: "municipality_name", label: "Municipality", placeholder: "Purulia Municipality" },
  { key: "district", label: "District", placeholder: "Purulia" },
  { key: "state", label: "State", placeholder: "West Bengal" },
  { key: "source_url", label: "Source link", placeholder: "https://… where the map came from" },
  { key: "license", label: "License", placeholder: "CC-BY-4.0" },
  { key: "year_delimited", label: "Year delimited (optional)", placeholder: "2022" },
]

export const inputClass = "mt-1 w-full rounded-xl border border-[#d9e3dc] bg-white px-3 py-2 text-sm font-normal text-[#29483d]"

export default function WardDetailsForm({ meta, onChange }: { meta: WardMeta; onChange: (meta: WardMeta) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {FIELDS.map((f) => (
        <label key={f.key} className="text-xs font-bold text-[#728078]">
          {f.label}
          <input value={meta[f.key]} placeholder={f.placeholder} onChange={(e) => onChange({ ...meta, [f.key]: e.target.value })} className={inputClass} />
        </label>
      ))}
      <label className="text-xs font-bold text-[#728078]">
        Type of body
        <select value={meta.municipality_type} onChange={(e) => onChange({ ...meta, municipality_type: e.target.value as WardMeta["municipality_type"] })} className={inputClass}>
          {MUNICIPALITY_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
      </label>
      <label className="text-xs font-bold text-[#728078]">
        Country code
        <input value={meta.country} maxLength={2} onChange={(e) => onChange({ ...meta, country: e.target.value.toUpperCase() })} className={inputClass} />
      </label>
    </div>
  )
}
