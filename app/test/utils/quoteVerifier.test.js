import { describe, it, expect } from 'vitest'
import { verifyQuote } from '../../src/utils/quoteVerifier.js'

describe('quoteVerifier', () => {
  const referenceText = `
    In the Phase 3 clinical trial, Drug X demonstrated a 47% reduction
    in seizure frequency compared to placebo (p<0.001, n=500).
    Discontinuation due to adverse events occurred in 3.2% of patients
    versus 2.8% in the placebo group. The most common adverse events
    were headache (12%), nausea (8%), and dizziness (6%).
  `.trim()

  describe('verified — exact substring', () => {
    it('returns verified when quote is an exact substring', () => {
      const quote = '47% reduction in seizure frequency compared to placebo'
      const result = verifyQuote(quote, referenceText)
      expect(result.status).toBe('verified')
      expect(result.charOffset).toBeGreaterThan(0)
    })

    it('handles whitespace normalization', () => {
      const quote = '47% reduction  in seizure frequency compared to placebo'
      const result = verifyQuote(quote, referenceText)
      expect(result.status).toBe('verified')
    })
  })

  describe('verified — fuzzy match (>=80% LCS)', () => {
    it('returns verified when quote is close but not exact', () => {
      const quote = '47% reduction in seizure frequency versus placebo'
      const result = verifyQuote(quote, referenceText)
      expect(result.status).toBe('verified')
    })
  })

  describe('partial — numeric tokens in same paragraph', () => {
    it('returns partial when key numbers appear nearby', () => {
      const quote = 'Seizure frequency was reduced by 47% with statistical significance of p<0.001'
      const result = verifyQuote(quote, referenceText)
      expect(result.status).toBe('partial')
    })
  })

  describe('unverified — hallucinated quote', () => {
    it('returns unverified when quote has no match', () => {
      const quote = 'Drug Y showed 83% improvement in cognitive function'
      const result = verifyQuote(quote, referenceText)
      expect(result.status).toBe('unverified')
    })
  })

  describe('edge cases', () => {
    it('handles empty quote', () => {
      const result = verifyQuote('', referenceText)
      expect(result.status).toBe('unverified')
    })

    it('handles empty reference', () => {
      const result = verifyQuote('some quote', '')
      expect(result.status).toBe('unverified')
    })
  })
})
