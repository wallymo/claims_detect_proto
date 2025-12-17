# Claim Pins Overlay Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add visual pin markers on PDFs that connect to claim cards with confidence-based coloring and bidirectional selection.

**Architecture:** Extract text positions from PDF via pdfjs on load, match claim text to get x/y coordinates, render pins on a canvas overlay with SVG connectors adapted from connect-pins.

**Tech Stack:** React, pdfjs-dist, Canvas API, SVG

---

## Task 1: Create PDF Text Extractor Utility

**Files:**
- Create: `app/src/utils/pdfTextExtractor.js`

**Step 1: Create the extractor utility**

```javascript
/**
 * Extract text content with positions from all pages of a PDF
 * Positions are in PDF coordinate space (origin bottom-left)
 * We flip Y to screen coordinates (origin top-left)
 */

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
          // PDF coordinates: origin at bottom-left
          // Screen coordinates: origin at top-left, so flip Y
          x: item.transform[4],
          y: viewport.height - item.transform[5],
          width: item.width || 0,
          height: item.height || 12
        }))
      }
    })
  )
  return pages
}
```

**Step 2: Verify file created**

Run: `ls -la app/src/utils/pdfTextExtractor.js`
Expected: File exists

**Step 3: Commit**

```bash
git add app/src/utils/pdfTextExtractor.js
git commit -m "feat: add PDF text extractor utility"
```

---

## Task 2: Create Text Matcher Utility

**Files:**
- Create: `app/src/utils/textMatcher.js`

**Step 1: Create the matcher utility**

```javascript
/**
 * Match claim text against extracted PDF text to find position
 * Returns x/y as percentages (0-100) of page dimensions
 */

/**
 * Normalize text for fuzzy matching
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim()
}

/**
 * Find the position of a claim on a specific page
 * @param {string} claimText - The claim text to find
 * @param {number} pageNum - Page number (1-indexed)
 * @param {Array} extractedPages - Output from extractTextWithPositions
 * @returns {{ x: number, y: number } | null} - Position as percentages
 */
export function findClaimPosition(claimText, pageNum, extractedPages) {
  const page = extractedPages.find(p => p.pageNum === pageNum)
  if (!page || !page.items.length) return null

  const normalizedClaim = normalizeText(claimText)

  // Extract first few significant words for matching
  const searchWords = normalizedClaim
    .split(' ')
    .filter(w => w.length > 3) // Skip short words
    .slice(0, 4)               // First 4 significant words

  if (searchWords.length === 0) return null

  // Build full page text with position tracking
  let bestMatch = null
  let bestScore = 0

  for (const item of page.items) {
    const normalizedItem = normalizeText(item.str)
    if (!normalizedItem) continue

    // Count how many search words appear in this item
    let score = 0
    for (const word of searchWords) {
      if (normalizedItem.includes(word)) {
        score++
      }
    }

    // If this item contains the first search word, boost score
    if (normalizedItem.includes(searchWords[0])) {
      score += 2
    }

    if (score > bestScore) {
      bestScore = score
      bestMatch = item
    }
  }

  // Require at least 2 matching words (or 1 + first word bonus)
  if (bestScore >= 2 && bestMatch) {
    return {
      x: (bestMatch.x / page.width) * 100,
      y: (bestMatch.y / page.height) * 100
    }
  }

  // Fallback: return null (caller can decide default)
  return null
}

/**
 * Enrich an array of claims with position data
 * @param {Array} claims - Claims from Gemini (must have text and page)
 * @param {Array} extractedPages - Output from extractTextWithPositions
 * @returns {Array} - Claims with position: { x, y } added
 */
export function enrichClaimsWithPositions(claims, extractedPages) {
  return claims.map((claim, index) => {
    const position = findClaimPosition(claim.text, claim.page, extractedPages)

    return {
      ...claim,
      position: position || {
        // Fallback: stagger vertically on left side of page
        x: 15,
        y: 10 + (index * 8) % 80
      }
    }
  })
}
```

**Step 2: Verify file created**

Run: `ls -la app/src/utils/textMatcher.js`
Expected: File exists

**Step 3: Commit**

```bash
git add app/src/utils/textMatcher.js
git commit -m "feat: add text matcher utility for claim positions"
```

---

## Task 3: Create ClaimPinsOverlay Component - CSS

**Files:**
- Create: `app/src/components/mkg/ClaimPinsOverlay.module.css`

**Step 1: Create the CSS module**

```css
.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
}

.dotsCanvas {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: auto;
  cursor: default;
}

.dotsCanvas.hasHover {
  cursor: pointer;
}

.connector {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
}

/* Pin label showing claim number */
.pinLabel {
  position: absolute;
  font-size: 10px;
  font-weight: 700;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  transform: translate(-50%, -50%);
}
```

**Step 2: Verify file created**

Run: `ls -la app/src/components/mkg/ClaimPinsOverlay.module.css`
Expected: File exists

**Step 3: Commit**

```bash
git add app/src/components/mkg/ClaimPinsOverlay.module.css
git commit -m "feat: add ClaimPinsOverlay CSS"
```

---

## Task 4: Create ClaimPinsOverlay Component - JavaScript

**Files:**
- Create: `app/src/components/mkg/ClaimPinsOverlay.jsx`

**Step 1: Create the component**

```jsx
import { useRef, useEffect, useCallback, useState } from 'react'
import styles from './ClaimPinsOverlay.module.css'

const DOT_RADIUS = 14
const DOT_RADIUS_ACTIVE = 18

/**
 * Get color based on confidence score
 * Matches the confidence tiers in master prompt
 */
function confidenceColor(confidence) {
  if (confidence >= 0.9) return '#388E3C'  // Green - Definite claim (90-100%)
  if (confidence >= 0.7) return '#F57C00'  // Amber - Strong implication (70-89%)
  if (confidence >= 0.5) return '#E64A19'  // Orange - Borderline (50-69%)
  return '#757575'                          // Gray - Weak signal (30-49%)
}

/**
 * ClaimPinsOverlay - Renders dots on PDF and connectors to claim cards
 *
 * Adapted from connect-pins standalone app
 */
export default function ClaimPinsOverlay({
  claims = [],
  activeClaimId = null,
  currentPage = 1,
  canvasDimensions = { width: 0, height: 0 },
  panOffset = { x: 0, y: 0 },
  scale = 1,
  onClaimSelect,
  claimsPanelRef  // Ref to the claims panel for connector positioning
}) {
  const canvasRef = useRef(null)
  const svgRef = useRef(null)
  const [hoveredDot, setHoveredDot] = useState(null)

  // Filter claims for current page and compute pixel positions
  const dots = claims
    .filter(claim => claim.page === currentPage && claim.position)
    .map(claim => ({
      id: claim.id,
      x: (claim.position.x / 100) * canvasDimensions.width,
      y: (claim.position.y / 100) * canvasDimensions.height,
      confidence: claim.confidence,
      text: claim.text
    }))

  // Draw dots on canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || canvasDimensions.width === 0) return

    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1

    // Set canvas size accounting for device pixel ratio
    canvas.width = canvasDimensions.width * dpr
    canvas.height = canvasDimensions.height * dpr
    canvas.style.width = `${canvasDimensions.width}px`
    canvas.style.height = `${canvasDimensions.height}px`
    ctx.scale(dpr, dpr)

    // Clear canvas
    ctx.clearRect(0, 0, canvasDimensions.width, canvasDimensions.height)

    // Draw each dot
    dots.forEach((dot, index) => {
      const isActive = activeClaimId === dot.id
      const isHovered = hoveredDot === dot.id
      const radius = isActive || isHovered ? DOT_RADIUS_ACTIVE : DOT_RADIUS

      ctx.save()

      // Glow effect for active dot
      if (isActive) {
        ctx.shadowColor = 'rgba(90, 170, 255, 0.8)'
        ctx.shadowBlur = 20
      } else if (isHovered) {
        ctx.shadowColor = 'rgba(255, 255, 255, 0.5)'
        ctx.shadowBlur = 12
      }

      // Draw circle
      ctx.beginPath()
      ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2)
      ctx.fillStyle = confidenceColor(dot.confidence)
      ctx.fill()

      // Border
      ctx.lineWidth = 2
      ctx.strokeStyle = isActive ? 'rgba(255, 255, 255, 0.9)' : 'rgba(0, 0, 0, 0.3)'
      ctx.stroke()

      ctx.restore()

      // Draw claim number in center
      ctx.save()
      ctx.font = `bold ${isActive ? 12 : 10}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = 'white'
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
      ctx.shadowBlur = 2
      ctx.fillText(String(index + 1), dot.x, dot.y)
      ctx.restore()
    })
  }, [dots, activeClaimId, hoveredDot, canvasDimensions])

  // Draw connector SVG
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !activeClaimId) {
      if (svg) svg.innerHTML = ''
      return
    }

    const activeDot = dots.find(d => d.id === activeClaimId)
    if (!activeDot) {
      svg.innerHTML = ''
      return
    }

    // Find the active claim card in the panel
    const cardEl = document.querySelector(`[data-claim-id="${activeClaimId}"]`)
    if (!cardEl || !claimsPanelRef?.current) {
      svg.innerHTML = ''
      return
    }

    const svgRect = svg.getBoundingClientRect()
    const cardRect = cardEl.getBoundingClientRect()

    // Card position relative to SVG
    const cardLeft = cardRect.left - svgRect.left
    const cardTop = cardRect.top - svgRect.top
    const cardBottom = cardRect.bottom - svgRect.top

    // Dot position (already in canvas coordinates, adjust for pan)
    const dotX = activeDot.x + panOffset.x
    const dotY = activeDot.y + panOffset.y

    // Build gradient
    const gradientId = 'connectorGradient'
    const cardMidY = (cardTop + cardBottom) / 2

    svg.innerHTML = `
      <defs>
        <linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse"
          x1="${cardLeft}" y1="${cardMidY}" x2="${dotX}" y2="${dotY}">
          <stop offset="0%" stop-color="white" stop-opacity="0.85"/>
          <stop offset="100%" stop-color="white" stop-opacity="0.15"/>
        </linearGradient>
        <filter id="connectorShadow">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="black" flood-opacity="0.3"/>
        </filter>
      </defs>
      <path
        d="M ${cardLeft},${cardTop}
           L ${cardLeft},${cardBottom}
           L ${dotX},${dotY + DOT_RADIUS}
           L ${dotX},${dotY - DOT_RADIUS}
           Z"
        fill="url(#${gradientId})"
        stroke="rgba(255,255,255,0.2)"
        stroke-width="1"
        stroke-linejoin="round"
        filter="url(#connectorShadow)"
      />
    `
  }, [dots, activeClaimId, panOffset, claimsPanelRef])

  // Hit detection for dot clicks
  const findDotAt = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current
    if (!canvas) return null

    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    // Find closest dot within click radius
    let closest = null
    let closestDist = Infinity

    for (const dot of dots) {
      const dist = Math.hypot(dot.x - x, dot.y - y)
      if (dist < closestDist) {
        closest = dot
        closestDist = dist
      }
    }

    // Check if within hit radius (dot radius + tolerance)
    return closestDist <= DOT_RADIUS + 8 ? closest : null
  }, [dots])

  const handleCanvasClick = useCallback((e) => {
    const dot = findDotAt(e.clientX, e.clientY)
    if (dot) {
      onClaimSelect?.(dot.id)
    }
  }, [findDotAt, onClaimSelect])

  const handleCanvasMouseMove = useCallback((e) => {
    const dot = findDotAt(e.clientX, e.clientY)
    setHoveredDot(dot?.id || null)
  }, [findDotAt])

  const handleCanvasMouseLeave = useCallback(() => {
    setHoveredDot(null)
  }, [])

  if (canvasDimensions.width === 0 || canvasDimensions.height === 0) {
    return null
  }

  return (
    <div className={styles.overlay}>
      <canvas
        ref={canvasRef}
        className={`${styles.dotsCanvas} ${hoveredDot ? styles.hasHover : ''}`}
        style={{
          transform: `translate(${panOffset.x}px, ${panOffset.y}px)`
        }}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        onMouseLeave={handleCanvasMouseLeave}
      />
      <svg
        ref={svgRef}
        className={styles.connector}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
```

**Step 2: Verify file created**

Run: `ls -la app/src/components/mkg/ClaimPinsOverlay.jsx`
Expected: File exists

**Step 3: Commit**

```bash
git add app/src/components/mkg/ClaimPinsOverlay.jsx
git commit -m "feat: add ClaimPinsOverlay component with dots and connectors"
```

---

## Task 5: Update PDFViewer - Add Text Extraction

**Files:**
- Modify: `app/src/components/mkg/PDFViewer.jsx`

**Step 1: Add imports at top of file**

Add after existing imports (around line 7):

```javascript
import ClaimPinsOverlay from './ClaimPinsOverlay'
import { extractTextWithPositions } from '@/utils/pdfTextExtractor'
```

**Step 2: Add state for extracted text**

Add after existing state declarations (around line 36):

```javascript
const [extractedPages, setExtractedPages] = useState([])
```

**Step 3: Add text extraction effect**

Add after the PDF loading useEffect (around line 78):

```javascript
// Extract text from all pages when PDF loads
useEffect(() => {
  if (!pdf) {
    setExtractedPages([])
    return
  }

  const extract = async () => {
    try {
      const pages = await extractTextWithPositions(pdf)
      setExtractedPages(pages)
      console.log(`✅ Extracted text from ${pages.length} pages`)
    } catch (err) {
      console.error('Text extraction error:', err)
    }
  }

  extract()
}, [pdf])
```

**Step 4: Add ref for claims panel (passed from parent)**

Update the component props to include `claimsPanelRef`:

```javascript
export default function PDFViewer({
  file,
  onClose,
  isAnalyzing = false,
  analysisProgress = 0,
  analysisStatus = 'Analyzing document...',
  onScanComplete,
  claims = [],
  activeClaimId = null,
  onClaimSelect,
  claimsPanelRef  // NEW: ref to claims panel for connector positioning
}) {
```

**Step 5: Add ClaimPinsOverlay to render**

Inside the `contentWrapper` div, after the canvas element and before `ScannerOverlay` (around line 283):

```jsx
{!isLoading && !error && pdf && (
  <>
    <canvas
      ref={canvasRef}
      className={styles.pdfCanvas}
      style={{
        transform: `translate(${panX}px, ${panY}px)`
      }}
    />
    <ClaimPinsOverlay
      claims={claims}
      activeClaimId={activeClaimId}
      currentPage={currentPage}
      canvasDimensions={canvasDimensions}
      panOffset={{ x: panX, y: panY }}
      scale={scale}
      onClaimSelect={onClaimSelect}
      claimsPanelRef={claimsPanelRef}
    />
  </>
)}
```

**Step 6: Export extractedPages for parent to use**

Add a new prop callback to notify parent when extraction completes. Add to props:

```javascript
onTextExtracted  // NEW: callback when text extraction completes
```

Update the extraction effect to call it:

```javascript
useEffect(() => {
  if (!pdf) {
    setExtractedPages([])
    return
  }

  const extract = async () => {
    try {
      const pages = await extractTextWithPositions(pdf)
      setExtractedPages(pages)
      onTextExtracted?.(pages)  // NEW: notify parent
      console.log(`✅ Extracted text from ${pages.length} pages`)
    } catch (err) {
      console.error('Text extraction error:', err)
    }
  }

  extract()
}, [pdf, onTextExtracted])
```

**Step 7: Verify changes compile**

Run: `cd app && npm run build`
Expected: Build succeeds (warnings OK)

**Step 8: Commit**

```bash
git add app/src/components/mkg/PDFViewer.jsx
git commit -m "feat: integrate ClaimPinsOverlay into PDFViewer"
```

---

## Task 6: Update MKGClaimsDetector - Wire Everything Together

**Files:**
- Modify: `app/src/pages/MKGClaimsDetector.jsx`

**Step 1: Add import for text matcher**

Add after existing imports (around line 13):

```javascript
import { enrichClaimsWithPositions } from '@/utils/textMatcher'
```

**Step 2: Add state for extracted pages**

Add after existing state declarations (around line 46):

```javascript
const [extractedPages, setExtractedPages] = useState([])
```

**Step 3: Add ref for claims panel**

Add after `claimsListRef` declaration (around line 47):

```javascript
const claimsPanelRef = useRef(null)
```

**Step 4: Create handler for text extraction**

Add after the useEffect for localStorage (around line 55):

```javascript
// Handle text extraction from PDFViewer
const handleTextExtracted = (pages) => {
  setExtractedPages(pages)
}
```

**Step 5: Modify handleAnalyze to enrich claims with positions**

Update the analysis success block (around line 125) to enrich claims:

Replace:
```javascript
setClaims(result.claims)
```

With:
```javascript
// Enrich claims with positions from extracted text
const claimsWithPositions = extractedPages.length > 0
  ? enrichClaimsWithPositions(result.claims, extractedPages)
  : result.claims

setClaims(claimsWithPositions)
```

**Step 6: Add ref to claims panel div**

Find the claims panel div (around line 407) and add the ref:

```jsx
<div className="claimsPanel" ref={claimsPanelRef}>
```

**Step 7: Pass new props to PDFViewer**

Update the PDFViewer component (around line 393):

```jsx
<PDFViewer
  file={uploadedFile}
  onClose={handleRemoveDocument}
  isAnalyzing={isAnalyzing}
  analysisProgress={analysisProgress}
  analysisStatus={analysisStatus}
  onScanComplete={() => {}}
  claims={claims}
  activeClaimId={activeClaimId}
  onClaimSelect={handleClaimSelect}
  onTextExtracted={handleTextExtracted}
  claimsPanelRef={claimsPanelRef}
/>
```

**Step 8: Verify changes compile**

Run: `cd app && npm run build`
Expected: Build succeeds

**Step 9: Commit**

```bash
git add app/src/pages/MKGClaimsDetector.jsx
git commit -m "feat: wire up claim position enrichment in MKGClaimsDetector"
```

---

## Task 7: Manual Testing

**Step 1: Start dev server**

Run: `cd app && npm run dev`

**Step 2: Test the integration**

1. Open http://localhost:5173/mkg
2. Upload a PDF with text
3. Click "Analyze Document"
4. Verify:
   - [ ] Colored dots appear on PDF at claim positions
   - [ ] Dots are numbered (1, 2, 3...)
   - [ ] Dot colors match confidence tiers (green/amber/orange/gray)
   - [ ] Clicking a dot selects the claim card
   - [ ] Clicking a claim card highlights the dot
   - [ ] Connector polygon draws between card and dot
   - [ ] Scrolling updates connector position
   - [ ] Changing pages shows dots for that page only

**Step 3: Final commit if all tests pass**

```bash
git add -A
git commit -m "feat: complete claim pins overlay integration"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | PDF text extractor | `utils/pdfTextExtractor.js` |
| 2 | Text matcher | `utils/textMatcher.js` |
| 3 | Overlay CSS | `components/mkg/ClaimPinsOverlay.module.css` |
| 4 | Overlay component | `components/mkg/ClaimPinsOverlay.jsx` |
| 5 | PDFViewer integration | `components/mkg/PDFViewer.jsx` |
| 6 | Page integration | `pages/MKGClaimsDetector.jsx` |
| 7 | Manual testing | - |
