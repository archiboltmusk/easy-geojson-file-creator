import { DOMParser } from "@xmldom/xmldom"

// Browsers provide DOMParser; Node needs a stand-in for KML parsing.
globalThis.DOMParser ??= DOMParser as unknown as typeof globalThis.DOMParser
