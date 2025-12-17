# Claim Pins Overlay Design

**Date:** 2025-12-17
**Status:** Approved
**Goal:** Integrate connect-pins visual system into MKG Claims Detector for pinpointing claims on PDF uploads with confidence-colored markers

---

## Overview

Add visual markers (pins) on PDF pages that connect to their corresponding claim cards in the sidebar. Clicking a pin selects the claim card; clicking a card highlights the pin. Pins are colored by confidence score.

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        ANALYSIS PHASE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   PDF File ──┬──► Gemini API ──► Claims with text + page        │
│              │                                                  │
│              └──► pdfjs getTextContent() ──► Text items with    │
│                                              exact positions    │
│                                                                 │
│   Then: Match claim text → text items → get x/y percentages     │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                        DISPLAY PHASE                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Claims with positions ──► PDFViewer renders:                  │
│                             • PDF on canvas                     │
│                             • Colored dots at claim positions   │
│                             • SVG connector on selection        │
│                                                                 │
│   ClaimCards panel ◄──────► Bidirectional sync ◄──────► Dots    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. `src/utils/pdfTextExtractor.js`

Extract text with positions from all PDF pages (runs once on load, cached).

```javascript
export async function extractTextWithPositions(pdf) {
  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, i) => {
      const page = await pdf.getPage(i + 1)
      const textContent = await page.getTextContent()
      const viewport = page.getViewport({ scale: 1 })

      return {
        pageNum: i + 1,
        width: viewport.width,
        height: viewport.height,
        items: textContent.items.map(item => ({
          str: item.str,
          x: item.transform[4],
          y: viewport.height - item.transform[5], // Flip Y (PDF coords are bottom-up)
          width: item.width,
          height: item.height
        }))
      }
    })
  )
  return pages
}
```

### 2. `src/utils/textMatcher.js`

Find claim text in extracted content, return x/y percentages.

```javascript
export function findClaimPosition(claimText, pageNum, extractedPages) {
  const page = extractedPages.find(p => p.pageNum === pageNum)
  if (!page) return null

  // Normalize and search for best match
  const normalized = claimText.toLowerCase().trim()
  const words = normalized.split(/\s+/).slice(0, 5) // First 5 words

  for (const item of page.items) {
    if (item.str.toLowerCase().includes(words[0])) {
      return {
        x: (item.x / page.width) * 100,
        y: (item.y / page.height) * 100
      }
    }
  }

  // Fallback: center of page
  return { x: 50, y: 50 }
}

export function enrichClaimsWithPositions(claims, extractedPages) {
  return claims.map(claim => ({
    ...claim,
    position: findClaimPosition(claim.text, claim.page, extractedPages)
  }))
}
```

### 3. `src/components/mkg/ClaimPinsOverlay.jsx`

Canvas for dots + SVG connector (adapted from connect-pins).

```javascript
export default function ClaimPinsOverlay({
  claims,              // Claims with position: { x, y } as percentages
  activeClaimId,
  canvasDimensions,    // { width, height } of rendered PDF
  containerRef,        // Ref to scrollable container
  onClaimSelect
})
```

**Key functions (adapted from connect-pins):**

- `computeDots()` — Convert percentage positions to pixel coordinates
- `drawDots()` — Render colored circles on canvas
- `placeConnector()` — Draw SVG polygon from card to dot
- `pickDotAt(x, y)` — Hit detection for clicks

### 4. Confidence Color Mapping

Matches existing UI tiers from master prompt:

```javascript
function confidenceColor(confidence) {
  if (confidence >= 0.9) return '#388E3C'  // Green - Definite claim (90-100%)
  if (confidence >= 0.7) return '#F57C00'  // Amber - Strong implication (70-89%)
  if (confidence >= 0.5) return '#E64A19'  // Orange - Borderline (50-69%)
  return '#757575'                          // Gray - Weak signal (30-49%)
}
```

---

## PDFViewer Updates

Minor changes to host the overlay:

1. Run text extraction on PDF load, store in state
2. Expose `canvasDimensions` and `containerRef` to overlay
3. Render `<ClaimPinsOverlay />` inside `contentWrapper`

```jsx
<div className={styles.contentWrapper}>
  <div className={styles.content} ref={containerRef}>
    <canvas ref={canvasRef} ... />
  </div>
  <ClaimPinsOverlay
    claims={claimsWithPositions}
    activeClaimId={activeClaimId}
    canvasDimensions={canvasDimensions}
    containerRef={containerRef}
    onClaimSelect={onClaimSelect}
  />
  <ScannerOverlay ... />
</div>
```

---

## MKGClaimsDetector Updates

After Gemini analysis completes:

```javascript
const result = await analyzeDocument(uploadedFile, onProgress)

// Enrich claims with positions
const claimsWithPositions = enrichClaimsWithPositions(
  result.claims,
  extractedPages  // From PDF load
)

setClaims(claimsWithPositions)
```

---

## Interactions

| Action | Result |
|--------|--------|
| Click dot on PDF | Selects claim, scrolls card into view, draws connector |
| Click claim card | Selects claim, scrolls PDF to show dot, draws connector |
| Scroll PDF | Connector updates position in real-time |
| Scroll cards panel | Connector updates position in real-time |
| Change page | Shows dots for that page only |
| Press R (optional) | Clears selection |

---

## File Structure

```
src/
├── utils/
│   ├── pdfTextExtractor.js    # NEW
│   └── textMatcher.js         # NEW
├── components/
│   └── mkg/
│       ├── PDFViewer.jsx      # MODIFY
│       ├── PDFViewer.module.css
│       └── ClaimPinsOverlay.jsx    # NEW
│       └── ClaimPinsOverlay.module.css  # NEW
└── pages/
    └── MKGClaimsDetector.jsx  # MODIFY
```

---

## Out of Scope

- Home page DocumentViewer integration (can reuse later)
- Manual pin placement/editing
- Multiple pins per claim
- Pin clustering for dense areas
