import { describe, expect, it } from 'vitest'
import { collectFullStatement } from '../../src/utils/statementAssembly.js'

describe('statementAssembly', () => {
  it('rebuilds a split bullet when the citation lands on the final line fragment', () => {
    const lines = [
      { text: '• MARIPOSA was a phase 3, randomized, open-label study', y: 47.9, x: 13.2, refs: [] },
      { text: 'combination with LAZCLUZE compared with osimertinib in patients with treatment', y: 48.7, x: 27.6, refs: [] },
      { text: '- naive, locally advanced or mNSCLC with EGFR exon 19 deletions or L858R', y: 48.9, x: 51.3, refs: [] },
      { text: 'substitution mutations', y: 49.9, x: 15.6, refs: [1, 2] },
      { text: '– This is the largest phase 3 study in patients with EGFR + disease as of April 2025', y: 50.8, x: 16.4, refs: [2, 13] }
    ]

    expect(collectFullStatement(lines, 3)).toMatchObject({
      startY: 47.9,
      startX: 13.2
    })
    expect(collectFullStatement(lines, 3).text).toBe(
      '• MARIPOSA was a phase 3, randomized, open-label study combination with LAZCLUZE compared with osimertinib in patients with treatment - naive, locally advanced or mNSCLC with EGFR exon 19 deletions or L858R substitution mutations'
    )
  })

  it('collects previous wrapped rows but stops before the next bullet', () => {
    const lines = [
      { text: '• RYBREVANT + LAZCLUZE demonstrated a', y: 50.3, x: 13.2, refs: [] },
      { text: 'statistically significant reduction in risk of progression or death by 30% vs', y: 52.2, x: 15.6, refs: [] },
      { text: 'osimertinib (hazard ratio [HR]', y: 54.2, x: 15.6, refs: [] },
      { text: ': 0.70 [95% confidence interval (CI)', y: 54.2, x: 43.0, refs: [] },
      { text: ': 0.58,', y: 54.2, x: 76.0, refs: [] },
      { text: '0.85; P =0.0002])', y: 56.1, x: 15.6, refs: [1, 2] },
      { text: '– There was a 7.1-month improvement in median progression-free survival', y: 58.1, x: 16.4, refs: [] }
    ]

    expect(collectFullStatement(lines, 5).text).toBe(
      '• RYBREVANT + LAZCLUZE demonstrated a statistically significant reduction in risk of progression or death by 30% vs osimertinib (hazard ratio [HR] : 0.70 [95% confidence interval (CI) : 0.58, 0.85; P =0.0002])'
    )
  })

  it('includes forward continuation rows for the same statement', () => {
    const lines = [
      { text: '– Serial brain magnetic resonance imaging (MRI) was conducted for all patients to assess intracranial response and duration', y: 61.7, x: 16.4, refs: [2] },
      { text: 'Brain MRI was performed at baseline and either every 8 weeks for the first 30 months and every 12 weeks thereafter for patients', y: 62.7, x: 19.6, refs: [] },
      { text: 'with a history of brain metastases or every 24 weeks for patients without a history', y: 63.7, x: 22.0, refs: [] },
      { text: '• Crossover from the osimertinib arm was not permitted', y: 64.7, x: 13.2, refs: [] }
    ]

    expect(collectFullStatement(lines, 0).text).toBe(
      '– Serial brain magnetic resonance imaging (MRI) was conducted for all patients to assess intracranial response and duration Brain MRI was performed at baseline and either every 8 weeks for the first 30 months and every 12 weeks thereafter for patients with a history of brain metastases or every 24 weeks for patients without a history'
    )
  })

  it('trims embedded next-bullet content from the target row', () => {
    const lines = [
      { text: '– LAZCLUZE monotherapy was included to assess the contribution of the components. This trial arm was nonregistrational and is therefore not included in', y: 56.8, x: 16.4, refs: [] },
      { text: 'most of the analyses in this presentation – The primary endpoint was progression-free survival', y: 57.8, x: 18.8, refs: [2] },
      { text: 'response (DOR), and safety o PFS, ORR, and DOR were evaluated by blinded independent central review', y: 59.8, x: 18.8, refs: [1, 2] }
    ]

    expect(collectFullStatement(lines, 1).text).toBe(
      '– LAZCLUZE monotherapy was included to assess the contribution of the components. This trial arm was nonregistrational and is therefore not included in most of the analyses in this presentation'
    )
    expect(collectFullStatement(lines, 2).text).toBe('response (DOR), and safety')
  })

  it('does not trim acronym text that contains an internal dash', () => {
    const lines = [
      { text: 'GBS - DS GRADES', y: 22.5, x: 43.3, refs: [1] }
    ]

    expect(collectFullStatement(lines, 0).text).toBe('GBS - DS GRADES')
  })

  it('does not expand a short heading into surrounding slide labels', () => {
    const lines = [
      { text: 'GBS - DS GRADES', y: 22.5, x: 43.3, refs: [1] },
      { text: 'A healthy state Minor symptoms Able to walk 10 m', y: 24.7, x: 16.0, refs: [] }
    ]

    expect(collectFullStatement(lines, 0).text).toBe('GBS - DS GRADES')
  })

  it('stops before embedded footnote rows in slide content', () => {
    const lines = [
      { text: 'Lower muscle strength, as evaluated by the MRC sum score, correlates with higher GBS', y: 41.9, x: 18.0, refs: [1, 2] },
      { text: '- DS grade.', y: 41.9, x: 74.0, refs: [] },
      { text: 'GBS - DS, GBS disability score; MRC, Medical Research Council. 1. van Koningsveld R et al. Lancet Neurol. 2007;6(7):589-594. 2. Kleyweg RP et al. Muscle Nerve. 1991;14(11):1103-1109.', y: 44.0, x: 14.2, refs: [] }
    ]

    expect(collectFullStatement(lines, 0).text).toBe(
      'Lower muscle strength, as evaluated by the MRC sum score, correlates with higher GBS - DS grade.'
    )
  })

  it('does not absorb a separate slide panel when the next row is in a distant column', () => {
    const lines = [
      { text: 'Most common cause of acute flaccid paralysis', y: 22.9, x: 32.3, refs: [] },
      { text: 'worldwide — sporadic and unpredictable', y: 24.1, x: 31.3, refs: [1, 2] },
      { text: 'INCIDENCE IN US', y: 25.3, x: 63.4, refs: [] },
      { text: '≈7,000', y: 27.0, x: 63.4, refs: [] }
    ]

    expect(collectFullStatement(lines, 1).text).toBe(
      'Most common cause of acute flaccid paralysis worldwide — sporadic and unpredictable'
    )
  })

  it('keeps a right-side callout separate from a nearby left-side sentence band', () => {
    const lines = [
      { text: 'WORLDWIDE', y: 35.0, x: 69.5, maxX: 69.5, refs: [] },
      { text: '≈150,000', y: 37.0, x: 68.4, maxX: 68.4, refs: [] },
      { text: 'GBS is a post - infectious autoimmune peripheral nerve disease', y: 37.3, x: 22.7, maxX: 31.5, refs: [] },
      { text: 'cases per year', y: 38.6, x: 68.5, maxX: 68.5, refs: [1, 6] },
      { text: 'Infections include Campylobacter enteritis and respiratory', y: 38.8, x: 22.7, maxX: 44.5, refs: [] }
    ]

    expect(collectFullStatement(lines, 3).text).toBe('WORLDWIDE ≈150,000 cases per year')
  })

  it('does not prepend a right-side risk callout onto a left-column infections statement', () => {
    const lines = [
      { text: 'GBS is a post - infectious autoimmune peripheral nerve disease', y: 37.3, x: 22.7, maxX: 31.5, refs: [] },
      { text: 'Infections include Campylobacter enteritis and respiratory', y: 38.8, x: 22.7, maxX: 44.5, refs: [] },
      { text: '0.1% lifetime risk', y: 39.9, x: 69.4, maxX: 69.4, refs: [] },
      { text: 'infections', y: 40.2, x: 22.7, maxX: 22.7, refs: [1, 2] }
    ]

    expect(collectFullStatement(lines, 3).text).toBe(
      'GBS is a post - infectious autoimmune peripheral nerve disease Infections include Campylobacter enteritis and respiratory infections'
    )
  })
})
