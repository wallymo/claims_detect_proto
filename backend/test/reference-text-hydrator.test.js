import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { hydrateReferenceTextFromFile } from '../src/services/referenceTextHydrator.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REFS_DIR = path.resolve(__dirname, '../../References')

describe('hydrateReferenceTextFromFile', () => {
  it('hydrates page boundaries for a PDF reference missing them', async () => {
    if (!fs.existsSync(REFS_DIR)) {
      console.log('References directory not found, skipping')
      return
    }

    const pdfs = fs.readdirSync(REFS_DIR).filter(file => file.endsWith('.pdf')).sort()
    if (pdfs.length === 0) {
      console.log('No reference PDFs available, skipping')
      return
    }

    const filePath = path.join(REFS_DIR, pdfs[0])
    const hydrated = await hydrateReferenceTextFromFile({
      id: 1,
      filename: pdfs[0],
      display_alias: pdfs[0].replace(/\.[^.]+$/, ''),
      file_path: filePath,
      doc_type: 'pdf',
      content_text: null,
      page_count: null,
      page_boundaries: null,
      citation_metadata: null
    })

    assert.equal(hydrated.didHydrate, true)
    assert.ok(hydrated.content_text && hydrated.content_text.length > 100)
    assert.ok(Array.isArray(hydrated.page_boundaries) && hydrated.page_boundaries.length > 0)
    assert.equal(hydrated.page_boundaries.length, hydrated.page_count)
    assert.ok(hydrated.citation_metadata)
  })

  it('leaves already-hydrated references unchanged', async () => {
    const hydrated = await hydrateReferenceTextFromFile({
      id: 2,
      filename: 'already-hydrated.pdf',
      display_alias: 'Already Hydrated',
      file_path: '/tmp/does-not-matter.pdf',
      doc_type: 'pdf',
      content_text: 'Reference text',
      page_count: 1,
      page_boundaries: [{ page: 1, startChar: 0, endChar: 14 }],
      citation_metadata: { year: '2024' }
    })

    assert.equal(hydrated.didHydrate, false)
    assert.equal(hydrated.content_text, 'Reference text')
    assert.deepEqual(hydrated.page_boundaries, [{ page: 1, startChar: 0, endChar: 14 }])
    assert.deepEqual(hydrated.citation_metadata, { year: '2024' })
  })
})
