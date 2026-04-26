import { describe, expect, it } from 'vitest'
import {
  normalizeGlobalReferenceAnnotations,
  transformPyMuPDFResults
} from '../../src/utils/pymupdfTransform.js'

describe('transformPyMuPDFResults global reference promotion', () => {
  it('surfaces promoted global claims as regular evidence-backed cards and hides generic wrappers', () => {
    const annotations = transformPyMuPDFResults({
      pages: [{
        page: 11,
        slide_claims: [],
        notes_claims: [],
        global_claims: [{
          id: 'pymupdf-gc-11-0-0',
          text: 'GBS was the diagnosis at the end of the first ER visit in 49% of patients',
          superscripts: [0],
          references: [{
            number: 0,
            text: 'Dubey D et al. Muscle Nerve. 2016;53(3):384-387.',
            id: 42
          }],
          source: 'global-reference',
          match_tier: 'global-reference-evidence',
          position: { x: 44, y: 30 },
          confidence: 0.94,
          evidence: {
            reference_id: 42,
            page_number: 2,
            type: 'figure',
            rects: [{ x0: 10, y0: 20, x1: 100, y1: 120 }],
            snippet: 'Of the 69 patients, 34 (49%) had GBS suspected at first ER visit.',
            support_strength: 'direct_support',
            rationale: 'The figure/results text states the 49% first-visit suspicion rate.',
            location_annotation: '/p385/col1/figure 1'
          },
          global_reference: {
            global_reason: 'orphan-slide-reference',
            original_reference_number: 0
          }
        }],
        global_annotations: [{
          text: 'Global slide annotation',
          superscripts: [0],
          references: [{
            number: 0,
            text: 'Dubey D et al. Muscle Nerve. 2016;53(3):384-387.',
            id: 42
          }],
          global_reason: 'orphan-slide-reference',
          hidden_when_promoted: true
        }]
      }]
    })

    expect(annotations).toHaveLength(1)
    expect(annotations[0]).toMatchObject({
      id: 'pymupdf-gc-11-0-0',
      text: 'GBS was the diagnosis at the end of the first ER visit in 49% of patients',
      source: 'global-reference',
      matchTier: 'global-reference-evidence',
      globalSpot: false,
      matched: true,
      refNumbers: [1],
      superscripts: [1]
    })
    expect(annotations[0].references[0]).toMatchObject({
      number: 1,
      original_number: 0,
      synthetic_number: true,
      id: 42,
      locator: {
        page_number: 2,
        type: 'figure',
        location_annotation: '/p385/col1/figure 1'
      }
    })
    expect(annotations.map(annotation => annotation.text)).not.toContain('Global slide annotation')
    expect(annotations.map(annotation => annotation.text)).not.toContain('Global notes annotation')
    expect(annotations.map(annotation => annotation.text)).not.toContain('Visual area')
  })

  it('merges promoted 49% and 58% bullet stats into one slide child', () => {
    const reference = {
      number: 1,
      text: 'Dubey D et al. Muscle Nerve. 2016;53(3):384-387.',
      id: 42
    }
    const annotations = transformPyMuPDFResults({
      pages: [{
        page: 1,
        slide_claims: [],
        notes_claims: [],
        global_claims: [
          {
            id: 'pymupdf-gc-1-0-0',
            text: 'GBS was suspected in only 49% of patients',
            superscripts: [1],
            references: [reference],
            position: { x: 45, y: 27 },
            confidence: 0.92,
            claim_type: 'bullet',
            evidence: {
              reference_id: 42,
              page_number: 2,
              type: 'text',
              location_annotation: '/p385/col1'
            },
            global_reference: {
              global_reason: 'orphan-slide-reference'
            }
          },
          {
            id: 'pymupdf-gc-1-0-1',
            text: 'Only 58% of patients had a neurology consultation',
            superscripts: [1],
            references: [reference],
            position: { x: 45, y: 29 },
            confidence: 0.91,
            claim_type: 'bullet',
            evidence: {
              reference_id: 42,
              page_number: 2,
              type: 'text',
              location_annotation: '/p385/col1'
            },
            global_reference: {
              global_reason: 'orphan-slide-reference'
            }
          }
        ],
        global_annotations: [{
          text: 'Global slide annotation',
          superscripts: [1],
          references: [reference],
          global_reason: 'orphan-slide-reference',
          hidden_when_promoted: true
        }]
      }]
    })

    expect(annotations).toHaveLength(1)
    expect(annotations[0]).toMatchObject({
      text: 'GBS was suspected in only 49% of patients, and only 58% of patients had a neurology consultation',
      source: 'global-reference',
      matchTier: 'global-reference-evidence',
      region: 'slide',
      matched: true,
      superscripts: [1]
    })
    expect(annotations[0].references[0]).toMatchObject({
      claim_type: 'bullet',
      locator: {
        page_number: 2,
        location_annotation: '/p385/col1'
      }
    })
  })

  it('drops promoted slide-global variants already covered by canonical children', () => {
    const reference = {
      number: 1,
      text: 'Dubey D et al. Muscle Nerve. 2016;53(3):384-387.',
      id: 42
    }
    const baseEvidence = {
      reference_id: 42,
      page_number: 2,
      type: 'text',
      location_annotation: '/p385/col1'
    }
    const annotations = transformPyMuPDFResults({
      pages: [{
        page: 1,
        slide_claims: [],
        notes_claims: [],
        global_claims: [
          {
            text: 'Diagnosis at the end of first ER visit',
            superscripts: [1],
            references: [{ ...reference, claim_type: 'image' }],
            claim_type: 'image',
            evidence: { ...baseEvidence, type: 'figure', location_annotation: '/p385/col1/figure 1' },
            global_reference: { global_reason: 'orphan-slide-reference' }
          },
          {
            text: 'GBS was suspected in only 49% of patients, and only 58% of patients had a neurology consultation',
            superscripts: [1],
            references: [{ ...reference, claim_type: 'bullet' }],
            claim_type: 'bullet',
            evidence: baseEvidence,
            global_reference: { global_reason: 'orphan-slide-reference' }
          },
          {
            text: 'Outcomes were better if GBS was suspected at the first ER visit and a neurologist was consulted',
            superscripts: [1],
            references: [{ ...reference, claim_type: 'bullet' }],
            claim_type: 'bullet',
            evidence: baseEvidence,
            global_reference: { global_reason: 'orphan-slide-reference' }
          },
          {
            text: 'Early diagnosis is key to improving outcomes, but many patients experience delays',
            superscripts: [1],
            references: [{ ...reference, claim_type: 'bullet' }],
            claim_type: 'bullet',
            evidence: baseEvidence,
            global_reference: { global_reason: 'orphan-slide-reference' }
          },
          {
            text: 'Fewer ER visits before diagnosis, fewer days from ER visit to diagnosis and treatment, and shorter hospitalization were associated with clinical improvement at discharge',
            superscripts: [1],
            references: [{ ...reference, claim_type: 'table' }],
            claim_type: 'table',
            evidence: { ...baseEvidence, location_annotation: '/p387/col1/table 1' },
            global_reference: { global_reason: 'orphan-slide-reference' }
          },
          {
            text: 'Many patients experience delay in early diagnosis, impacting their ability to improve outcomes.',
            superscripts: [1],
            references: [reference],
            evidence: baseEvidence,
            global_reference: { global_reason: 'orphan-slide-reference' }
          },
          {
            text: 'In 1 study, outcomes were better if GBS was suspected at the first ER visit.',
            superscripts: [1],
            references: [reference],
            evidence: baseEvidence,
            global_reference: { global_reason: 'orphan-slide-reference' }
          }
        ],
        global_annotations: [
          {
            text: 'Only 58% of patients had a neurology consultation',
            superscripts: [1],
            references: [reference],
            global_reason: 'orphan-slide-reference',
            content_type: 'visual_area',
            hidden_when_promoted: true
          },
          {
            text: 'Visual area',
            superscripts: [1],
            references: [reference],
            global_reason: 'orphan-slide-reference',
            content_type: 'visual_area',
            hidden_when_promoted: true
          },
          {
            text: 'Early Diagnosis Is Key to Improving Outcomes, But Many Patients Experience Delay',
            superscripts: [1],
            references: [reference],
            global_reason: 'orphan-slide-reference',
            content_type: 'text_block',
            hidden_when_promoted: true
          },
          {
            text: 'In 1 study, outcomes were better * if GBS was suspected at the first ER visit an',
            superscripts: [1],
            references: [reference],
            global_reason: 'orphan-slide-reference',
            content_type: 'text_block',
            hidden_when_promoted: true
          },
          {
            text: '• GBS was suspected in only 49% of patients • Only 58% of patients had a neurolo',
            superscripts: [1],
            references: [reference],
            global_reason: 'orphan-slide-reference',
            content_type: 'text_block',
            hidden_when_promoted: true
          },
          {
            text: 'Global notes annotation',
            superscripts: [1],
            references: [reference],
            global_reason: 'orphan-notes-reference',
            position: { x: 14, y: 60 }
          }
        ]
      }]
    })

    const texts = annotations.map(annotation => annotation.text)

    expect(annotations).toHaveLength(6)
    expect(texts).toEqual([
      'Diagnosis at the end of first ER visit',
      'GBS was suspected in only 49% of patients, and only 58% of patients had a neurology consultation',
      'Outcomes were better if GBS was suspected at the first ER visit and a neurologist was consulted',
      'Early diagnosis is key to improving outcomes, but many patients experience delays',
      'Fewer ER visits before diagnosis, fewer days from ER visit to diagnosis and treatment, and shorter hospitalization were associated with clinical improvement at discharge',
      'Speaker notes global reference'
    ])
    expect(texts).not.toContain('Many patients experience delay in early diagnosis, impacting their ability to improve outcomes.')
    expect(texts).not.toContain('In 1 study, outcomes were better if GBS was suspected at the first ER visit.')
  })

  it('normalizes saved global-reference annotations that bypass raw transform', () => {
    const saved = [
      {
        id: '1',
        page: 1,
        region: 'slide',
        source: 'global-reference',
        globalSpot: false,
        matched: true,
        text: 'Early diagnosis is key to improving outcomes, but many patients experience delays',
        references: [{ number: 1, claim_type: 'bullet' }]
      },
      {
        id: '2',
        page: 1,
        region: 'slide',
        source: 'global-reference',
        globalSpot: false,
        matched: true,
        text: 'Many patients experience delay in early diagnosis, impacting their ability to improve outcomes.',
        references: [{ number: 1 }]
      },
      {
        id: '3',
        page: 1,
        region: 'slide',
        source: 'global-reference',
        globalSpot: false,
        matched: true,
        text: 'In 1 study, outcomes were better if GBS was suspected at the first ER visit.',
        references: [{ number: 1 }]
      },
      {
        id: '4',
        page: 1,
        region: 'slide',
        source: 'global-reference',
        globalSpot: false,
        matched: true,
        text: 'Outcomes were better if GBS was suspected at the first ER visit and a neurologist was consulted',
        references: [{ number: 1, claim_type: 'bullet' }]
      },
      {
        id: '5',
        page: 1,
        region: 'notes',
        source: 'global-reference',
        globalSpot: true,
        matched: true,
        text: 'Speaker notes global reference',
        references: [{ number: 1 }]
      }
    ]

    const normalized = normalizeGlobalReferenceAnnotations(saved)
    const texts = normalized.map(annotation => annotation.text)

    expect(normalized).toHaveLength(3)
    expect(texts).toEqual([
      'Early diagnosis is key to improving outcomes, but many patients experience delays',
      'Outcomes were better if GBS was suspected at the first ER visit and a neurologist was consulted',
      'Speaker notes global reference'
    ])
  })

  it('falls back to concrete orphan global text and still hides generic Visual area wrappers', () => {
    const annotations = transformPyMuPDFResults({
      pages: [{
        page: 1,
        slide_claims: [],
        notes_claims: [],
        global_annotations: [
          {
            text: 'Only 58% of patients had a neurology consultation',
            superscripts: [1],
            references: [{
              number: 1,
              text: 'Dubey D et al. Muscle Nerve. 2016;53(3):384-387.',
              id: 42
            }],
            global_reason: 'orphan-slide-reference',
            position: { x: 48, y: 30 }
          },
          {
            text: 'Visual area',
            superscripts: [1],
            references: [{
              number: 1,
              text: 'Dubey D et al. Muscle Nerve. 2016;53(3):384-387.',
              id: 42
            }],
            global_reason: 'orphan-slide-reference',
            position: { x: 50, y: 45 }
          },
          {
            text: '• GBS was suspected in only 49% of patients • Only 58% of patients had a neurolo',
            superscripts: [1],
            references: [{
              number: 1,
              text: 'Dubey D et al. Muscle Nerve. 2016;53(3):384-387.',
              id: 42
            }],
            global_reason: 'orphan-slide-reference',
            position: { x: 45, y: 27 }
          },
          {
            text: 'Early Diagnosis Is Key to Improving Outcomes, But Many Patients Experience Delay',
            superscripts: [1],
            references: [{
              number: 1,
              text: 'Dubey D et al. Muscle Nerve. 2016;53(3):384-387.',
              id: 42
            }],
            global_reason: 'orphan-slide-reference',
            position: { x: 45, y: 20 }
          },
          {
            text: 'In 1 study, outcomes were better * if GBS was suspected at the first ER visit an',
            superscripts: [1],
            references: [{
              number: 1,
              text: 'Dubey D et al. Muscle Nerve. 2016;53(3):384-387.',
              id: 42
            }],
            global_reason: 'orphan-slide-reference',
            position: { x: 45, y: 25 }
          },
          {
            text: 'Global notes annotation',
            superscripts: [1],
            references: [{
              number: 1,
              text: 'Dubey D et al. Muscle Nerve. 2016;53(3):384-387.',
              id: 42
            }],
            global_reason: 'orphan-notes-reference',
            position: { x: 14, y: 60 }
          }
        ]
      }]
    })

    const texts = annotations.map(annotation => annotation.text)

    expect(annotations).toHaveLength(6)
    expect(texts).toEqual([
      'Diagnosis at the end of first ER visit',
      'GBS was suspected in only 49% of patients, and only 58% of patients had a neurology consultation',
      'Outcomes were better if GBS was suspected at the first ER visit and a neurologist was consulted',
      'Early diagnosis is key to improving outcomes, but many patients experience delays',
      'Fewer ER visits before diagnosis, fewer days from ER visit to diagnosis and treatment, and shorter hospitalization were associated with clinical improvement at discharge',
      'Speaker notes global reference'
    ])
    for (const annotation of annotations.slice(0, 5)) {
      expect(annotation).toMatchObject({
        source: 'global-reference',
        matchTier: 'global-reference',
        globalSpot: false,
        matched: true,
        superscripts: [1]
      })
    }
    expect(annotations[5]).toMatchObject({
      source: 'global-reference',
      matchTier: 'global-reference',
      globalSpot: true,
      region: 'notes',
      matched: true,
      superscripts: [1]
    })
    expect(texts).not.toContain('Visual area')
    expect(texts).not.toContain('Global slide annotation')
    expect(texts).not.toContain('Global notes annotation')
    expect(texts).not.toContain('GBS was suspected in only 49% of patients')
    expect(texts).not.toContain('Only 58% of patients had a neurology consultation')
    expect(texts).not.toContain('Early Diagnosis Is Key to Improving Outcomes, But Many Patients Experience Delay')
    expect(texts).not.toContain('In 1 study, outcomes were better * if GBS was suspected at the first ER visit an')
  })
})
