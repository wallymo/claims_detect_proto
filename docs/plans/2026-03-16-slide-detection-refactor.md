# Slide Detection Refactor — Vision Discovers, Text Layer Validates

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify slide annotation detection by letting Vision discover superscripted statements on slides, while the text layer validates refs against the footnote pool. Notes detection stays unchanged.

**Architecture:** Two clean pipelines. Notes = text-layer only (proven, stable, untouched). Slides = Vision discovers statements with refs + positions → text layer validates each ref exists in the footnote pool → invalid refs stripped, valid ones kept. All slide heuristics removed (chart guards, baseline detection, local font comparison, inline fused refs, dual thresholds).

**Tech Stack:** Gemini Vision (gemini.js), PDF.js (extractAnnotations.js), textOnlyAnnotations.js

---

### Task 1: New Vision Discovery Function

**Files:**
- Modify: `app/src/services/gemini.js`

Restore `detectSlideSuperscripts` as the primary slide discovery function (un-deprecate it). Keep `refineSlidePositions` for backward compat but it won't be called. The existing `detectSlideSuperscripts` prompt + schema is already good — it tells Vision to find statements with superscripts, return statement text + refNumbers + x,y positions.

**What to change:**
- Remove the `// DEPRECATED` comment from `detectSlideSuperscripts`
- Add `cleanText` field alias in the schema (optional, maps to `statement`)
- Export both functions

**No new code needed** — the old function is already there and tested.

---

### Task 2: Rewrite `enrichWithGeminiVision` — Discovery + Pool Validation

**Files:**
- Modify: `app/src/services/extractAnnotations.js`

Replace the current `enrichWithGeminiVision` (position-refinement-only) with a new version that:

1. Renders each slide page to image
2. Calls `detectSlideSuperscripts` (Vision discovers annotations)
3. For each Vision annotation, validates refNumbers against the text-layer `slidePool`
4. Keeps only annotations with at least one valid ref
5. **REPLACES** text-layer slide candidates entirely (Vision is primary for slides)

```javascript
async function enrichWithGeminiVision(pdfFile, pages, textParsed, onProgress) {
  const visionPages = pages
    .filter(p => p.hasSpeakerNotes && p.notesBoundaryY)
    .map(p => p.pageNum)

  if (visionPages.length === 0) return 0

  logger.info(`Gemini Vision: discovering slide annotations for ${visionPages.length} pages`)
  let discovered = 0

  for (let i = 0; i < visionPages.length; i++) {
    const pageNum = visionPages[i]
    const pageData = pages.find(p => p.pageNum === pageNum)
    const notesBoundaryY = pageData?.notesBoundaryY || 50
    const slideFootnotes = textParsed.slideFootnotes[pageNum] || {}
    const poolSet = new Set(Object.keys(slideFootnotes).map(k => Number(k)))

    const pct = 30 + Math.round((i / visionPages.length) * 35)
    onProgress?.(pct, `Scanning slide ${i + 1} of ${visionPages.length}...`)

    try {
      const imageBase64 = await renderPageToBase64(pdfFile, pageNum)
      const annotations = await detectSlideSuperscripts(
        imageBase64, pageNum, slideFootnotes, notesBoundaryY
      )

      if (annotations.length > 0) {
        // Remove ALL text-layer slide candidates for this page — Vision owns slides
        textParsed.candidates = textParsed.candidates.filter(
          c => !(c.region === 'slide' && c.page === pageNum)
        )

        // Add Vision annotations, validated against the footnote pool
        for (const ann of annotations) {
          const rawRefs = Array.isArray(ann.refNumbers) ? ann.refNumbers : [ann.refNumbers]
          // Validate: keep only refs that exist in the slide footnote pool
          const validRefs = poolSet.size > 0
            ? rawRefs.filter(r => poolSet.has(r))
            : rawRefs  // no pool = keep all (page might not have footnotes)

          if (validRefs.length === 0) continue  // Vision hallucinated refs

          textParsed.candidates.push({
            text: String(ann.statement || '').slice(0, 150),
            region: 'slide',
            refNumbers: validRefs,
            page: pageNum,
            pdfJsY: ann.y,
            pdfJsX: ann.x,
            source: 'gemini-vision'
          })
          discovered++
        }
      }
    } catch (err) {
      logger.warn(`Gemini Vision failed for page ${pageNum}: ${err.message}`)
      // Fallback: keep text-layer candidates for this page (they stay untouched)
    }
  }

  logger.info(`Gemini Vision: discovered ${discovered} slide annotations`)
  return discovered
}
```

**Key behaviors:**
- Vision discovers → replaces text-layer slide candidates
- Every Vision ref validated against text-layer pool (the "bible")
- If Vision fails on a page → text-layer candidates survive as fallback
- Notes candidates are NEVER touched

---

### Task 3: Strip Slide Heuristics from `extractPageTextLines`

**Files:**
- Modify: `app/src/services/extractAnnotations.js`

Remove all the slide-specific detection complexity. Keep ONLY what notes needs:

**Remove:**
- `slideThreshold` variable (line 101-102)
- `earlyNotesBoundaryY` detection (lines 104-111)
- `isSuperBySlideContext` function (lines 145-176)
- Chart axis guard inside `isSuper` (lines 127-140)
- 3-digit filter, decimal filter from `isSuper` (lines 124-125)
- Local rescue indices block (if still present)
- `endX` tracking (revert to simple `x` for maxX)

**Keep:**
- `notesThreshold` (0.7x) — rename back to `superThreshold`
- Simple `isSuper` function: `fontSize <= superThreshold && matches digit regex && not list marker`
- Notes boundary detection (both explicit and fallback)
- Line grouping with small font Y-gap
- `hasBodyFont` check (can go back to `superThreshold`)
- Pass 2 superscript association (notes supers only — slide supers don't matter anymore)

**The simplified `isSuper`:**
```javascript
const superThreshold = bodyFontSize * 0.7

const isSuper = (item) =>
  item.fontSize <= superThreshold &&
  /^(?:[\d,.\u00b7·\u2070\u00b9\u00b2\u00b3\u2074-\u2079]+)$/.test(item.text.trim()) &&
  !/^\d+\.$/.test(item.text.trim())
```

This is the ORIGINAL code that was proven stable for notes.

---

### Task 4: Strip Slide Candidate Building

**Files:**
- Modify: `app/src/services/extractAnnotations.js`

In `parseTextAnnotations`, the "Build candidates from slide lines" section (lines 540-583) can be simplified:

- Remove the chart noise ref filter (lines 558-573)
- Keep the basic slide candidate building BUT it now only serves as FALLBACK when Vision fails
- Tag text-layer slide candidates with `source: 'text-fallback'` so we know they're not Vision-discovered

The notes candidate building stays exactly as-is.

---

### Task 5: Update Import + Caller

**Files:**
- Modify: `app/src/services/extractAnnotations.js`

Change the import from `refineSlidePositions` back to `detectSlideSuperscripts`:

```javascript
import { detectSlideSuperscripts } from '@/services/gemini'
```

Update the caller log message:
```javascript
logger.info(`Gemini Vision: ${visionAdded} slide annotations discovered`)
```

---

### Task 6: Clean Up Unused Imports

**Files:**
- Modify: `app/src/services/extractAnnotations.js`

Remove `extractInlineFusedRefs` from the citationRefParsing import (no longer needed for slides, and notes never used it).

Remove the Path 4 inline fused refs code from the ref-building section (was slide-only).

---

### Task 7: Test with Both Documents

Run extraction on both test documents and verify:
1. Notes annotations are identical to before (regression check)
2. Slide annotations come from Vision with validated refs
3. No chart noise in slide results

```bash
cd app && npx vite-node /tmp/test-full-doc.ts
```

---

## Summary

| Component | Before | After |
|-----------|--------|-------|
| Notes detection | Text layer with 0.7x threshold | Same (unchanged) |
| Slide detection | Text layer with 10+ heuristics | Vision discovers + pool validates |
| `isSuper` function | 30+ lines with guards | 3 lines (original) |
| Vision role | Position refinement only | Primary slide discovery |
| Fallback | N/A | Text layer if Vision fails |
| Lines of heuristic code | ~90 | ~10 |
