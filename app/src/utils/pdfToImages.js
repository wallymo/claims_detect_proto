/**
 * Convert PDF pages to PNG images for models that need image input
 * (GPT-4o, Claude) instead of native PDF support (Gemini).
 */

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

// Use same worker setup as PDFViewer
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`

// Max pages to convert (prevents massive payloads)
const MAX_PAGES = 10

/**
 * Convert PDF to array of base64 PNG images
 * @param {File} pdfFile - The PDF file to convert
 * @param {number} scale - Resolution multiplier (default 2 for crisp text ~144 DPI)
 * @returns {Promise<Array<{page: number, base64: string}>>}
 */
export async function pdfToImages(pdfFile, scale = 2) {
  const arrayBuffer = await pdfFile.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const pageCount = Math.min(pdf.numPages, MAX_PAGES)
  if (pdf.numPages > MAX_PAGES) {
    console.warn(`PDF has ${pdf.numPages} pages, converting first ${MAX_PAGES} only`)
  }

  const images = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })

    // Create off-screen canvas
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height

    const context = canvas.getContext('2d')

    await page.render({
      canvasContext: context,
      viewport
    }).promise

    // Convert to base64 PNG (strip data URL prefix)
    const dataUrl = canvas.toDataURL('image/png')
    const base64 = dataUrl.split(',')[1]

    images.push({
      page: i,
      base64
    })
  }

  // Log payload size for cost awareness
  const totalBytes = images.reduce((sum, img) => sum + img.base64.length, 0)
  console.log(`📄 Converted ${images.length} pages to PNG (~${Math.round(totalBytes / 1024)}KB)`)

  return images
}
