/**
 * Convert PyMuPDF rects (PDF points, origin bottom-left) to
 * viewport coordinates (pixels, origin top-left).
 *
 * @param {Array<{x0,y0,x1,y1}>} rects - Rects in PDF points
 * @param {number} pageHeightPts - Page height in PDF points
 * @param {number} scale - PDF.js viewport scale factor
 * @returns {Array<{left,top,width,height}>} CSS-ready positions
 */
export function convertPdfRectsToViewport(rects, pageHeightPts, scale) {
  return (rects || []).map(r => ({
    left: r.x0 * scale,
    top: (pageHeightPts - r.y1) * scale,
    width: (r.x1 - r.x0) * scale,
    height: (r.y1 - r.y0) * scale,
  }))
}

/**
 * Sort markers by page ascending, then visually top-to-bottom
 * (higher y1 in PDF coords = visually higher on page = comes first).
 */
export function sortMarkersForNavigation(markers) {
  return [...(markers || [])].sort((a, b) => {
    if (a.page_number !== b.page_number) return a.page_number - b.page_number
    const aTopY = Math.max(...(a.rects || []).map(r => r.y1))
    const bTopY = Math.max(...(b.rects || []).map(r => r.y1))
    return bTopY - aTopY
  })
}
