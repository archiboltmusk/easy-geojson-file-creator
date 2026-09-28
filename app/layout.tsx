import type { Metadata } from "next"
import "maplibre-gl/dist/maplibre-gl.css"
import "./globals.css"

export const metadata: Metadata = {
  title: "CivicShape — Turn city data into GeoJSON",
  description: "A simple, open-source workspace for converting municipal data into map-ready GeoJSON.",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>
}
