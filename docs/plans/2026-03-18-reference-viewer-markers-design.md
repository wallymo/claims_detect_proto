# Reference Viewer: Fit-to-Page Zoom + Pin-Style Markers

**Date:** March 18, 2026
**Branch:** newworkflow
**Goal:** Fix broken marker positioning in ReferenceViewer and redesign the evidence overlay to show the whole page with numbered pin markers at each highlight location.

## Problems

1. **Coordinate conversion is inverted.** `convertPdfRectsToViewport()` applies a Y-flip (`pageHeight - y1`) assuming PDF bottom-left origin, but PyMuPDF outputs top-left origin coordinates. Markers render at mirrored vertical positions.
2. **Fit-to-width zoom forces scrolling.** Portrait journal articles (~595×782 pts) render ~1300px tall in a ~730px scroll area. Users must scroll to find each highlight.
3. **Margin badges don't show spatial context.** Badges at `left: -28px` sit outside the page. Users want markers on the page itself, next to the highlighted text.

## Changes

### 1. Fix coordinate conversion (`markerCoords.js`)

**`convertPdfRectsToViewport`:**
```javascript
// Before (wrong — flips Y for bottom-left origin)
top: (pageHeightPts - r.y1) * scale

// After (correct — PyMuPDF already uses top-left origin)
top: r.y0 * scale
```

`left`, `width`, `height` calculations unchanged.

**`sortMarkersForNavigation`:**
```javascript
// Before (wrong — descending y1, puts bottom-of-page first)
return bTopY - aTopY

// After (correct — ascending y0, top-of-page first)
const aTopY = Math.min(...(a.rects || []).map(r => r.y0))
const bTopY = Math.min(...(b.rects || []).map(r => r.y0))
return aTopY - bTopY
```

### 2. Fit-to-page zoom (`ReferenceViewer.jsx`)

Replace fit-to-width with fit-to-page:
```javascript
const fitWidth = (containerWidth - 48) / baseViewport.width
const fitHeight = (scrollAreaHeight - 32) / baseViewport.height
const computedFitScale = Math.min(fitWidth, fitHeight, 2.0)
```

Requires measuring the scroll area height. Use a ref + `clientHeight` on the scroll container. The scroll area is the `.scrollArea` div (flex: 1 inside the modal).

For van Doorn PDF (595×782 pts) in 1100px × 90vh modal:
- fitWidth ≈ 1.68, fitHeight ≈ 0.89
- Result: 0.89x — whole page visible, no scrolling needed
- Page renders ~530px wide × ~696px tall, centered

### 3. Pin-style markers on the page (`ReferenceViewer.jsx` + CSS)

Replace margin badge divs with numbered dots positioned on the PDF canvas:

**Position:** Just above and to the left of the first highlight rect.
```
left: firstRect.left - 20px
top: firstRect.top - 20px
```

Clamped so pins don't go off-canvas (min left: 0, min top: 0).

**Appearance:**
- 18px diameter circle with number centered
- Inactive: muted red background (`--red-2`), red text (`--red-8`), 1px border
- Active: solid red background (`--red-6`), white text, ring glow (`box-shadow: 0 0 0 2px var(--red-3)`)
- Subtle drop shadow for depth against the page

**Interaction:** Click pin → set as active marker (same as current badge click). Prev/next nav bar unchanged.

**No connector lines** — the pin sitting next to the highlight provides sufficient spatial association.

### 4. Scroll-to-active removed

With fit-to-page, the entire page is visible. No need to `scrollTop` to the active marker when navigating. The scroll-to-active effect (lines 274-283) can be removed or gated behind a check for whether the page actually overflows.

Page changes (prev/next) still trigger a full re-render at fit-to-page scale.

## Files

| File | Change |
|------|--------|
| `app/src/utils/markerCoords.js` | Fix Y conversion, fix sort order |
| `app/src/components/mkg/ReferenceViewer/ReferenceViewer.jsx` | Fit-to-page scale, pin-style markers on canvas, measure scroll area height |
| `app/src/components/mkg/ReferenceViewer/ReferenceViewer.module.css` | Remove `.markerBadge*` margin styles, add `.markerPin` / `.markerPinActive` on-page styles |
| `app/test/utils/markerCoords.test.js` | Update expected values for new conversion + sort |

**No changes to:** `extract_markers.py`, `ClaimPinsOverlay`, `MKG3ClaimsDetector.jsx`, `MKGClaimCard.jsx`.

## Validation

1. Open app, upload test deck, click "View Source" on a reference with highlights
2. Verify whole page visible without scrolling
3. Verify numbered pins appear just above-left of each yellow highlight
4. Verify prev/next navigation highlights the correct pin
5. Test with van Doorn PDF (page 5 has 2 highlights) — markers should align with the yellow highlighted text regions
