import { describe, it, expect } from 'vitest'
import { dedupeClaimsByPageAndText, normalizeDedupText } from '../../src/utils/claimDedup.js'

describe('claimDedup', () => {
  it('normalizes visually identical text with hidden chars to same key', () => {
    const a = 'Patients achieved a 47% reduction'
    const b = 'Patients\u200B achieved\u2060 a 47% reduction'

    expect(normalizeDedupText(a)).toBe(normalizeDedupText(b))
  })

  it('dedupes same-page claims when text differs only by markers/punctuation', () => {
    const claims = [
      {
        id: 'claim_001',
        page: 1,
        text: 'Patients achieved a 47% reduction†',
        confidence: 0.8,
        position: { x: 22, y: 31 }
      },
      {
        id: 'claim_002',
        page: 1,
        text: '“Patients achieved a 47% reduction.”',
        confidence: 0.9,
        position: { x: 20, y: 30, width: 18, height: 2 }
      }
    ]

    const result = dedupeClaimsByPageAndText(claims)

    expect(result.uniqueCount).toBe(1)
    expect(result.duplicateCount).toBe(1)
    expect(result.claims).toHaveLength(1)
    expect(result.claims[0].id).toBe('claim_002')
  })

  it('keeps identical text when it appears on different pages', () => {
    const claims = [
      { id: 'claim_001', page: 1, text: 'Common safety profile', confidence: 0.7 },
      { id: 'claim_002', page: 2, text: 'Common safety profile', confidence: 0.7 }
    ]

    const result = dedupeClaimsByPageAndText(claims)

    expect(result.uniqueCount).toBe(2)
    expect(result.duplicateCount).toBe(0)
    expect(result.claims).toHaveLength(2)
  })

  it('keeps distinct claims on the same page', () => {
    const claims = [
      { id: 'claim_001', page: 3, text: '46% reduction in events', confidence: 0.85 },
      { id: 'claim_002', page: 3, text: '32% fewer discontinuations', confidence: 0.88 }
    ]

    const result = dedupeClaimsByPageAndText(claims)

    expect(result.uniqueCount).toBe(2)
    expect(result.duplicateCount).toBe(0)
    expect(result.claims).toHaveLength(2)
  })
})
