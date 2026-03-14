/**
 * OCR Client — renders PDF pages to images, sends to PaddleOCR service,
 * and converts results into the line format used by the annotation pipeline.
 *
 * Separate from extractAnnotations.js so it can be tested independently.
 */

import {
  extractTrailingCitationRefs,
  parseSuperscriptCitationRefs
} from '@/utils/citationRefParsing'
import { logger } from '@/utils/logger'

const OCR_SERVICE_URL = 'http://localhost:8100'

/**
 * Merge OCR fragments into visual rows. PaddleOCR often splits wrapped text
 * into word-level fragments. Group by y-proximity and join left-to-right.
 */
function mergeOcrFragmentsIntoRows(ocrLines, yGap = 1.5) {
  if (!ocrLines || ocrLines.length === 0) return []

  // Sort top-to-bottom, then left-to-right
  const sorted = [...ocrLines].sort((a, b) => a.y_pct - b.y_pct || a.x_pct - b.x_pct)

  const rows = []
  let currentRow = null

  for (const line of sorted) {
    if (!line.text || !line.text.trim()) continue
    if (!currentRow || Math.abs(line.y_pct - currentRow.y) > yGap) {
      currentRow = {
        y: line.y_pct,
        fragments: [line]
      }
      rows.push(currentRow)
    } else {
      currentRow.fragments.push(line)
    }
  }

  // Join each row's fragments left-to-right
  return rows.map(row => {
    const frags = row.fragments.sort((a, b) => a.x_pct - b.x_pct)
    const text = frags.map(f => f.text.trim()).join(' ')
    const firstFrag = frags[0]
    const lastFrag = frags[frags.length - 1]
    return {
      text,
      y_pct: firstFrag.y_pct,
      x_pct: firstFrag.x_pct,
      height_pct: Math.max(...frags.map(f => f.height_pct || 0)),
      bbox: {
        x_min: Math.min(...frags.map(f => f.bbox?.x_min ?? Infinity)),
        y_min: Math.min(...frags.map(f => f.bbox?.y_min ?? Infinity)),
        x_max: Math.max(...frags.map(f => f.bbox?.x_max ?? 0)),
        y_max: Math.max(...frags.map(f => f.bbox?.y_max ?? 0))
      },
      confidence: Math.min(...frags.map(f => f.confidence ?? 0))
    }
  })
}

/**
 * Convert OCR service response lines into the {text, y, x, maxX, refs} format
 * expected by parseTextAnnotations().
 *
 * OCR lines come with y_pct/x_pct (0-100 percentages) which already match
 * the coordinate space used by the pdf.js extractor.
 */
export function convertOcrLinesToPageLines(ocrLines) {
  if (!ocrLines || ocrLines.length === 0) return []

  // First merge word-level fragments into visual rows
  const mergedRows = mergeOcrFragmentsIntoRows(ocrLines)

  return mergedRows
    .filter(line => line.text && line.text.trim().length > 2)
    .map(line => {
      const text = line.text.trim()
      const refs = new Set()

      // No font-size info from OCR, so use text-based superscript detection only
      extractTrailingCitationRefs(text).forEach(ref => refs.add(ref))
      parseSuperscriptCitationRefs(text).forEach(ref => refs.add(ref))

      // OCR-specific: detect trailing digits glued to text without whitespace.
      // OCR can't distinguish superscript positioning, so "improvement1" → ref 1.
      const trailingGlued = text.match(/[a-zA-Z)\].](\d{1,2})$/)
      if (trailingGlued) {
        const val = Number.parseInt(trailingGlued[1], 10)
        if (val > 0 && val <= 50) refs.add(val)
      }

      const sortedRefs = [...refs].sort((a, b) => a - b)

      return {
        text,
        y: Math.round(line.y_pct * 10) / 10,
        x: Math.round(line.x_pct * 10) / 10,
        maxX: Math.round(((line.bbox?.x_max || 0) / (line.bbox?.x_max > 100 ? 2550 : 1) * 100) * 10) / 10 || Math.round(line.x_pct * 10) / 10 + 20,
        refs: sortedRefs
      }
    })
}

/**
 * Check if the OCR service is running.
 */
export async function isOcrServiceAvailable() {
  try {
    const res = await fetch(`${OCR_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Render a pdf.js page to a PNG blob at the given DPI.
 * Returns { blob, width, height } or null on failure.
 */
export async function renderPageToBlob(pdfPage, dpi = 200) {
  const scale = dpi / 72 // pdf.js default is 72 DPI
  const viewport = pdfPage.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')

  await pdfPage.render({ canvasContext: ctx, viewport }).promise

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? { blob, width: viewport.width, height: viewport.height } : null)
    }, 'image/png')
  })
}

/**
 * Send a page image to the OCR service's /ocr/crop endpoint.
 * Crops to the slide region (top portion above notesBoundaryY).
 *
 * Returns the OCR response { lines, line_count, elapsed_ms } or null on failure.
 */
export async function ocrSlideRegion(pageBlob, cropBottomPct = 48) {
  try {
    const formData = new FormData()
    formData.append('file', pageBlob, 'page.png')

    const url = `${OCR_SERVICE_URL}/ocr/crop?crop_top_pct=0&crop_bottom_pct=${cropBottomPct}`
    const res = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(300000) // 5 min timeout per page
    })

    if (!res.ok) {
      logger.warn('OCR service returned error', { status: res.status })
      return null
    }

    return await res.json()
  } catch (err) {
    logger.warn('OCR service call failed', { error: err.message })
    return null
  }
}
