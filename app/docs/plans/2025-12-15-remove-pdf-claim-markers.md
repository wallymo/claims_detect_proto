# Remove PDF Claim Markers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the circular claim markers from the PDF viewer to reduce visual clutter and allow focus on pure claim detection.

**Architecture:** Simple removal of the markers layer JSX and related code from PDFViewer.jsx. Keep CSS intact for potential future use.

**Tech Stack:** React, CSS Modules

---

## Task 1: Remove Markers Layer from PDFViewer.jsx

**Files:**
- Modify: `src/components/mkg/PDFViewer.jsx:326-348` (markers layer JSX)

**Step 1: Remove the markers layer JSX**

In `PDFViewer.jsx`, remove lines 326-348 (the entire markers layer block):

```jsx
// DELETE THIS ENTIRE BLOCK (lines 326-348):
{currentPageClaims.length > 0 && (
  <div
    className={styles.markersLayer}
    style={{
      width: canvasDimensions.width,
      height: canvasDimensions.height,
      transform: `translate(${panX}px, ${panY}px)`
    }}
  >
    {currentPageClaims.map(claim => (
      <button
        key={claim.id}
        className={`${styles.marker} ${getConfidenceClass(claim.confidence)} ${activeClaimId === claim.id ? styles.active : ''}`}
        style={{
          left: `${claim.position.x}%`,
          top: `${claim.position.y}%`
        }}
        onClick={(e) => handleMarkerClick(e, claim.id)}
        title={claim.text}
      />
    ))}
  </div>
)}
```

**Step 2: Verify the app builds**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add src/components/mkg/PDFViewer.jsx
git commit -m "feat: remove PDF claim markers for cleaner view"
```

---

## Task 2: Remove Unused Marker-Related Code

**Files:**
- Modify: `src/components/mkg/PDFViewer.jsx` (multiple sections)

**Step 1: Remove `getConfidenceClass` helper function**

Delete lines 45-50:

```jsx
// DELETE THIS BLOCK:
const getConfidenceClass = (confidence) => {
  if (confidence >= 0.8) return styles.markerHigh
  if (confidence >= 0.5) return styles.markerMedium
  return styles.markerLow
}
```

**Step 2: Remove `handleMarkerClick` function**

Delete lines 243-246:

```jsx
// DELETE THIS BLOCK:
const handleMarkerClick = (e, claimId) => {
  e.stopPropagation()
  onClaimSelect?.(claimId)
}
```

**Step 3: Remove `currentPageClaims` filter**

Delete line 78:

```jsx
// DELETE THIS LINE:
const currentPageClaims = claimsWithPositions.filter(c => c.page === currentPage)
```

**Step 4: Remove footer claim count display**

In the footer section (lines 364-369), remove the claim count span:

```jsx
// DELETE THIS BLOCK:
{currentPageClaims.length > 0 && (
  <span className={styles.claimCount}>
    {currentPageClaims.length} claim{currentPageClaims.length !== 1 ? 's' : ''} on this page
  </span>
)}
```

**Step 5: Verify the app builds**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 6: Commit**

```bash
git add src/components/mkg/PDFViewer.jsx
git commit -m "refactor: remove unused marker-related code"
```

---

## Task 3: Remove Text Position Extraction (Optional Cleanup)

**Files:**
- Modify: `src/components/mkg/PDFViewer.jsx` (state and effects)

**Step 1: Remove `pageTextCache` state and effect**

Delete line 40:
```jsx
// DELETE:
const [pageTextCache, setPageTextCache] = useState({})
```

Delete the text extraction effect (lines 52-67):
```jsx
// DELETE THIS ENTIRE EFFECT:
useEffect(() => {
  if (!pdf) {
    setPageTextCache({})
    return
  }

  const extractText = async () => {
    console.log('📄 Extracting text positions from PDF...')
    const cache = await extractAllPagesText(pdf)
    console.log(`✅ Extracted text from ${Object.keys(cache).length} pages`)
    setPageTextCache(cache)
  }

  extractText()
}, [pdf])
```

**Step 2: Remove `claimsWithPositions` memo**

Delete lines 69-76:
```jsx
// DELETE THIS ENTIRE BLOCK:
const claimsWithPositions = useMemo(() => {
  if (!Object.keys(pageTextCache).length || !claims.length) return claims
  const positioned = addPositionsToClaims(claims, pageTextCache)
  console.log('📍 Positioned claims:', positioned.map(c => ({ id: c.id, position: c.position })))
  return positioned
}, [claims, pageTextCache])
```

**Step 3: Update `activeClaimId` navigation effect**

Change `claimsWithPositions` to `claims` in the navigation effect:

```jsx
// CHANGE FROM:
useEffect(() => {
  if (activeClaimId) {
    const claim = claimsWithPositions.find(c => c.id === activeClaimId)
    if (claim && claim.page !== currentPage) {
      setCurrentPage(claim.page)
    }
  }
}, [activeClaimId, claimsWithPositions, currentPage])

// TO:
useEffect(() => {
  if (activeClaimId) {
    const claim = claims.find(c => c.id === activeClaimId)
    if (claim && claim.page !== currentPage) {
      setCurrentPage(claim.page)
    }
  }
}, [activeClaimId, claims, currentPage])
```

**Step 4: Remove unused imports**

Remove `useMemo` from React imports and remove the pdfTextExtractor import:

```jsx
// CHANGE FROM:
import { useState, useEffect, useRef, useMemo } from 'react'
import { extractAllPagesText, addPositionsToClaims } from '@/utils/pdfTextExtractor'

// TO:
import { useState, useEffect, useRef } from 'react'
```

**Step 5: Verify the app builds**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 6: Commit**

```bash
git add src/components/mkg/PDFViewer.jsx
git commit -m "refactor: remove PDF text position extraction (no longer needed)"
```

---

## Summary

After completing all tasks, `PDFViewer.jsx` will:
- Display PDF pages without claim markers (circles)
- Still support zoom/pan functionality
- Still support page navigation
- Still receive claims prop (for future use if needed)
- Be significantly simpler and cleaner

The CSS in `PDFViewer.module.css` is kept intact for potential future use if markers are re-enabled.
