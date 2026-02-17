import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePageFromBoundaries, estimatePage } from '../src/services/passageEmbedder.js'
import { sanitizeFactPage } from '../src/services/factExtractor.js'

describe('resolvePageFromBoundaries', () => {
  const boundaries = [
    { page: 1, startChar: 2, endChar: 5000 },
    { page: 2, startChar: 5002, endChar: 12000 },
    { page: 3, startChar: 12002, endChar: 18000 }
  ]

  it('returns page 1 for offset within first page', () => {
    assert.equal(resolvePageFromBoundaries(100, boundaries), 1)
  })

  it('returns page 2 for offset at start of second page', () => {
    assert.equal(resolvePageFromBoundaries(5002, boundaries), 2)
  })

  it('returns page 3 for offset in last page', () => {
    assert.equal(resolvePageFromBoundaries(15000, boundaries), 3)
  })

  it('returns last page for offset beyond all boundaries', () => {
    assert.equal(resolvePageFromBoundaries(99999, boundaries), 3)
  })

  it('returns first page for offset before first boundary (underflow)', () => {
    assert.equal(resolvePageFromBoundaries(0, boundaries), 1)
  })

  it('returns preceding page for offset in separator gap (endChar)', () => {
    // 5000 is the endChar of page 1, before startChar of page 2 (5002)
    assert.equal(resolvePageFromBoundaries(5000, boundaries), 1)
  })

  it('returns preceding page for offset in separator gap (endChar + 1)', () => {
    // 5001 is between page 1 endChar (5000) and page 2 startChar (5002)
    assert.equal(resolvePageFromBoundaries(5001, boundaries), 1)
  })

  it('returns preceding page for gap between page 2 and page 3', () => {
    assert.equal(resolvePageFromBoundaries(12000, boundaries), 2)
    assert.equal(resolvePageFromBoundaries(12001, boundaries), 2)
  })

  it('returns null for empty boundaries', () => {
    assert.equal(resolvePageFromBoundaries(100, []), null)
  })

  it('returns null for null boundaries', () => {
    assert.equal(resolvePageFromBoundaries(100, null), null)
  })
})

describe('sanitizeFactPage', () => {
  it('preserves valid page within range', () => {
    assert.equal(sanitizeFactPage(3, 14), 3)
  })

  it('clamps page exceeding max', () => {
    assert.equal(sanitizeFactPage(22, 14), 14)
  })

  it('clamps page below 1 to 1', () => {
    assert.equal(sanitizeFactPage(0, 14), 1)
    assert.equal(sanitizeFactPage(-5, 14), 1)
  })

  it('preserves null input as null', () => {
    assert.equal(sanitizeFactPage(null, 14), null)
  })

  it('preserves undefined input as null', () => {
    assert.equal(sanitizeFactPage(undefined, 14), null)
  })

  it('converts string numbers', () => {
    assert.equal(sanitizeFactPage('5', 14), 5)
  })

  it('returns null for non-numeric strings', () => {
    assert.equal(sanitizeFactPage('abc', 14), null)
  })

  it('preserves page when pageCount is null', () => {
    assert.equal(sanitizeFactPage(5, null), 5)
  })

  it('rounds float pages', () => {
    assert.equal(sanitizeFactPage(3.7, 14), 4)
  })
})

describe('estimatePage fallback', () => {
  it('uses custom charsPerPage', () => {
    assert.equal(estimatePage(10000, 5000), 3)
  })

  it('defaults to 3000 chars/page', () => {
    assert.equal(estimatePage(6000), 3)
  })
})
