import { describe, expect, it } from 'vitest'
import { convertPdfRectsToViewport, sortMarkersForNavigation } from '../../src/utils/markerCoords.js'

describe('convertPdfRectsToViewport', () => {
  it('maps top-left coords and applies scale', () => {
    const rects = [{ x0: 72, y0: 680, x1: 540, y1: 695 }]
    const result = convertPdfRectsToViewport(rects, 792, 2.0)
    expect(result[0]).toEqual({
      left: 144,
      top: 1360,
      width: 936,
      height: 30,
    })
  })

  it('handles multiple rects (multiline highlight)', () => {
    const rects = [
      { x0: 100, y0: 500, x1: 400, y1: 512 },
      { x0: 100, y0: 488, x1: 380, y1: 500 },
    ]
    const result = convertPdfRectsToViewport(rects, 792, 1.5)
    expect(result).toHaveLength(2)
    expect(result[0].top).toBe(500 * 1.5)
    expect(result[1].top).toBe(488 * 1.5)
  })

  it('returns empty array for empty/null input', () => {
    expect(convertPdfRectsToViewport([], 792, 1.5)).toEqual([])
    expect(convertPdfRectsToViewport(null, 792, 1.5)).toEqual([])
  })
})

describe('sortMarkersForNavigation', () => {
  it('sorts by page then visually top-to-bottom', () => {
    const markers = [
      { page_number: 2, rects: [{ y0: 200 }] },
      { page_number: 1, rects: [{ y0: 400 }] },
      { page_number: 1, rects: [{ y0: 100 }] },
    ]
    const sorted = sortMarkersForNavigation(markers)
    expect(sorted[0].page_number).toBe(1)
    expect(sorted[0].rects[0].y0).toBe(100)
    expect(sorted[1].page_number).toBe(1)
    expect(sorted[1].rects[0].y0).toBe(400)
    expect(sorted[2].page_number).toBe(2)
  })

  it('returns empty array for null/empty', () => {
    expect(sortMarkersForNavigation(null)).toEqual([])
    expect(sortMarkersForNavigation([])).toEqual([])
  })

  it('does not mutate original array', () => {
    const markers = [
      { page_number: 2, rects: [{ y1: 100 }] },
      { page_number: 1, rects: [{ y1: 200 }] },
    ]
    const sorted = sortMarkersForNavigation(markers)
    expect(markers[0].page_number).toBe(2)
    expect(sorted[0].page_number).toBe(1)
  })
})
