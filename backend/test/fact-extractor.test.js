import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildHeuristicFactsFromParsedPages,
  getModelUsedLabel,
  normalizeExtractedFacts,
  resolveReferenceAnalysisProvider
} from '../src/services/factExtractor.js'

describe('resolveReferenceAnalysisProvider', () => {
  it('defaults unknown values to gemini', () => {
    assert.equal(resolveReferenceAnalysisProvider(undefined), 'gemini')
    assert.equal(resolveReferenceAnalysisProvider('unknown'), 'gemini')
  })

  it('accepts llamaparse aliases', () => {
    assert.equal(resolveReferenceAnalysisProvider('llamaparse'), 'llamaparse')
    assert.equal(resolveReferenceAnalysisProvider('llama_parse'), 'llamaparse')
    assert.equal(resolveReferenceAnalysisProvider('llama-parse'), 'llamaparse')
  })
})

describe('getModelUsedLabel', () => {
  it('reports llamaparse as a stable provider label', () => {
    assert.equal(getModelUsedLabel('llamaparse'), 'llamaparse')
  })

  it('preserves explicit gemini model names', () => {
    assert.equal(getModelUsedLabel('gemini', 'gemini-2.5-pro'), 'gemini-2.5-pro')
  })
})

describe('normalizeExtractedFacts', () => {
  it('deduplicates repeated facts and clamps pages', () => {
    const normalized = normalizeExtractedFacts([
      {
        text: 'Drug X reduced annualized relapse rate by 47% versus placebo (p<0.001).',
        category: 'efficacy',
        keywords: ['47%', 'annualized relapse rate', 'placebo'],
        page: 12
      },
      {
        text: 'Drug X reduced annualized relapse rate by 47% versus placebo (p<0.001).',
        category: 'efficacy',
        keywords: ['47%', 'annualized relapse rate', 'placebo'],
        page: 12
      }
    ], 5)

    assert.equal(normalized.length, 1)
    assert.equal(normalized[0].page, 5)
    assert.equal(normalized[0].id, 'fact_001')
  })
})

describe('buildHeuristicFactsFromParsedPages', () => {
  it('creates fact-shaped records with categories, keywords, and pages', () => {
    const facts = buildHeuristicFactsFromParsedPages([
      {
        page: 1,
        markdown: `
## Study Results

Patients receiving Drug X had a 47% reduction in annualized relapse rate versus placebo (p<0.001, N=1200).

Recommended dose: 200 mg once daily.

Drug X is indicated for adults with partial-onset seizures.
        `,
        text: `
Patients receiving Drug X had a 47% reduction in annualized relapse rate versus placebo (p<0.001, N=1200).
Recommended dose: 200 mg once daily.
Drug X is indicated for adults with partial-onset seizures.
        `
      }
    ], { pageCount: 1 })

    assert.ok(facts.length >= 3)
    assert.ok(facts.every(fact => fact.page === 1))
    assert.ok(facts.every(fact => Array.isArray(fact.keywords) && fact.keywords.length >= 3))
    assert.ok(facts.some(fact => fact.category === 'efficacy'))
    assert.ok(facts.some(fact => fact.category === 'dosage'))
    assert.ok(facts.some(fact => fact.category === 'regulatory'))
    assert.ok(facts.some(fact => fact.text.includes('47% reduction')))
  })
})
