import { describe, it, expect } from 'vitest'
import { buildTextOnlyAnnotations } from '../../src/utils/textOnlyAnnotations.js'

describe('textOnlyAnnotations', () => {
  it('keeps resolved superscript annotations at their extracted positions', () => {
    const result = buildTextOnlyAnnotations({
      candidates: [
        {
          text: '47% reduction in relapse rate',
          region: 'slide',
          refNumbers: [1],
          page: 1,
          pdfJsX: 22,
          pdfJsY: 18
        }
      ],
      slideFootnotes: {
        1: {
          1: 'Smith et al. Neurology. 2024;12:10-18.'
        }
      },
      notesReferences: {}
    })

    expect(result.annotations).toHaveLength(1)
    expect(result.annotations[0].globalSpot).toBe(false)
    expect(result.annotations[0].position).toEqual({ x: 22, y: 18 })
    expect(result.annotations[0].statement).toBe('47% reduction in relapse rate')
    expect(result.annotations[0].superscripts).toEqual([1])
    expect(result.annotations[0].annotationBinding).toEqual({
      statement: '47% reduction in relapse rate',
      superscripts: [1],
      references: [{
        number: 1,
        text: 'Smith et al. Neurology. 2024;12:10-18.',
        missing: false
      }],
      region: 'slide',
      page: 1,
      position: { x: 22, y: 18 },
      globalSpot: false,
      globalReason: null
    })
    expect(result.annotationBindings).toHaveLength(1)
    expect(result.annotationBindings[0]).toEqual(result.annotations[0].annotationBinding)
    expect(result.annotations[0].references[0]).toMatchObject({
      number: 1,
      text: 'Smith et al. Neurology. 2024;12:10-18.',
      missing: false
    })
  })

  it('promotes missing page references to global annotations for the statement', () => {
    const result = buildTextOnlyAnnotations({
      candidates: [
        {
          text: 'Durable response maintained',
          region: 'notes',
          refNumbers: [3],
          page: 2,
          pdfJsX: 16,
          pdfJsY: 71
        }
      ],
      slideFootnotes: {},
      notesReferences: {
        2: {
          1: 'Brown et al. JAMA. 2023;9:1-8.'
        }
      }
    })

    expect(result.globalAnnotationCount).toBe(2)
    expect(result.annotations[0]).toMatchObject({
      text: 'Durable response maintained',
      statement: 'Durable response maintained',
      superscripts: [3],
      globalSpot: false,
      globalReason: 'missing-page-reference',
      contentType: 'sub-bullet',
      position: { x: 16, y: 71 }
    })
    expect(result.annotations[0].references[0]).toMatchObject({
      number: 3,
      text: '',
      missing: true
    })
  })

  it('groups orphan page references by author into global annotations', () => {
    const result = buildTextOnlyAnnotations({
      candidates: [],
      slideFootnotes: {
        1: {
          1: 'Smith J et al. Neurology. 2024;12:10-18.',
          2: 'Smith J et al. Lancet. 2022;4:90-99.',
          3: 'Brown T et al. JAMA. 2023;9:1-8.'
        }
      },
      notesReferences: {}
    })

    expect(result.annotations).toHaveLength(2)
    expect(result.globalAnnotationCount).toBe(2)
    expect(result.annotations[0]).toMatchObject({
      text: 'Global slide annotation',
      statement: 'Global slide annotation',
      globalSpot: true,
      globalReason: 'orphan-page-reference',
      position: { x: 94, y: 10 }
    })
    expect(result.annotations[0].refNumbers).toEqual([1, 2])
    expect(result.annotations[0].superscripts).toEqual([1, 2])
    expect(result.annotations[1].refNumbers).toEqual([3])
  })

  it('does not merge non-citation globals just because they share the same first word', () => {
    const result = buildTextOnlyAnnotations({
      candidates: [],
      slideFootnotes: {
        1: {
          u1: 'Results shown for the pooled safety population.',
          u2: 'Results reflect the subgroup with prior therapy.'
        }
      },
      notesReferences: {}
    })

    expect(result.annotations).toHaveLength(2)
    expect(result.annotations[0].refNumbers).toEqual(['u1'])
    expect(result.annotations[1].refNumbers).toEqual(['u2'])
  })

  it('absorbs large orphan ref intervals into a bracketed statement instead of emitting fragmented globals', () => {
    const result = buildTextOnlyAnnotations({
      candidates: [
        {
          text: 'Largest phase 3 study in patients with EGFR+ disease',
          region: 'slide',
          refNumbers: [1, 13],
          page: 29,
          pdfJsX: 12,
          pdfJsY: 18
        },
        {
          text: 'Serial brain MRI was conducted for all patients',
          region: 'slide',
          refNumbers: [2],
          page: 29,
          pdfJsX: 12,
          pdfJsY: 24
        }
      ],
      slideFootnotes: {
        29: {
          1: 'Prescribing information.',
          2: 'Cho et al. N Engl J Med. 2024;391(16):1486-1498.',
          3: 'Yang et al. Lancet Oncol. 2015;16(2):141-151.',
          4: 'Wu et al. Lancet Oncol. 2017;18(11):1454-1466.',
          5: 'Rosell et al. Lancet Oncol. 2012;13(3):239-246.',
          6: 'Nakagawa et al. Lancet Oncol. 2019;20(12):1655-1669.',
          7: 'Kawashima et al. Lancet Respir Med. 2022;10(1):72-82.',
          8: 'Douillard et al. Br J Cancer. 2014;110(1):55-62.',
          9: 'Mok et al. N Engl J Med. 2009;361(10):947-957.',
          10: 'Soria et al. N Engl J Med. 2018;378(2):113-125.',
          11: 'Planchard et al. N Engl J Med. 2023;389(21):1935-1948.',
          12: 'Mok et al. N Engl J Med. 2017;376(7):629-640.',
          13: 'Goldberg et al. J Thorac Oncol. 2025;20(suppl 1):S86-S87.'
        }
      },
      notesReferences: {}
    })

    expect(result.annotations).toHaveLength(2)
    expect(result.annotations[0].refNumbers).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(result.globalAnnotationCount).toBe(0)
  })
})
