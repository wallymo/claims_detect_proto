# PDF Claim Markers Design

## Overview

Add visual circle markers on the PDF to identify claims, with bidirectional sync to claim cards.

## Requirements

- Circle markers positioned on PDF at claim locations
- Circle color matches confidence score (green/amber/red)
- Clicking a circle selects the corresponding claim card
- Clicking a claim card navigates to the page and highlights the circle
- Markers stay aligned during pan/zoom

## Gemini Response Format Change

**Current:** Claims return with `page` and `text` only.

**New:** Add `position` with percentage-based coordinates.

```javascript
{
  id: 'claim_001',
  text: 'Clinically proven to reduce symptoms by 47%',
  confidence: 0.95,
  page: 1,
  position: { x: 25, y: 38 }  // percentage from top-left
}
```

**Prompt addition:**
```
For each claim, estimate its visual position on the page as percentage coordinates:
- x: 0 = left edge, 100 = right edge
- y: 0 = top edge, 100 = bottom edge
Return as "position": { "x": <number>, "y": <number> }
Target the START of the claim text.
```

**Fallback:** If position is omitted, default to `{ x: 90, y: 90 }` (bottom-right).

## Circle Marker Design

**Visual:**
- 16px diameter circles
- White border for visibility on any background
- Slight drop shadow
- Pulse animation on active/selected marker
- Scale up slightly on hover

**Confidence colors** (matching ClaimCard thresholds):
- `≥ 0.8` → Green (`#388E3C`)
- `≥ 0.5` → Amber (`#F57C00`)
- `< 0.5` → Red (`#D32F2F`)

**Positioning:**
- Markers layer is `position: absolute` over the canvas
- Transforms with pan/zoom so circles stay aligned
- Uses percentage positioning: `left: ${x}%`, `top: ${y}%`

## Bidirectional Sync

**Circle click → Claim card:**
1. PDFViewer receives `onClaimSelect` callback prop
2. Circle click calls `onClaimSelect(claimId)`
3. MKGClaimsDetector sets `activeClaimId` state
4. Claims panel scrolls to that card, highlights it

**Claim card click → Circle:**
1. ClaimCard `onSelect` triggers `handleClaimSelect(claimId)`
2. MKGClaimsDetector sets `activeClaimId` and extracts claim's `page`
3. PDFViewer receives `activeClaimId` prop
4. PDF navigates to correct page if needed
5. Corresponding circle shows pulse animation

**Auto-clear:** Active state clears when user clicks elsewhere on PDF (not on a marker).

## Files to Modify

1. **`src/services/gemini.js`**
   - Update prompt to request `position: { x, y }` coordinates
   - Parse response to include position, default to `{ x: 90, y: 90 }` if missing

2. **`src/components/mkg/PDFViewer.jsx`**
   - Add props: `claims`, `activeClaimId`, `onClaimSelect`
   - Render markers layer over canvas
   - Sync pan/zoom transforms to markers layer
   - Navigate to page when `activeClaimId` changes

3. **`src/components/mkg/PDFViewer.module.css`**
   - Add `.markersLayer` (absolute positioning)
   - Add `.marker` (circle styles, colors, hover/active states)

4. **`src/pages/MKGClaimsDetector.jsx`**
   - Add `activeClaimId` state
   - Pass claims and callbacks to PDFViewer
   - Handle bidirectional selection

5. **`src/components/claims-detector/ClaimCard.jsx`**
   - Wire up `isActive` prop for highlight styling
