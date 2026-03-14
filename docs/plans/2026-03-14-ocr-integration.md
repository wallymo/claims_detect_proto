# OCR Slide Region Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When pdf.js returns no text for the slide region, fall back to PaddleOCR service to extract slide text from a rendered image, then feed results into the existing annotation pipeline.

**Architecture:** New `ocrClient.js` utility renders pdf.js pages to canvas, crops the slide region, POSTs to the standalone OCR service (localhost:8100), and converts the response into the same `{text, y, x, maxX, refs}` line format the pipeline expects. `extractAnnotations.js` calls this when slide lines are empty. OCR service gets CORS. All new code in separate files/tests.

**Tech Stack:** pdf.js canvas rendering, fetch API, PaddleOCR FastAPI service (already built at ~/ocr-service/)

---

### Task 1: Add CORS to OCR service

**Files:**
- Modify: `~/ocr-service/server.py:17-25`

**Step 1: Add CORS middleware**

In `server.py`, add after the FastAPI import block:

```python
from fastapi.middleware.cors import CORSMiddleware
```

And after `app = FastAPI(...)`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)
```

**Step 2: Verify CORS works**

Restart the service and test:
```bash
curl -I -X OPTIONS http://localhost:8100/ocr \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST"
```

Expected: response includes `access-control-allow-origin: http://localhost:5173`

**Step 3: Commit**

```bash
cd ~/ocr-service
git init && git add -A
git commit -m "feat: add CORS for localhost:5173"
```

---

### Task 2: Create OCR client utility — conversion function

**Files:**
- Create: `app/src/services/ocrClient.js`
- Test: `app/test/services/ocrClient.test.js`

This task builds the pure function that converts OCR service response lines into the `{text, y, x, maxX, refs}` format used by `parseTextAnnotations()`.

**Step 1: Write the failing test**

Create `app/test/services/ocrClient.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { convertOcrLinesToPageLines } from '../../src/services/ocrClient.js'

describe('convertOcrLinesToPageLines', () => {
  it('converts OCR response lines to the pipeline line format', () => {
    const ocrLines = [
      { text: 'Muscle Weakness at Admission', confidence: 0.99, y_pct: 14.1, x_pct: 8.4, height_pct: 2.5, bbox: { x_min: 143, y_min: 310, x_max: 900, y_max: 365 } },
      { text: 'González-Suárez I et al. BMC Neurol. 2013;13:95.', confidence: 0.99, y_pct: 45.0, x_pct: 5.1, height_pct: 1.0, bbox: { x_min: 87, y_min: 990, x_max: 800, y_max: 1012 } }
    ]

    const lines = convertOcrLinesToPageLines(ocrLines)

    expect(lines).toHaveLength(2)
    expect(lines[0]).toEqual({
      text: 'Muscle Weakness at Admission',
      y: 14.1,
      x: 8.4,
      maxX: expect.any(Number),
      refs: []
    })
    // Second line has no trailing superscripts, so refs = []
    expect(lines[1].text).toBe('González-Suárez I et al. BMC Neurol. 2013;13:95.')
    expect(lines[1].y).toBe(45.0)
  })

  it('detects trailing superscript numbers via text parsing', () => {
    const ocrLines = [
      { text: 'Treatment showed improvement1', confidence: 0.98, y_pct: 20.0, x_pct: 10.0, height_pct: 2.0, bbox: { x_min: 170, y_min: 440, x_max: 700, y_max: 484 } },
      { text: 'Outcomes at 3 months (P≤0.05)2', confidence: 0.97, y_pct: 25.0, x_pct: 10.0, height_pct: 2.0, bbox: { x_min: 170, y_min: 550, x_max: 700, y_max: 594 } }
    ]

    const lines = convertOcrLinesToPageLines(ocrLines)

    expect(lines[0].refs).toEqual([1])
    expect(lines[1].refs).toEqual([2])
  })

  it('detects Unicode superscript characters in OCR text', () => {
    const ocrLines = [
      { text: 'Severity correlates with prognosis\u00b9\u00b7\u00b2', confidence: 0.95, y_pct: 18.0, x_pct: 12.0, height_pct: 2.0, bbox: { x_min: 204, y_min: 396, x_max: 800, y_max: 440 } }
    ]

    const lines = convertOcrLinesToPageLines(ocrLines)

    expect(lines[0].refs).toContain(1)
    expect(lines[0].refs).toContain(2)
  })

  it('returns empty array for empty input', () => {
    expect(convertOcrLinesToPageLines([])).toEqual([])
    expect(convertOcrLinesToPageLines(null)).toEqual([])
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run test/services/ocrClient.test.js
```

Expected: FAIL — `ocrClient.js` does not exist yet.

**Step 3: Write minimal implementation**

Create `app/src/services/ocrClient.js`:

```js
/**
 * OCR Client — renders PDF pages to images, sends to PaddleOCR service,
 * and converts results into the line format used by the annotation pipeline.
 *
 * Separate from extractAnnotations.js so it can be tested independently.
 */

import {
  extractTrailingCitationRefs,
  parseSuperscriptCitationRefs
} from '@/utils/citationRefParsing'

const OCR_SERVICE_URL = 'http://localhost:8100'

/**
 * Convert OCR service response lines into the {text, y, x, maxX, refs} format
 * expected by parseTextAnnotations().
 *
 * OCR lines come with y_pct/x_pct (0-100 percentages) which already match
 * the coordinate space used by the pdf.js extractor.
 */
export function convertOcrLinesToPageLines(ocrLines) {
  if (!ocrLines || ocrLines.length === 0) return []

  return ocrLines
    .filter(line => line.text && line.text.trim().length > 2)
    .map(line => {
      const text = line.text.trim()
      const refs = new Set()

      // No font-size info from OCR, so use text-based superscript detection only
      extractTrailingCitationRefs(text).forEach(ref => refs.add(ref))
      parseSuperscriptCitationRefs(text).forEach(ref => refs.add(ref))

      const sortedRefs = [...refs].sort((a, b) => a - b)

      return {
        text,
        y: Math.round(line.y_pct * 10) / 10,
        x: Math.round(line.x_pct * 10) / 10,
        maxX: Math.round(((line.bbox?.x_max || 0) / (line.bbox?.x_max > 100 ? 2550 : 1) * 100) * 10) / 10 || Math.round(line.x_pct * 10) / 10 + 20,
        refs: sortedRefs
      }
    })
}
```

Note: `maxX` calculation is approximate — OCR bbox is in pixels, but since the pipeline only uses `maxX` for column overlap checks in `statementAssembly.js`, an approximation is fine. We derive it from the OCR bbox pixel coords relative to image width.

**Step 4: Run test to verify it passes**

```bash
cd app && npx vitest run test/services/ocrClient.test.js
```

Expected: PASS

**Step 5: Commit**

```bash
git add app/src/services/ocrClient.js app/test/services/ocrClient.test.js
git commit -m "feat: add ocrClient with line format conversion + tests"
```

---

### Task 3: OCR client — rendering + fetch functions

**Files:**
- Modify: `app/src/services/ocrClient.js`
- Test: `app/test/services/ocrClient.test.js` (add new describe block)

This task adds the browser-side functions that render a pdf.js page to a canvas PNG and POST it to the OCR service. These are harder to unit test (canvas/fetch), so we test the integration at a higher level.

**Step 1: Write the health check test**

Add to `app/test/services/ocrClient.test.js`:

```js
import { describe, expect, it, vi } from 'vitest'
import { convertOcrLinesToPageLines, isOcrServiceAvailable } from '../../src/services/ocrClient.js'

describe('isOcrServiceAvailable', () => {
  it('returns false when service is unreachable', async () => {
    // In test env (happy-dom), fetch to localhost:8100 will fail
    const result = await isOcrServiceAvailable()
    expect(result).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run test/services/ocrClient.test.js
```

Expected: FAIL — `isOcrServiceAvailable` not exported.

**Step 3: Add rendering and fetch functions to ocrClient.js**

Append to `app/src/services/ocrClient.js`:

```js
import { logger } from '@/utils/logger'

/**
 * Check if the OCR service is running.
 */
export async function isOcrServiceAvailable() {
  try {
    const res = await fetch(`${OCR_SERVICE_URL}/health`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Render a pdf.js page to a PNG blob at the given DPI.
 * Returns { blob, width, height } or null on failure.
 */
export async function renderPageToBlob(pdfPage, dpi = 200) {
  const scale = dpi / 72 // pdf.js default is 72 DPI
  const viewport = pdfPage.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const ctx = canvas.getContext('2d')

  await pdfPage.render({ canvasContext: ctx, viewport }).promise

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      resolve(blob ? { blob, width: viewport.width, height: viewport.height } : null)
    }, 'image/png')
  })
}

/**
 * Send a page image to the OCR service's /ocr/crop endpoint.
 * Crops to the slide region (top portion above notesBoundaryY).
 *
 * Returns the OCR response { lines, line_count, elapsed_ms } or null on failure.
 */
export async function ocrSlideRegion(pageBlob, cropBottomPct = 48) {
  try {
    const formData = new FormData()
    formData.append('file', pageBlob, 'page.png')

    const url = `${OCR_SERVICE_URL}/ocr/crop?crop_top_pct=0&crop_bottom_pct=${cropBottomPct}`
    const res = await fetch(url, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(300000) // 5 min timeout per page
    })

    if (!res.ok) {
      logger.warn('OCR service returned error', { status: res.status })
      return null
    }

    return await res.json()
  } catch (err) {
    logger.warn('OCR service call failed', { error: err.message })
    return null
  }
}
```

**Step 4: Run tests**

```bash
cd app && npx vitest run test/services/ocrClient.test.js
```

Expected: all PASS (health check returns false in test env, which is the expected behavior)

**Step 5: Commit**

```bash
git add app/src/services/ocrClient.js app/test/services/ocrClient.test.js
git commit -m "feat: add OCR rendering, fetch, and health check"
```

---

### Task 4: Wire OCR fallback into extractAnnotations.js

**Files:**
- Modify: `app/src/services/extractAnnotations.js`
- Test: `app/test/services/extractAnnotations.test.js` (add new describe block)

This is the integration point. After `extractPageTextLines()` returns pages, check each page's slide region. If a page has fewer than 3 slide lines with meaningful text (>10 chars), render it and send to OCR. Replace the empty slide lines with OCR-derived lines.

**Step 1: Write the slide-empty detection test**

Add to `app/test/services/extractAnnotations.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { parseTextAnnotations, isSlideRegionEmpty } from '../../src/services/extractAnnotations.js'

describe('isSlideRegionEmpty', () => {
  it('returns true when slide region has fewer than 3 meaningful lines', () => {
    const page = {
      pageNum: 1,
      notesBoundaryY: 48.5,
      lines: [
        // Only notes lines, nothing in slide region
        { text: 'Speaker notes', y: 49.2, x: 13.2, maxX: 25, refs: [] },
        { text: 'Some bullet point content here', y: 52.0, x: 15.0, maxX: 85, refs: [] }
      ]
    }
    expect(isSlideRegionEmpty(page)).toBe(true)
  })

  it('returns false when slide region has 3+ meaningful lines', () => {
    const page = {
      pageNum: 1,
      notesBoundaryY: 48.5,
      lines: [
        { text: 'Title of the slide with important content', y: 14.0, x: 10.0, maxX: 85, refs: [] },
        { text: 'Subtitle explaining the context', y: 20.0, x: 15.0, maxX: 80, refs: [] },
        { text: 'Key finding about treatment outcomes', y: 25.0, x: 15.0, maxX: 80, refs: [1] },
        { text: 'Speaker notes', y: 49.2, x: 13.2, maxX: 25, refs: [] }
      ]
    }
    expect(isSlideRegionEmpty(page)).toBe(false)
  })

  it('returns true when slide region has only short fragments', () => {
    const page = {
      pageNum: 1,
      notesBoundaryY: 48.5,
      lines: [
        { text: 'Ab', y: 10.0, x: 5.0, maxX: 8, refs: [] },
        { text: '5', y: 45.0, x: 80.0, maxX: 82, refs: [] },
        { text: 'Speaker notes', y: 49.2, x: 13.2, maxX: 25, refs: [] }
      ]
    }
    expect(isSlideRegionEmpty(page)).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run test/services/extractAnnotations.test.js
```

Expected: FAIL — `isSlideRegionEmpty` not exported.

**Step 3: Add isSlideRegionEmpty to extractAnnotations.js**

Add above the `extractAnnotations` function:

```js
/**
 * Check if a page's slide region lacks meaningful text (pdf.js couldn't extract it).
 * Returns true if fewer than 3 lines with >10 chars exist above the notes boundary.
 */
export function isSlideRegionEmpty(page) {
  const boundary = page.notesBoundaryY ?? 55
  const slideLines = page.lines.filter(l => l.y < boundary && l.text.length > 10)
  return slideLines.length < 3
}
```

**Step 4: Run test to verify it passes**

```bash
cd app && npx vitest run test/services/extractAnnotations.test.js
```

Expected: PASS

**Step 5: Modify extractAnnotations() to call OCR fallback**

Update the `extractAnnotations` function in `extractAnnotations.js`:

```js
import { isOcrServiceAvailable, renderPageToBlob, ocrSlideRegion, convertOcrLinesToPageLines } from '@/services/ocrClient'

export async function extractAnnotations(pdfFile, onProgress) {
  onProgress?.(10, 'Extracting text from PDF...')
  const pages = await extractPageTextLines(pdfFile)

  // ── OCR fallback for image-only slide regions ──
  const emptySlidePages = pages.filter(p => isSlideRegionEmpty(p))
  if (emptySlidePages.length > 0) {
    const ocrAvailable = await isOcrServiceAvailable()
    if (ocrAvailable) {
      onProgress?.(20, `OCR: processing ${emptySlidePages.length} image slides...`)
      const arrayBuffer = await pdfFile.arrayBuffer()
      const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

      for (let i = 0; i < emptySlidePages.length; i++) {
        const page = emptySlidePages[i]
        const pdfPage = await pdfDoc.getPage(page.pageNum)

        onProgress?.(20 + (i / emptySlidePages.length) * 15,
          `OCR: page ${page.pageNum} (${i + 1}/${emptySlidePages.length})...`)

        const rendered = await renderPageToBlob(pdfPage, 200)
        if (!rendered) continue

        const cropBottom = page.notesBoundaryY || 48
        const ocrResult = await ocrSlideRegion(rendered.blob, cropBottom)
        if (!ocrResult || !ocrResult.lines || ocrResult.lines.length === 0) continue

        const ocrLines = convertOcrLinesToPageLines(ocrResult.lines)

        // Replace slide lines: keep only lines below notes boundary, add OCR lines above
        const boundary = page.notesBoundaryY ?? 55
        const notesLines = page.lines.filter(l => l.y >= boundary)
        page.lines = [...ocrLines, ...notesLines].sort((a, b) => a.y - b.y)

        logger.info('OCR fallback applied', {
          page: page.pageNum,
          ocrLines: ocrLines.length,
          notesLines: notesLines.length,
          elapsed: ocrResult.elapsed_ms
        })

        pdfPage.cleanup()
      }
      pdfDoc.destroy()
    } else {
      logger.info('OCR service not available, skipping slide OCR fallback', {
        emptySlidePages: emptySlidePages.map(p => p.pageNum)
      })
    }
  }

  onProgress?.(40, 'Parsing references and candidates...')
  const textParsed = parseTextAnnotations(pages)

  logger.info('extractAnnotations parsed', {
    pages: pages.length,
    candidates: textParsed.candidates.length,
    slideFootnotePages: Object.keys(textParsed.slideFootnotes).length,
    notesReferencePages: Object.keys(textParsed.notesReferences).length
  })

  onProgress?.(70, 'Building annotations...')
  const { annotations, annotationBindings, globalAnnotationCount } = buildTextOnlyAnnotations(textParsed)

  onProgress?.(90, 'Finalizing...')
  return {
    success: true,
    annotations,
    annotationBindings,
    aiFinds: [],
    globalAnnotationCount,
    usage: { inputTokens: 0, outputTokens: 0, cost: 0, model: 'deterministic' }
  }
}
```

**Step 6: Run all tests**

```bash
cd app && npx vitest run test/services/
```

Expected: all PASS

**Step 7: Commit**

```bash
git add app/src/services/extractAnnotations.js app/test/services/extractAnnotations.test.js
git commit -m "feat: wire OCR fallback for image-only slide regions"
```

---

### Task 5: Manual integration test

**No code changes.** Verify the full flow end-to-end.

**Step 1: Start OCR service**

```bash
cd ~/ocr-service && source venv/bin/activate
PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True uvicorn server:app --port 8100
```

**Step 2: Start app dev servers**

Terminal 1: `cd backend && npm run dev`
Terminal 2: `cd app && npm run dev`

**Step 3: Test in browser**

1. Open http://localhost:5173/mkg3
2. Upload a "notes page" PDF (e.g., `Marissa_SYN slides for AI testing_V3_no annos-pages (1).pdf`)
3. Open browser DevTools console — look for:
   - `OCR fallback applied` log entries with page numbers and line counts
   - OR `OCR service not available` if the service isn't running
4. Verify annotations appear on slides that previously showed nothing
5. Stop the OCR service and re-run — verify the app still works (graceful fallback, no errors)

**Step 4: Verify notes region unaffected**

Compare notes-region annotations with and without OCR service running. They should be identical — OCR only touches the slide region.

---

### Summary

| Task | What | Files | Tests |
|------|------|-------|-------|
| 1 | CORS on OCR service | `~/ocr-service/server.py` | curl verification |
| 2 | Line format converter | `app/src/services/ocrClient.js` | `app/test/services/ocrClient.test.js` |
| 3 | Render + fetch functions | `app/src/services/ocrClient.js` | `app/test/services/ocrClient.test.js` |
| 4 | Wire into pipeline | `app/src/services/extractAnnotations.js` | `app/test/services/extractAnnotations.test.js` |
| 5 | Manual integration test | none | browser verification |

**Key design decisions:**
- OCR client is a **separate module** (`ocrClient.js`) — independently testable
- OCR is **opt-in fallback** — only triggers when slide region is empty AND service is running
- **No changes** to `parseTextAnnotations()`, `buildTextOnlyAnnotations()`, or the downstream pipeline
- Positions use the same 0-100% coordinate space — no conversion needed
- 200 DPI rendering — 14s/page instead of 150s at 300 DPI
