# Accurate Page Numbers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix reference passage page numbers so they reflect actual PDF pages instead of estimates.

**Architecture:** Use pdf-parse's `pagerender` hook to capture per-page text during extraction, build a character-offset-to-page boundary map, and pass it through the passage embedding pipeline so each chunk gets a real page number. Clamp fact extraction pages as a safety net.

**Tech Stack:** pdf-parse (existing), Node.js built-in `node:test` for unit tests.

**Design doc:** `docs/plans/2026-02-17-accurate-page-numbers-design.md`

---

### Task 1: Add `extractTextByPage()` to textExtractor.js

**Files:**
- Modify: `backend/src/services/textExtractor.js`

**Step 1: Add `extractTextByPage` function after existing `extractText`**

Add this new exported function at the end of the file (after line 29):

```javascript
/**
 * Extract text from a PDF with per-page boundaries.
 * Uses pdf-parse's pagerender hook to capture each page's text separately.
 * Returns fullText that is byte-for-byte identical to pdf-parse's default output.
 */
export async function extractTextByPage(filePath) {
  try {
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default
    const buffer = fs.readFileSync(filePath)

    const pages = []

    const pagerender = async (pageData) => {
      const textContent = await pageData.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false
      })
      let lastY
      let text = ''
      for (const item of textContent.items) {
        if (lastY === item.transform[5] || !lastY) {
          text += item.str
        } else {
          text += '\n' + item.str
        }
        lastY = item.transform[5]
      }
      pages.push(text)
      return text
    }

    const data = await pdfParse(buffer, { pagerender })
    const pageCount = data.numpages || null

    // pdf-parse output = '\n\n' + pages joined by '\n\n'
    // Use data.text directly to guarantee byte-for-byte parity
    const fullText = data.text || null

    // Build page boundary map from the captured per-page text
    // Account for the leading '\n\n' prefix that pdf-parse adds
    const pageBoundaries = []
    let cursor = 2 // skip leading '\n\n'
    for (let i = 0; i < pages.length; i++) {
      const pageText = pages[i]
      const startChar = cursor
      const endChar = cursor + pageText.length
      pageBoundaries.push({ page: i + 1, startChar, endChar })
      cursor = endChar + 2 // +2 for '\n\n' separator between pages
    }

    return { pages, pageCount, fullText, pageBoundaries }
  } catch (error) {
    console.error(`Page-aware extraction failed for ${filePath}:`, error.message)
    return { pages: [], pageCount: null, fullText: null, pageBoundaries: [] }
  }
}
```

**Step 2: Commit**

```bash
git add backend/src/services/textExtractor.js
git commit -m "feat: add extractTextByPage with per-page boundary tracking"
```

---

### Task 2: Add `resolvePageFromBoundaries()` and update `embedReference()` in passageEmbedder.js

**Files:**
- Modify: `backend/src/services/passageEmbedder.js:84-147`

**Step 1: Add `resolvePageFromBoundaries` after `estimatePage` (after line 90)**

```javascript
/**
 * Resolve actual page number from character offset using page boundaries.
 * Uses binary search for efficiency. Falls back to estimatePage if no boundaries.
 */
export function resolvePageFromBoundaries(charOffset, pageBoundaries) {
  if (!pageBoundaries || pageBoundaries.length === 0) return null

  // Binary search: find the page whose range contains charOffset
  let lo = 0
  let hi = pageBoundaries.length - 1

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const boundary = pageBoundaries[mid]
    if (charOffset < boundary.startChar) {
      hi = mid - 1
    } else if (charOffset >= boundary.endChar) {
      lo = mid + 1
    } else {
      return boundary.page
    }
  }

  // Offset is beyond all boundaries — return last page
  return pageBoundaries[pageBoundaries.length - 1].page
}
```

**Step 2: Update `embedReference` to accept and use pageBoundaries (modify line 120-147)**

Replace the `embedReference` function:

```javascript
/**
 * Chunk and embed a full reference document.
 * Returns array of passage objects ready for ReferencePassage.createPassages().
 *
 * @param {string} contentText - Full document text
 * @param {Object} options
 * @param {Array} options.pageBoundaries - From extractTextByPage(). Provides real page numbers.
 * @param {number} options.pageCount - Total page count. Used for improved estimation when no boundaries.
 */
export async function embedReference(contentText, options = {}) {
  const { chunkSize, overlap } = resolveChunkingOptions(contentText.length, options)
  const chunks = chunkText(contentText, chunkSize, overlap)
  const { pageBoundaries, pageCount } = options

  // Compute improved charsPerPage when boundaries aren't available
  const charsPerPage = (pageCount && pageCount > 0)
    ? Math.round(contentText.length / pageCount)
    : 3000

  const passages = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    const embedding = await embedText(chunk.text, options)

    // Resolve page: real boundaries > improved estimate > default estimate
    const pageEstimate = resolvePageFromBoundaries(chunk.startChar, pageBoundaries)
      ?? estimatePage(chunk.startChar, charsPerPage)

    passages.push({
      passage_index: i,
      passage_text: chunk.text,
      start_char: chunk.startChar,
      end_char: chunk.endChar,
      page_estimate: pageEstimate,
      embedding,
      embedding_model: options.model || EMBEDDING_MODEL
    })

    // Brief delay between API calls to respect rate limits
    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return passages
}
```

**Step 3: Commit**

```bash
git add backend/src/services/passageEmbedder.js
git commit -m "feat: resolve passage pages from real PDF boundaries"
```

---

### Task 3: Add `sanitizeFactPage()` and update `extractFacts()` in factExtractor.js

**Files:**
- Modify: `backend/src/services/factExtractor.js:61-124`

**Step 1: Add `sanitizeFactPage` helper before `extractFacts` (after line 77)**

```javascript
/**
 * Sanitize a fact's page number against the actual document page count.
 * Only clamps finite integers. Preserves null/undefined/non-numeric as null.
 * NEVER fabricates a page number from nothing.
 */
export function sanitizeFactPage(page, pageCount) {
  const parsed = typeof page === 'number' ? page : parseInt(page, 10)
  if (!Number.isFinite(parsed)) return null
  if (!Number.isFinite(pageCount) || pageCount <= 0) return parsed
  return Math.min(Math.max(Math.round(parsed), 1), pageCount)
}
```

**Step 2: Update `extractFacts` signature and add clamping (modify lines 79-124)**

Change the function signature and add clamping after deduplication:

```javascript
export async function extractFacts(contentText, options = {}) {
  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY not set in environment')
  }

  const ai = new GoogleGenAI({ apiKey })
  const model = options.model || 'gemini-2.0-flash'
  const { pageCount } = options

  const chunks = chunkText(contentText)
  const allFacts = []

  for (let i = 0; i < chunks.length; i++) {
    const chunkLabel = chunks.length > 1
      ? `\n\n[Document chunk ${i + 1} of ${chunks.length}]`
      : ''

    const response = await ai.models.generateContent({
      model,
      contents: `${EXTRACTION_PROMPT}${chunkLabel}\n\n---\n\n${chunks[i]}`,
      config: {
        temperature: 0,
        topP: 0.1,
        topK: 1
      }
    })

    const text = response.text.trim()

    // Strip markdown code fences if present
    const jsonStr = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

    try {
      const facts = JSON.parse(jsonStr)
      if (Array.isArray(facts)) {
        allFacts.push(...facts)
      }
    } catch (parseErr) {
      console.error(`Failed to parse Gemini response for chunk ${i + 1}:`, parseErr.message)
      console.error('Raw response:', text.slice(0, 500))
    }
  }

  // Deduplicate then clamp pages to valid range
  const deduplicated = deduplicateFacts(allFacts)
  if (pageCount) {
    for (const fact of deduplicated) {
      fact.page = sanitizeFactPage(fact.page, pageCount)
    }
  }
  return deduplicated
}
```

**Step 3: Commit**

```bash
git add backend/src/services/factExtractor.js
git commit -m "feat: clamp fact page numbers against real page count"
```

---

### Task 4: Update referenceController.js to use page-aware extraction

**Files:**
- Modify: `backend/src/controllers/referenceController.js:5-63`

**Step 1: Add import for `extractTextByPage`**

Change line 5 from:
```javascript
import { extractText } from '../services/textExtractor.js'
```
to:
```javascript
import { extractText, extractTextByPage } from '../services/textExtractor.js'
```

**Step 2: Update the upload handler (lines 28-63)**

Replace the extraction and auto-index/embed block:

```javascript
      // Extract text — use page-aware extraction for PDFs
      let text, pageCount, pageBoundaries
      if (docType === 'pdf') {
        const result = await extractTextByPage(file.path)
        text = result.fullText
        pageCount = result.pageCount
        pageBoundaries = result.pageBoundaries
      } else {
        const result = await extractText(file.path, docType)
        text = result.text
        pageCount = result.pageCount
        pageBoundaries = null
      }

      const ref = Reference.create({
        brand_id: brandId,
        filename: file.filename,
        display_alias: displayAlias,
        file_path: path.relative(process.cwd(), file.path),
        doc_type: docType,
        content_text: text,
        notes: req.body.notes || '',
        page_count: pageCount,
        file_size_bytes: file.size
      })

      // Auto-index: create pending facts row and kick off async extraction
      if (text && process.env.VITE_GEMINI_API_KEY) {
        ReferenceFact.createPending(ref.id)
        extractFacts(text, { pageCount })
          .then(facts => {
            ReferenceFact.createOrUpdate(ref.id, facts, 'indexed', 'gemini-2.5-flash')
            console.log(`Auto-indexed ref ${ref.id} (${displayAlias}): ${facts.length} facts`)
          })
          .catch(err => {
            console.error(`Auto-index failed for ref ${ref.id}:`, err.message)
            ReferenceFact.updateStatus(ref.id, 'failed', err.message)
          })

        // Auto-embed: create passage embeddings for semantic search
        embedReference(text, { pageBoundaries, pageCount })
          .then(passages => {
            ReferencePassage.createPassages(ref.id, passages)
            console.log(`Auto-embedded ref ${ref.id} (${displayAlias}): ${passages.length} passages`)
          })
          .catch(err => {
            console.error(`Auto-embed failed for ref ${ref.id}:`, err.message)
          })
      }
```

**Step 3: Commit**

```bash
git add backend/src/controllers/referenceController.js
git commit -m "feat: use page-aware extraction on PDF upload"
```

---

### Task 5: Update factController.js to pass pageCount

**Files:**
- Modify: `backend/src/controllers/factController.js:44`

**Step 1: Update the triggerExtraction handler**

Change line 44 from:
```javascript
      extractFacts(ref.content_text)
```
to:
```javascript
      extractFacts(ref.content_text, { pageCount: ref.page_count })
```

Note: `ref` is already fetched from `Reference.findById(refId)` on line 35, which includes `page_count` in its query.

**Step 2: Commit**

```bash
git add backend/src/controllers/factController.js
git commit -m "feat: pass pageCount when re-indexing facts"
```

---

### Task 6: Update index-references.js script to pass pageCount

**Files:**
- Modify: `backend/scripts/index-references.js:65,119`

**Step 1: Add `rd.page_count` to the query (line 65)**

Change:
```javascript
    SELECT rd.id, rd.display_alias, rd.filename, rd.content_text, b.name as brand_name
```
to:
```javascript
    Select rd.id, rd.display_alias, rd.filename, rd.content_text, rd.page_count, b.name as brand_name
```

**Step 2: Pass pageCount to extractWithRetry (line 119)**

Change:
```javascript
        const facts = await extractWithRetry(ref.content_text)
```
to:
```javascript
        const facts = await extractWithRetry(ref.content_text, ref.page_count)
```

**Step 3: Update extractWithRetry to accept and forward pageCount (line 29)**

Change:
```javascript
async function extractWithRetry(contentText, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await extractFacts(contentText)
```
to:
```javascript
async function extractWithRetry(contentText, pageCount, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await extractFacts(contentText, { pageCount })
```

**Step 4: Commit**

```bash
git add backend/scripts/index-references.js
git commit -m "feat: pass pageCount through batch fact indexing"
```

---

### Task 7: Update embed-references.js script to use page boundaries

**Files:**
- Modify: `backend/scripts/embed-references.js:2,78-80,163`

**Step 1: Add import for extractTextByPage (after line 5)**

```javascript
import { extractTextByPage } from '../src/services/textExtractor.js'
import fs from 'fs'
import path from 'path'
```

**Step 2: Update query to fetch doc_type, page_count, file_path (line 78-80)**

Change:
```javascript
    SELECT rd.id, rd.display_alias, rd.content_text, rd.brand_id, b.name as brand_name
```
to:
```javascript
    SELECT rd.id, rd.display_alias, rd.content_text, rd.brand_id, rd.doc_type, rd.page_count, rd.file_path, b.name as brand_name
```

**Step 3: Update the embedding logic inside the limit callback (around line 162-164)**

Change:
```javascript
        const passages = await embedWithRetry(ref.content_text, chunkingOptions)
```
to:
```javascript
        // Get real page boundaries for PDFs
        let embedOptions = { ...chunkingOptions }
        if (ref.doc_type === 'pdf' && ref.file_path) {
          const fullPath = path.resolve(ref.file_path)
          if (fs.existsSync(fullPath)) {
            try {
              const { pageBoundaries, pageCount } = await extractTextByPage(fullPath)
              embedOptions.pageBoundaries = pageBoundaries
              embedOptions.pageCount = pageCount
            } catch (err) {
              console.warn(`  Could not extract page boundaries for ${label}: ${err.message}`)
            }
          } else {
            console.warn(`  File not found for ${label}, using estimated pages`)
          }
        }
        if (!embedOptions.pageBoundaries && ref.page_count) {
          embedOptions.pageCount = ref.page_count
        }

        const passages = await embedWithRetry(ref.content_text, embedOptions)
```

**Step 4: Update `embedWithRetry` to pass full options (line 46-49)**

Change:
```javascript
async function embedWithRetry(contentText, embedOptions, maxRetries = 3) {
```
(This signature is already correct — `embedOptions` is passed through to `embedReference`.)

**Step 5: Commit**

```bash
git add backend/scripts/embed-references.js
git commit -m "feat: pass real page boundaries through batch embedding"
```

---

### Task 8: Write unit tests for pure functions

**Files:**
- Create: `backend/test/page-numbers.test.js`

**Step 1: Create test file using Node's built-in test runner**

```javascript
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
```

**Step 2: Run the tests**

```bash
cd /Users/wallymo/claims_detector/backend && node --test test/page-numbers.test.js
```

Expected: All tests PASS.

**Step 3: Commit**

```bash
git add backend/test/page-numbers.test.js
git commit -m "test: unit tests for page boundary resolution and fact page sanitization"
```

---

### Task 9: Integration test — verify text parity with a real PDF

**Files:**
- Create: `backend/test/text-parity.test.js`

**Step 1: Write parity test**

```javascript
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
```

**Step 2: Run the test**

```bash
cd /Users/wallymo/claims_detector/backend && node --test test/text-parity.test.js
```

Expected: All tests PASS.

**Step 3: Commit**

```bash
git add backend/test/text-parity.test.js
git commit -m "test: verify extractTextByPage text parity with real PDFs"
```

---

### Task 10: End-to-end verification and Codex review

**Step 1: Start both servers and test manually**

```bash
cd /Users/wallymo/claims_detector/backend && npm run dev
# In another terminal:
cd /Users/wallymo/claims_detector/app && npm run dev
```

Upload a known PDF (one of the 54 reference PDFs with a known page count) through the UI. Check that:
- The passage `page_estimate` values don't exceed the PDF's actual page count
- Reference matching results show reasonable page numbers

**Step 2: Verify in database**

```bash
cd /Users/wallymo/claims_detector/backend && node -e "
import { initDb, getDb, closeDb } from './src/config/database.js';
initDb();
const db = getDb();
const bad = db.prepare(\`
  SELECT rp.page_estimate, rd.page_count, rd.display_alias
  FROM reference_passages rp
  JOIN reference_documents rd ON rd.id = rp.reference_id
  WHERE rp.page_estimate > rd.page_count AND rd.page_count IS NOT NULL
\`).all();
console.log('Passages with page > pageCount:', bad.length);
if (bad.length > 0) console.table(bad.slice(0, 10));
closeDb();
"
```

Expected: 0 passages with page exceeding pageCount.

**Step 3: Run Codex peer review**

Invoke `/codex-review` to get independent review of all changes.

**Step 4: Final commit (if all passes)**

```bash
git add -A && git commit -m "feat: accurate page numbers for reference passages

Replace hardcoded 3000 chars/page estimation with real PDF page boundaries.
Uses pdf-parse pagerender hook for per-page text extraction.
Clamps fact pages against actual page count.
Fixes issue where 14-page PDFs showed 'Page 22' on matches."
```
