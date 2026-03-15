import { describe, it, expect } from 'vitest'
import { summarizeAnnotationClaims } from '../../src/utils/annotationSummary.js'

describe('annotationSummary', () => {
  it('counts rendered claims by source and global state', () => {
    const summary = summarizeAnnotationClaims([
      { id: '1', source: 'on-page', globalSpot: false },
      { id: '2', source: 'on-page', globalSpot: true },
      { id: '3', source: 'ai-find', globalSpot: false },
      null
    ])

    expect(summary).toEqual({
      total: 3,
      onPageCount: 2,
      aiFindCount: 1,
      globalAnnotationCount: 1
    })
  })
})
