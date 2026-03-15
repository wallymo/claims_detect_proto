import { describe, expect, it } from 'vitest'
import {
  extractTrailingCitationRefs,
  parseNumericCitationRefs,
  parseSuperscriptCitationRefs
} from '../../src/utils/citationRefParsing.js'

describe('citationRefParsing', () => {
  it('expands numeric citation ranges from superscript markers', () => {
    expect(parseNumericCitationRefs('2-13')).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  })

  it('handles mixed comma-separated refs and ranges', () => {
    expect(parseNumericCitationRefs('1, 3-5, 8')).toEqual([1, 3, 4, 5, 8])
  })

  it('filters implausible large values', () => {
    expect(parseNumericCitationRefs('2-13, 10000')).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  })

  it('parses unicode superscript citation markers', () => {
    expect(parseSuperscriptCitationRefs('Results¹·²')).toEqual([1, 2])
  })

  it('extracts trailing citation ranges from body text', () => {
    expect(extractTrailingCitationRefs('largest phase 3 trial of patients with EGFR+ disease 2-13*')).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
  })
})
