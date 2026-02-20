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

  it('aggressively near-dedupes same-page variants and keeps the most complete sentence', () => {
    const claims = [
      {
        id: 'claim_001',
        page: 2,
        text: 'Reduction in annualized relapse rate vs placebo',
        confidence: 0.9
      },
      {
        id: 'claim_002',
        page: 2,
        text: 'Drug X demonstrated a 42% reduction in annualized relapse rate versus placebo in adults with relapsing disease.',
        confidence: 0.82
      }
    ]

    const result = dedupeClaimsByPageAndText(claims, { strategy: 'aggressive-near' })

    expect(result.uniqueCount).toBe(1)
    expect(result.duplicateCount).toBe(1)
    expect(result.nearDuplicateCount).toBe(1)
    expect(result.claims[0].id).toBe('claim_002')
  })

  it('prefers qualifier-rich claim text when near-duplicate variants compete', () => {
    const claims = [
      {
        id: 'claim_001',
        page: 4,
        text: 'Drug X improved response rate versus placebo',
        confidence: 0.95
      },
      {
        id: 'claim_002',
        page: 4,
        text: 'Drug X improved response rate versus placebo (p<0.01; 95% CI 1.2-2.4; N=314).',
        confidence: 0.84
      }
    ]

    const result = dedupeClaimsByPageAndText(claims, { strategy: 'aggressive-near' })

    expect(result.uniqueCount).toBe(1)
    expect(result.claims[0].id).toBe('claim_002')
  })

  it('does not near-merge same-page claims with conflicting key statistics', () => {
    const claims = [
      { id: 'claim_001', page: 1, text: 'Drug X reduced risk by 42% vs placebo (p<0.01).' },
      { id: 'claim_002', page: 1, text: 'Drug X reduced risk by 28% vs placebo (p=0.04).' }
    ]

    const result = dedupeClaimsByPageAndText(claims, { strategy: 'aggressive-near' })

    expect(result.uniqueCount).toBe(2)
    expect(result.duplicateCount).toBe(0)
  })

  it('supports rollback by keeping exact-only behavior when strategy=exact', () => {
    const claims = [
      { id: 'claim_001', page: 5, text: 'Drug X reduced annualized relapse rate versus placebo.' },
      { id: 'claim_002', page: 5, text: 'Drug X reduced annualized relapse rate vs placebo in adults.' }
    ]

    const result = dedupeClaimsByPageAndText(claims, { strategy: 'exact' })

    expect(result.uniqueCount).toBe(2)
    expect(result.nearDuplicateCount).toBe(0)
  })
})
