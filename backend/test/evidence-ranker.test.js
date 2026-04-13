import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLlamaPageScores,
  extractClaimTerms,
  scoreTextOverlap,
  selectCandidatesWithLlamaParse
} from '../src/services/evidenceSuggestionRanker.js'

describe('evidenceSuggestionRanker', () => {
  it('extracts claim terms including numeric tokens', () => {
    const terms = extractClaimTerms('Drug X reduced relapse rate by 47% (p<0.001, N=1200)')
    assert.ok(terms.tokens.includes('drug'))
    assert.ok(terms.tokens.includes('relapse'))
    assert.ok(terms.numeric.includes('47%'))
    assert.ok(terms.numeric.includes('p<0.001'))
  })

  it('scores overlap higher when numerics and keywords align', () => {
    const terms = extractClaimTerms('Drug X reduced relapse rate by 47% (p<0.001)')
    const goodScore = scoreTextOverlap(terms, 'Drug X reduced relapse rate by 47% versus placebo (p<0.001).')
    const weakScore = scoreTextOverlap(terms, 'Background discussion of adverse events without efficacy data.')
    assert.ok(goodScore > weakScore)
    assert.ok(goodScore > 0.6)
  })

  it('builds page scores from LlamaParse page text', () => {
    const scores = buildLlamaPageScores(
      'Drug X reduced relapse rate by 47% (p<0.001)',
      [
        { page: 1, text: 'Introduction and safety overview.' },
        { page: 2, markdown: 'Drug X reduced relapse rate by 47% versus placebo (p<0.001).' }
      ]
    )

    assert.ok((scores.get(2) || 0) > (scores.get(1) || 0))
  })

  it('selects the strongest PyMuPDF candidates using LlamaParse page context', () => {
    const selected = selectCandidatesWithLlamaParse(
      'Drug X reduced relapse rate by 47% (p<0.001)',
      [
        {
          candidate_id: 'cand_1',
          page_number: 1,
          type: 'text',
          text: 'General safety profile and dosing overview.',
          rects: [{ x0: 1, y0: 1, x1: 10, y1: 10 }],
          pre_score: 0.2
        },
        {
          candidate_id: 'cand_2',
          page_number: 2,
          type: 'structured_box',
          text: 'Drug X reduced relapse rate by 47% versus placebo (p<0.001).',
          rects: [{ x0: 5, y0: 5, x1: 20, y1: 20 }],
          pre_score: 0.5
        }
      ],
      [
        { page: 1, text: 'Safety overview only.' },
        { page: 2, markdown: 'Drug X reduced relapse rate by 47% versus placebo (p<0.001).' }
      ],
      6
    )

    assert.equal(selected[0].candidate_id, 'cand_2')
    assert.equal(selected[0].support_strength, 'direct_support')
  })
})
