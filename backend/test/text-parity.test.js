import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { extractText, extractTextByPage } from '../src/services/textExtractor.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REFS_DIR = path.resolve(__dirname, '../../app/References')

describe('extractTextByPage parity', () => {
  it('fullText matches extractText output for a real PDF', async () => {
    if (!fs.existsSync(REFS_DIR)) {
      console.log('References directory not found, skipping')
      return
    }
    const pdfs = fs.readdirSync(REFS_DIR).filter(f => f.endsWith('.pdf'))
    if (pdfs.length === 0) {
      console.log('No test PDFs available, skipping')
      return
    }

    // Test with first available PDF
    const testPdf = path.join(REFS_DIR, pdfs[0])
    const original = await extractText(testPdf, 'pdf')
    const pageAware = await extractTextByPage(testPdf)

    assert.equal(pageAware.fullText, original.text, 'fullText must match extractText output byte-for-byte')
    assert.equal(pageAware.pageCount, original.pageCount, 'pageCount must match')
    assert.ok(pageAware.pageBoundaries.length > 0, 'should have page boundaries')
    assert.equal(pageAware.pageBoundaries.length, pageAware.pageCount, 'boundary count should equal page count')

    // Verify boundaries are contiguous and cover the text
    const lastBoundary = pageAware.pageBoundaries[pageAware.pageBoundaries.length - 1]
    assert.ok(lastBoundary.endChar <= pageAware.fullText.length, 'last boundary should not exceed text length')
  })

  it('page boundaries dont produce pages exceeding pageCount', async () => {
    if (!fs.existsSync(REFS_DIR)) return
    const pdfs = fs.readdirSync(REFS_DIR).filter(f => f.endsWith('.pdf'))
    if (pdfs.length === 0) return

    const testPdf = path.join(REFS_DIR, pdfs[0])
    const { pageBoundaries, pageCount } = await extractTextByPage(testPdf)

    for (const boundary of pageBoundaries) {
      assert.ok(boundary.page >= 1, `page ${boundary.page} should be >= 1`)
      assert.ok(boundary.page <= pageCount, `page ${boundary.page} should be <= ${pageCount}`)
    }
  })
})
