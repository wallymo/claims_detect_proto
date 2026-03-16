import { describe, it, expect } from 'vitest'
import {
  parseNumericCitationRefs,
  extractTrailingCitationRefs,
  parseSuperscriptCitationRefs,
  extractInlineFusedRefs
} from '../src/utils/citationRefParsing'

describe('parseNumericCitationRefs', () => {
  it('parses single digits', () => {
    expect(parseNumericCitationRefs('2')).toEqual([2])
  })

  it('parses comma-separated refs', () => {
    expect(parseNumericCitationRefs('1,2,3')).toEqual([1, 2, 3])
  })

  it('parses ranges', () => {
    expect(parseNumericCitationRefs('1-3')).toEqual([1, 2, 3])
  })

  it('parses mixed ranges and singles', () => {
    expect(parseNumericCitationRefs('1,3-5,7')).toEqual([1, 3, 4, 5, 7])
  })

  it('rejects numbers > 50', () => {
    expect(parseNumericCitationRefs('51')).toEqual([])
    expect(parseNumericCitationRefs('100')).toEqual([])
  })

  it('handles unicode dashes', () => {
    expect(parseNumericCitationRefs('1\u20132')).toEqual([1, 2])
  })
})

describe('extractTrailingCitationRefs', () => {
  it('extracts trailing digits from sentences', () => {
    expect(extractTrailingCitationRefs('demonstrated efficacy 1,2')).toEqual([1, 2])
  })

  it('extracts trailing range', () => {
    expect(extractTrailingCitationRefs('response rates improved 1-3')).toEqual([1, 2, 3])
  })

  it('returns empty for no trailing refs', () => {
    expect(extractTrailingCitationRefs('no refs here')).toEqual([])
  })

  it('ignores mid-sentence numbers', () => {
    expect(extractTrailingCitationRefs('the 47% reduction in disease')).toEqual([])
  })
})

describe('parseSuperscriptCitationRefs', () => {
  it('parses unicode superscript digits', () => {
    expect(parseSuperscriptCitationRefs('efficacy\u00b2')).toEqual([2])
  })

  it('parses multiple unicode superscripts', () => {
    expect(parseSuperscriptCitationRefs('response\u00b9\u00b7\u00b2')).toEqual([1, 2])
  })
})

describe('extractInlineFusedRefs', () => {
  it('extracts fused single digit', () => {
    expect(extractInlineFusedRefs('demonstrated efficacy2')).toContain(2)
  })

  it('extracts fused comma-separated refs', () => {
    const refs = extractInlineFusedRefs('outcomes1,2 were significant')
    expect(refs).toContain(1)
    expect(refs).toContain(2)
  })

  it('extracts fused range refs', () => {
    const refs = extractInlineFusedRefs('the disease1-3 showed improvement')
    expect(refs).toContain(1)
    expect(refs).toContain(2)
    expect(refs).toContain(3)
  })

  it('ignores years', () => {
    expect(extractInlineFusedRefs('published in2024')).toEqual([])
    expect(extractInlineFusedRefs('since 2023')).toEqual([])
  })

  it('ignores p-values and statistics', () => {
    expect(extractInlineFusedRefs('p<0.05')).toEqual([])
    expect(extractInlineFusedRefs('n=106')).toEqual([])
  })

  it('extracts refs after closing parens', () => {
    const refs = extractInlineFusedRefs('(P ≤0.05)2')
    expect(refs).toContain(2)
  })

  it('extracts refs after brackets', () => {
    const refs = extractInlineFusedRefs('[95% CI]1,2')
    expect(refs).toContain(1)
    expect(refs).toContain(2)
  })

  it('returns empty for clean text', () => {
    expect(extractInlineFusedRefs('no citations here at all')).toEqual([])
  })
})
