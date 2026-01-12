import { describe, it, expect } from 'vitest'
import { addGlobalIndices, enrichClaimsWithPositions } from '../../src/utils/textMatcher.js'

describe('textMatcher', () => {
  describe('addGlobalIndices', () => {
    it('preserves original order and assigns global indices by page', () => {
      const claims = [
        { id: 'a', page: 2 },
        { id: 'b', page: 1 },
        { id: 'c', page: 2 }
      ]

      const result = addGlobalIndices(claims)

      expect(result.length).toBe(3)
      expect(result[0].id).toBe('a')
      expect(result[1].id).toBe('b')
      expect(result[2].id).toBe('c')

      expect(result[0].globalIndex).toBe(2)
      expect(result[1].globalIndex).toBe(1)
      expect(result[2].globalIndex).toBe(3)
    })
  })

  describe('enrichClaimsWithPositions', () => {
    it('falls back when no extracted pages exist', () => {
      const claims = [
        { id: 'c1', text: 'Example claim', page: 1 },
        { id: 'c2', text: 'Another claim', page: 2 }
      ]

      const result = enrichClaimsWithPositions(claims, [])

      expect(result.length).toBe(2)
      expect(result[0].position.source).toBe('fallback')
      expect(result[1].position.source).toBe('fallback')
      expect(result[0].position.x).toBe(12)
      expect(result[0].position.y).toBe(12)
      expect(result[1].position.y).toBe(21)
    })
  })
})
