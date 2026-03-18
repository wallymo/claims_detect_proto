/**
 * Convert PyMuPDF rects (PDF points, origin top-left) to
 * viewport coordinates (pixels, origin top-left).
 *
 * @param {Array<{x0,y0,x1,y1}>} rects - Rects in PDF points
 * @param {number} pageHeightPts - Page height in PDF points (unused, kept for API compat)
 * @param {number} scale - PDF.js viewport scale factor
 * @returns {Array<{left,top,width,height}>} CSS-ready positions
 */
export function convertPdfRectsToViewport(rects, pageHeightPts, scale) {
  return (rects || []).map(r => ({
    left: r.x0 * scale,
    top: r.y0 * scale,
    width: (r.x1 - r.x0) * scale,
    height: (r.y1 - r.y0) * scale,
  }))
}

/**
 * Split markers whose rects span two distinct columns into separate markers.
 * Detects columns by clustering rects on x-midpoint and checking for a gap.
 */
const COL_GAP_MIN = 10 // pts — minimum x-range gap to confirm two columns

function splitCrossColumnMarkers(markers) {
  const result = []
  for (const m of markers) {
    const rects = m.rects || []
    if (rects.length < 2) { result.push(m); continue }

    // Merge overlapping x-ranges into intervals
    const sorted = [...rects].sort((a, b) => a.x0 - b.x0)
    const intervals = [[sorted[0].x0, sorted[0].x1]]
    for (let i = 1; i < sorted.length; i++) {
      const prev = intervals[intervals.length - 1]
      if (sorted[i].x0 <= prev[1] + 5) { // 5pt tolerance for near-touching
        prev[1] = Math.max(prev[1], sorted[i].x1)
      } else {
        intervals.push([sorted[i].x0, sorted[i].x1])
      }
    }

    // Only split if exactly 2 non-overlapping x-groups with a real gap
    if (intervals.length !== 2 || intervals[1][0] - intervals[0][1] < COL_GAP_MIN) {
      result.push(m); continue
    }

    const splitX = (intervals[0][1] + intervals[1][0]) / 2
    const leftRects = rects.filter(r => r.x1 <= splitX)
    const rightRects = rects.filter(r => r.x0 >= splitX)

    if (leftRects.length === 0 || rightRects.length === 0) { result.push(m); continue }

    result.push({ ...m, rects: leftRects, marker_id: `${m.marker_id}-L` })
    result.push({ ...m, rects: rightRects, marker_id: `${m.marker_id}-R` })
  }
  return result
}

/**
 * Sort markers by page ascending, then visually top-to-bottom
 * (smaller y0 in top-left origin = visually higher on page = comes first).
 * Splits cross-column annotations and merges adjacent same-column markers.
 */
const GAP_THRESHOLD = 8 // pts — roughly one line height

export function sortMarkersForNavigation(markers) {
  // Split cross-column annotations first
  const split = splitCrossColumnMarkers(markers || [])

  const sorted = [...split].sort((a, b) => {
    if (a.page_number !== b.page_number) return a.page_number - b.page_number
    const aTopY = Math.min(...(a.rects || []).map(r => r.y0))
    const bTopY = Math.min(...(b.rects || []).map(r => r.y0))
    return aTopY - bTopY
  })

  // Merge consecutive same-page markers that are truly the same paragraph
  const merged = []
  let prevOriginal = null
  for (const m of sorted) {
    const prev = merged[merged.length - 1]
    if (prev && prev.page_number === m.page_number && prevOriginal) {
      const prevBottom = Math.max(...prevOriginal.rects.map(r => r.y1))
      const curTop = Math.min(...(m.rects || []).map(r => r.y0))
      const prevMinX = Math.min(...prevOriginal.rects.map(r => r.x0))
      const prevMaxX = Math.max(...prevOriginal.rects.map(r => r.x1))
      const curMinX = Math.min(...(m.rects || []).map(r => r.x0))
      const curMaxX = Math.max(...(m.rects || []).map(r => r.x1))
      const overlapLeft = Math.max(prevMinX, curMinX)
      const overlapRight = Math.min(prevMaxX, curMaxX)
      const overlapW = Math.max(0, overlapRight - overlapLeft)
      const narrowerW = Math.min(prevMaxX - prevMinX, curMaxX - curMinX)
      const significantOverlap = narrowerW > 0 && overlapW / narrowerW > 0.3
      if (significantOverlap && curTop - prevBottom <= GAP_THRESHOLD) {
        prev.rects = [...prev.rects, ...(m.rects || [])]
        prev.text = [prev.text, m.text].filter(Boolean).join(' ')
        prevOriginal = m
        continue
      }
    }
    merged.push({ ...m, rects: [...(m.rects || [])] })
    prevOriginal = m
  }

  // Re-label after split + merge
  const pageCounts = {}
  for (const m of merged) {
    pageCounts[m.page_number] = (pageCounts[m.page_number] || 0) + 1
    m.label = String(pageCounts[m.page_number])
    m.index = pageCounts[m.page_number]
  }

  return merged
}
