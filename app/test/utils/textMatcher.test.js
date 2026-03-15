import { describe, it, expect } from 'vitest'
import { addGlobalIndices, alignClaimsToSlideLayout, enrichClaimsWithPositions } from '../../src/utils/textMatcher.js'

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

  describe('alignClaimsToSlideLayout', () => {
    const extractedPages = [
      {
        pageNum: 1,
        width: 1000,
        height: 1000,
        notesBoundaryY: 560,
        items: [],
        lines: [
          { text: 'Title', x: 90, y: 90, width: 220, height: 24, itemIndices: [] },
          { text: 'Left body copy', x: 120, y: 210, width: 240, height: 20, itemIndices: [] },
          { text: 'Right chart title', x: 700, y: 230, width: 180, height: 20, itemIndices: [] },
          { text: 'Speaker notes', x: 90, y: 590, width: 140, height: 20, itemIndices: [] },
          { text: 'Speaker note bullet works perfectly here', x: 100, y: 700, width: 360, height: 20, itemIndices: [] }
        ]
      }
    ]

    it('snaps slide claims into a coarse lane while keeping their vertical anchor on slide text', () => {
      const claims = [
        {
          id: 'slide-1',
          text: 'Response rates improved',
          page: 1,
          region: 'slide',
          position: { x: 78, y: 23 }
        }
      ]

      const result = alignClaimsToSlideLayout(claims, extractedPages)

      expect(result[0].position.source).toBe('coarse-slide-anchor')
      expect(result[0].position.x).toBe(91)
      expect(result[0].position.y).toBeCloseTo(22, 0)
      expect(result[0].position.lane).toBe('right')
      expect(result[0].position.width).toBe(0)
      expect(result[0].position.height).toBe(0)
    })

    it('derives the lane from the matched slide text cluster, not just the incoming x hint', () => {
      const claims = [
        {
          id: 'slide-2',
          text: 'Left body copy',
          page: 1,
          region: 'slide',
          position: { x: 82, y: 21 }
        }
      ]

      const result = alignClaimsToSlideLayout(claims, extractedPages)

      expect(result[0].position.source).toBe('coarse-slide-anchor')
      expect(result[0].position.x).toBe(9)
      expect(result[0].position.lane).toBe('left')
      expect(result[0].position.y).toBeCloseTo(20, 0)
    })

    it('does not alter speaker notes claims', () => {
      const claims = [
        {
          id: 'notes-1',
          text: 'Speaker note bullet works perfectly here',
          page: 1,
          region: 'notes',
          position: { x: 17, y: 70 }
        }
      ]

      const result = alignClaimsToSlideLayout(claims, extractedPages)

      expect(result[0]).toBe(claims[0])
      expect(result[0].position.source).toBeUndefined()
      expect(result[0].position.x).toBe(17)
      expect(result[0].position.y).toBe(70)
    })
  })
})
