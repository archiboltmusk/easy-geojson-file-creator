"use client"

import type { FeatureCollection } from "geojson"
import { Download, ListChecks } from "lucide-react"
import { useMemo, useState } from "react"
import WardDetailsForm, { inputClass } from "@/components/WardDetailsForm"
import { EMPTY_META, guessColumns, mapToWardSchema, metaIssues, wardNumberIssues, type ColumnMapping, type WardMeta } from "@/lib/ward-schema"

/** Turns a converted file into the project's ward schema: pick the ward number/name columns, fill in the rest. */
export default function SchemaMapper({ collection, fields, onDownload }: { collection: FeatureCollection; fields: string[]; onDownload: (data: FeatureCollection, name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [mapping, setMapping] = useState<ColumnMapping>(() => guessColumns(fields))
  const [meta, setMeta] = useState<WardMeta>(EMPTY_META)
  const mapped = useMemo(() => mapToWardSchema(collection, mapping, meta), [collection, mapping, meta])
  const issues = [...wardNumberIssues(mapped.collection.features.map((f) => f.properties.ward_number)), ...metaIssues(meta)]
  const sample = collection.features.slice(0, 3).map((f) => f.properties?.[mapping.wardNumber]).filter((v) => v != null).join(", ")

  if (!open) {
    return <button onClick={() => setOpen(true)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#b9d0c2] bg-white px-4 py-2.5 text-xs font-bold text-[#0d5b4b] hover:bg-[#eff8f1]"><ListChecks size={15} />These are wards: map columns to the ward schema</button>
  }
  return (
    <div className="mt-4 rounded-2xl border border-[#dce6df] bg-white p-4 text-sm">
      <div className="font-bold text-[#29483d]">Ward schema</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-bold text-[#728078]">Ward number column
          <select value={mapping.wardNumber} onChange={(e) => setMapping({ ...mapping, wardNumber: e.target.value })} className={inputClass}>
            {fields.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          {sample && <span className="mt-1 block font-normal text-[#89958e]">e.g. {sample}</span>}
        </label>
        <label className="text-xs font-bold text-[#728078]">Ward name column
          <select value={mapping.wardName ?? ""} onChange={(e) => setMapping({ ...mapping, wardName: e.target.value || null })} className={inputClass}>
            <option value="">No names</option>
            {fields.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3"><WardDetailsForm meta={meta} onChange={setMeta} /></div>
      {(issues.length > 0 || mapped.skipped.length > 0) && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-[#8a4a1f]">
          {issues.map((i) => <li key={i}>{i}</li>)}
          {mapped.skipped.slice(0, 5).map((s) => <li key={s}>Left out: {s}</li>)}
          {mapped.skipped.length > 5 && <li>…and {mapped.skipped.length - 5} more left out.</li>}
        </ul>
      )}
      <button onClick={() => onDownload(mapped.collection, "wards.geojson")} disabled={!mapped.collection.features.length} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#0d5b4b] px-4 py-3 text-sm font-bold text-white hover:bg-[#0a4b3e] disabled:bg-[#9fb5ad]"><Download size={16} />Download wards.geojson ({mapped.collection.features.length} wards)</button>
    </div>
  )
}
