// Browser-only: turns an uploaded photo or PDF page into a canvas we can analyse and draw over.

export const MAX_SIDE = 1600

export const PICTURE_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf,.pdf"

export type Picture = { canvas: HTMLCanvasElement; name: string; pageCount: number; page: number }

function fit(width: number, height: number) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name)

export async function loadPicture(file: File, page = 1): Promise<Picture> {
  const canvas = document.createElement("canvas")
  if (isPdf(file)) {
    const pdfjs = await import("pdfjs-dist")
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs"
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
    const doc = await task.promise
    const pdfPage = await doc.getPage(Math.min(Math.max(1, page), doc.numPages))
    const base = pdfPage.getViewport({ scale: 1 })
    const size = fit(base.width * 4, base.height * 4)
    const viewport = pdfPage.getViewport({ scale: size.width / base.width })
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext("2d")!
    ctx.fillStyle = "#fff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await pdfPage.render({ canvas, canvasContext: ctx, viewport }).promise
    const pageCount = doc.numPages
    await task.destroy()
    return { canvas, name: file.name, pageCount, page: pdfPage.pageNumber }
  }
  if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error("Use a photo (JPG, PNG, WebP) or a PDF of the ward map.")
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    throw new Error("This picture couldn't be opened. Try saving it as JPG or PNG.")
  })
  const size = fit(bitmap.width, bitmap.height)
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext("2d")!
  ctx.fillStyle = "#fff"
  ctx.fillRect(0, 0, size.width, size.height)
  ctx.drawImage(bitmap, 0, 0, size.width, size.height)
  bitmap.close()
  return { canvas, name: file.name, pageCount: 1, page: 1 }
}

export function pixels(canvas: HTMLCanvasElement) {
  return canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height)
}
