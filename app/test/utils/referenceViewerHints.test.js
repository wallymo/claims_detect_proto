import { describe, it, expect } from 'vitest'
import { charOffsetToPage, parseCitationPageRange, resolveCitationPdfPage } from '../../src/utils/referenceViewerHints.js'

describe('referenceViewerHints', () => {
  describe('parseCitationPageRange', () => {
    it('parses full journal page ranges from citations', () => {
      expect(parseCitationPageRange('1. Smith J et al. Neurology. 2024;15(11):680-690.')).toEqual({
        start: 680,
        end: 690,
        label: '680-690'
      })
    })

    it('expands abbreviated end pages', () => {
      expect(parseCitationPageRange('Brown T et al. Lancet. 2020;12:680-90.')).toEqual({
        start: 680,
        end: 690,
        label: '680-690'
      })
    })

    it('parses single cited pages', () => {
      expect(parseCitationPageRange('Lee R et al. JAMA. 2023;9:681.')).toEqual({
        start: 681,
        end: 681,
        label: '681'
      })
    })
  })

  describe('resolveCitationPdfPage', () => {
    it('maps a cited printed page number to the matching PDF page', () => {
      const contentText = [
        'Cover page\nAbstract\n',
        'Journal of Testing\n680\nStudy body starts here.\n',
        'Journal of Testing\n681\nMore study body.\n'
      ].join('\n\n')

      const boundaries = [
        { page: 1, startChar: 0, endChar: 20 },
        { page: 2, startChar: 22, endChar: 70 },
        { page: 3, startChar: 72, endChar: contentText.length }
      ]

      expect(resolveCitationPdfPage({
        citationText: '1. Smith J et al. Neurology. 2024;15(11):680-690.',
        contentText,
        pageBoundaries: boundaries
      })).toMatchObject({
        pdfPage: 2,
        citationPageStart: 680,
        citationPageEnd: 690,
        citationPageLabel: '680-690'
      })
    })

    it('prefers edge/header matches over body mentions of the same number', () => {
      const page1 = 'Results\nWe enrolled 680 patients across the study.\nDiscussion\n'
      const page2 = 'Neurology\n680\nMain article text continues.\n'
      const contentText = `${page1}\n\n${page2}`
      const boundaries = [
        { page: 1, startChar: 0, endChar: page1.length },
        { page: 2, startChar: page1.length + 2, endChar: contentText.length }
      ]

      expect(resolveCitationPdfPage({
        citationText: 'Doe et al. 2024;8:680-684.',
        contentText,
        pageBoundaries: boundaries
      })?.pdfPage).toBe(2)
    })

    it('returns a parsed citation hint even when no PDF page can be mapped', () => {
      const result = resolveCitationPdfPage({
        citationText: 'Doe et al. 2024;8:680-684.',
        contentText: 'No printed page numbers here.',
        pageBoundaries: [{ page: 1, startChar: 0, endChar: 29 }]
      })

      expect(result).toMatchObject({
        citationPageStart: 680,
        citationPageEnd: 684,
        citationPageLabel: '680-684',
        pdfPage: null
      })
    })
  })

  describe('charOffsetToPage', () => {
    it('maps character offsets back to the correct PDF page', () => {
      const pageBoundaries = [
        { page: 1, startChar: 0, endChar: 99 },
        { page: 2, startChar: 100, endChar: 199 }
      ]

      expect(charOffsetToPage(120, pageBoundaries)).toBe(2)
    })
  })
})
