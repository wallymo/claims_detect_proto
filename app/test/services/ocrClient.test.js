import { describe, expect, it, vi } from 'vitest'
import { convertOcrLinesToPageLines, isOcrServiceAvailable } from '../../src/services/ocrClient.js'

describe('convertOcrLinesToPageLines', () => {
  it('converts OCR response lines to the pipeline line format', () => {
    const ocrLines = [
      { text: 'Muscle Weakness at Admission', confidence: 0.99, y_pct: 14.1, x_pct: 8.4, height_pct: 2.5, bbox: { x_min: 143, y_min: 310, x_max: 900, y_max: 365 } },
      { text: 'González-Suárez I et al. BMC Neurol. 2013;13:95.', confidence: 0.99, y_pct: 45.0, x_pct: 5.1, height_pct: 1.0, bbox: { x_min: 87, y_min: 990, x_max: 800, y_max: 1012 } }
    ]

    const lines = convertOcrLinesToPageLines(ocrLines)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      text: 'Muscle Weakness at Admission',
      y: 14.1,
      x: 8.4,
      maxX: expect.any(Number),
      refs: []
    })
    // Second line has no trailing superscripts, so refs = []
    expect(lines[1].text).toBe('González-Suárez I et al. BMC Neurol. 2013;13:95.')
    expect(lines[1].y).toBe(45.0)
  })

  it('detects trailing superscript numbers via text parsing', () => {
    const ocrLines = [
      { text: 'Treatment showed improvement1', confidence: 0.98, y_pct: 20.0, x_pct: 10.0, height_pct: 2.0, bbox: { x_min: 170, y_min: 440, x_max: 700, y_max: 484 } },
      { text: 'Outcomes at 3 months (P≤0.05)2', confidence: 0.97, y_pct: 25.0, x_pct: 10.0, height_pct: 2.0, bbox: { x_min: 170, y_min: 550, x_max: 700, y_max: 594 } }
    ]

    const lines = convertOcrLinesToPageLines(ocrLines)

    expect(lines[0].refs).toEqual([1])
    expect(lines[1].refs).toEqual([2])
  })

  it('detects Unicode superscript characters in OCR text', () => {
    const ocrLines = [
      { text: 'Severity correlates with prognosis\u00b9\u00b7\u00b2', confidence: 0.95, y_pct: 18.0, x_pct: 12.0, height_pct: 2.0, bbox: { x_min: 204, y_min: 396, x_max: 800, y_max: 440 } }
    ]

    const lines = convertOcrLinesToPageLines(ocrLines)

    expect(lines[0].refs).toContain(1)
    expect(lines[0].refs).toContain(2)
  })

  it('returns empty array for empty input', () => {
    expect(convertOcrLinesToPageLines([])).toEqual([])
    expect(convertOcrLinesToPageLines(null)).toEqual([])
  })
})

describe('isOcrServiceAvailable', () => {
  it('returns false when service is unreachable', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    try {
      const result = await isOcrServiceAvailable()
      expect(result).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns true when service responds ok', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true })
    try {
      const result = await isOcrServiceAvailable()
      expect(result).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
