# PDF Claim Markers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add clickable circle markers on PDF pages that indicate claim locations with confidence-based colors, with bidirectional sync to claim cards.

**Architecture:** Gemini returns x/y percentage coordinates for each claim. PDFViewer renders an SVG overlay layer that transforms with pan/zoom. Clicking markers or cards updates shared `activeClaimId` state.

**Tech Stack:** React, CSS Modules, pdf.js (existing), Gemini API

---

### Task 1: Update Gemini Prompt to Return Position Coordinates

**Files:**
- Modify: `src/services/gemini.js:124-151`

**Step 1: Update the OUTPUT FORMAT section in CLAIM_DETECTION_PROMPT**

Find this section (around line 124):
```javascript
## OUTPUT FORMAT

Return ONLY this JSON structure, no commentary:
{
  "inventory": [
```

Replace the entire OUTPUT FORMAT section with:

```javascript
## OUTPUT FORMAT

Return ONLY this JSON structure, no commentary:
{
  "inventory": [
    {
      "page": 1,
      "elements": [
        "Headline: [exact text]",
        "Stat callout: [exact text]",
        "Body: [exact text]",
        "Graph label: [exact text]"
      ]
    },
    {
      "page": 2,
      "elements": ["..."]
    }
  ],
  "claims": [
    {
      "claim": "[Exact extracted phrase]",
      "confidence": [0-100 integer],
      "page": [page number where claim appears],
      "position": {
        "x": [0-100 percentage from left edge],
        "y": [0-100 percentage from top edge]
      }
    }
  ]
}

For the "position" field:
- x: 0 = left edge of page, 100 = right edge
- y: 0 = top edge of page, 100 = bottom edge
- Target the START of the claim text
- Estimate visually where the text begins on the page

Now review the document. Inventory everything first, then classify. Find everything.`
```

**Step 2: Update the claims transformation to include position**

Find this code (around line 212):
```javascript
const claims = (result.claims || []).map((claim, index) => ({
  id: `claim_${String(index + 1).padStart(3, '0')}`,
  text: claim.claim,
  confidence: claim.confidence / 100,
  status: 'pending',
  page: claim.page || 1
}))
```

Replace with:
```javascript
const claims = (result.claims || []).map((claim, index) => ({
  id: `claim_${String(index + 1).padStart(3, '0')}`,
  text: claim.claim,
  confidence: claim.confidence / 100,
  status: 'pending',
  page: claim.page || 1,
  position: claim.position || { x: 90, y: 90 } // Default to bottom-right if missing
}))
```

**Step 3: Update mock claims in MKGClaimsDetector.jsx**

Find MOCK_CLAIMS (around line 16) in `src/pages/MKGClaimsDetector.jsx`:
```javascript
const MOCK_CLAIMS = [
  { id: 'claim_001', text: 'Clinically proven to reduce symptoms by 47%', confidence: 0.95, status: 'pending', page: 1 },
```

Replace with:
```javascript
const MOCK_CLAIMS = [
  { id: 'claim_001', text: 'Clinically proven to reduce symptoms by 47%', confidence: 0.95, status: 'pending', page: 1, position: { x: 15, y: 25 } },
  { id: 'claim_002', text: 'Feel like yourself again', confidence: 0.78, status: 'pending', page: 1, position: { x: 50, y: 40 } },
  { id: 'claim_003', text: 'Fast-acting relief that lasts up to 24 hours', confidence: 0.92, status: 'pending', page: 1, position: { x: 20, y: 65 } },
  { id: 'claim_004', text: 'Over 10,000 doctors recommend our treatment', confidence: 0.94, status: 'pending', page: 2, position: { x: 30, y: 20 } },
  { id: 'claim_005', text: 'Gentle, once-daily formula', confidence: 0.72, status: 'pending', page: 2, position: { x: 45, y: 50 } },
  { id: 'claim_006', text: '85% of patients reported improvement', confidence: 0.96, status: 'pending', page: 2, position: { x: 25, y: 75 } }
]
```

**Step 4: Verify changes**

Run: `npm run dev`
Navigate to: `http://localhost:5173/mkg?mock=true`
Upload any PDF, click Analyze. Check browser console for claim objects - they should now have `position` field.

**Step 5: Commit**

```bash
git add src/services/gemini.js src/pages/MKGClaimsDetector.jsx
git commit -m "feat: add position coordinates to claim detection"
```

---

### Task 2: Add Marker Styles to PDFViewer CSS

**Files:**
- Modify: `src/components/mkg/PDFViewer.module.css`

**Step 1: Add markers layer and marker styles**

Add at the end of the file:

```css
/* Claim markers overlay */
.markersLayer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 10;
}

.marker {
  position: absolute;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 2px solid white;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  pointer-events: auto;
  transform: translate(-50%, -50%);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.marker:hover {
  transform: translate(-50%, -50%) scale(1.2);
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.4);
}

.marker.active {
  animation: pulse 1.5s ease-in-out infinite;
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.5);
}

@keyframes pulse {
  0%, 100% {
    transform: translate(-50%, -50%) scale(1);
  }
  50% {
    transform: translate(-50%, -50%) scale(1.15);
  }
}

/* Confidence colors */
.markerHigh {
  background-color: #388E3C;
}

.markerMedium {
  background-color: #F57C00;
}

.markerLow {
  background-color: #D32F2F;
}
```

**Step 2: Verify CSS loads**

Run: `npm run dev`
Open browser DevTools, check that PDFViewer.module.css includes the new classes.

**Step 3: Commit**

```bash
git add src/components/mkg/PDFViewer.module.css
git commit -m "feat: add claim marker styles"
```

---

### Task 3: Add Markers Layer to PDFViewer Component

**Files:**
- Modify: `src/components/mkg/PDFViewer.jsx`

**Step 1: Update component props**

Find the component signature (around line 13):
```javascript
export default function PDFViewer({
  file,
  onClose,
  isAnalyzing = false,
  analysisProgress = 0,
  analysisStatus = 'Analyzing document...',
  onScanComplete
}) {
```

Replace with:
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
  onClaimSelect
}) {
```

**Step 2: Add helper function for confidence color class**

Add after the existing state declarations (after line 36):
```javascript
const getConfidenceClass = (confidence) => {
  if (confidence >= 0.8) return styles.markerHigh
  if (confidence >= 0.5) return styles.markerMedium
  return styles.markerLow
}
```

**Step 3: Filter claims for current page**

Add after getConfidenceClass:
```javascript
const currentPageClaims = claims.filter(c => c.page === currentPage)
```

**Step 4: Add useEffect to navigate to claim's page when activeClaimId changes**

Add after the existing useEffects (after line 115):
```javascript
// Navigate to claim's page when activeClaimId changes
useEffect(() => {
  if (activeClaimId) {
    const claim = claims.find(c => c.id === activeClaimId)
    if (claim && claim.page !== currentPage) {
      setCurrentPage(claim.page)
    }
  }
}, [activeClaimId, claims])
```

**Step 5: Add marker click handler**

Add after handleMouseLeave (around line 189):
```javascript
const handleMarkerClick = (e, claimId) => {
  e.stopPropagation()
  onClaimSelect?.(claimId)
}

const handleCanvasClick = (e) => {
  // Clear selection when clicking canvas (not a marker)
  if (e.target === canvasRef.current || e.target.classList.contains(styles.content)) {
    onClaimSelect?.(null)
  }
}
```

**Step 6: Add onClick to content div**

Find the content div (around line 230):
```javascript
<div
  className={`${styles.content} ${canPan ? styles.canPan : ''} ${isDragging ? styles.dragging : ''}`}
  ref={containerRef}
  onMouseDown={handleMouseDown}
```

Add onClick:
```javascript
<div
  className={`${styles.content} ${canPan ? styles.canPan : ''} ${isDragging ? styles.dragging : ''}`}
  ref={containerRef}
  onClick={handleCanvasClick}
  onMouseDown={handleMouseDown}
```

**Step 7: Add markers layer after canvas**

Find the canvas element (around line 253):
```javascript
{!isLoading && !error && (
  <canvas
    ref={canvasRef}
    className={styles.pdfCanvas}
    style={{
      transform: `translate(${panX}px, ${panY}px)`
    }}
  />
)}
```

Replace with:
```javascript
{!isLoading && !error && (
  <>
    <canvas
      ref={canvasRef}
      className={styles.pdfCanvas}
      style={{
        transform: `translate(${panX}px, ${panY}px)`
      }}
    />
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
  </>
)}
```

**Step 8: Update footer to show claim count**

Find the footer section (around line 273):
```javascript
{totalPages > 0 && (
  <div className={styles.footer}>
    <div className={styles.pageNav}>
```

Replace with:
```javascript
{totalPages > 0 && (
  <div className={styles.footer}>
    {currentPageClaims.length > 0 && (
      <span className={styles.claimCount}>
        {currentPageClaims.length} claim{currentPageClaims.length !== 1 ? 's' : ''} on this page
      </span>
    )}
    <div className={styles.pageNav}>
```

**Step 9: Verify markers render**

Run: `npm run dev`
Navigate to: `http://localhost:5173/mkg?mock=true`
Upload PDF, click Analyze. Colored circles should appear on PDF.

**Step 10: Commit**

```bash
git add src/components/mkg/PDFViewer.jsx
git commit -m "feat: render claim markers on PDF"
```

---

### Task 4: Wire Up Bidirectional Sync in MKGClaimsDetector

**Files:**
- Modify: `src/pages/MKGClaimsDetector.jsx`

**Step 1: Add activeClaimId state**

Find the claims state declarations (around line 47):
```javascript
// Claims state
const [claims, setClaims] = useState([])
const [statusFilter, setStatusFilter] = useState('all')
```

Add after:
```javascript
const [activeClaimId, setActiveClaimId] = useState(null)
```

**Step 2: Add claim selection handler**

Find handleClaimReject (around line 160):
```javascript
const handleClaimReject = (claimId, feedback) => {
  setClaims(prev =>
    prev.map(c => c.id === claimId ? { ...c, status: 'rejected', feedback } : c)
  )
}
```

Add after:
```javascript
const handleClaimSelect = (claimId) => {
  setActiveClaimId(claimId)
  // Scroll claim card into view if selecting from PDF
  if (claimId && claimsListRef.current) {
    const cardEl = claimsListRef.current.querySelector(`[data-claim-id="${claimId}"]`)
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }
}
```

**Step 3: Pass props to PDFViewer**

Find PDFViewer usage (around line 376):
```javascript
<PDFViewer
  file={uploadedFile}
  onClose={handleRemoveDocument}
  isAnalyzing={isAnalyzing}
  analysisProgress={analysisProgress}
  analysisStatus={analysisStatus}
  onScanComplete={() => {}}
/>
```

Replace with:
```javascript
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
/>
```

**Step 4: Pass isActive and onSelect to ClaimCard**

Find the ClaimCard mapping (around line 464):
```javascript
{analysisComplete && displayedClaims.map(claim => (
  <div key={claim.id} data-claim-id={claim.id}>
    <ClaimCard
      claim={claim}
      onApprove={handleClaimApprove}
      onReject={handleClaimReject}
      hideType={true}
      hideSource={true}
    />
  </div>
))}
```

Replace with:
```javascript
{analysisComplete && displayedClaims.map(claim => (
  <div key={claim.id} data-claim-id={claim.id}>
    <ClaimCard
      claim={claim}
      isActive={activeClaimId === claim.id}
      onApprove={handleClaimApprove}
      onReject={handleClaimReject}
      onSelect={() => handleClaimSelect(claim.id)}
      hideType={true}
      hideSource={true}
    />
  </div>
))}
```

**Step 5: Verify bidirectional sync**

Run: `npm run dev`
Navigate to: `http://localhost:5173/mkg?mock=true`
1. Upload PDF, click Analyze
2. Click a circle on PDF → corresponding claim card should highlight and scroll into view
3. Click a claim card → PDF should navigate to that page, circle should pulse

**Step 6: Commit**

```bash
git add src/pages/MKGClaimsDetector.jsx
git commit -m "feat: wire up bidirectional claim selection"
```

---

### Task 5: Add Active State Styling to ClaimCard

**Files:**
- Modify: `src/components/claims-detector/ClaimCard.jsx`
- Modify: `src/components/claims-detector/ClaimCard.module.css`

**Step 1: Check ClaimCard props**

Read ClaimCard.jsx to confirm it accepts `isActive` and `onSelect` props. If it already does, skip to Step 3.

**Step 2: Add missing props if needed**

If ClaimCard doesn't have these props, add them to the signature and use them (check MKGClaimCard for reference pattern).

**Step 3: Add active state CSS to ClaimCard.module.css**

Add to the file:
```css
.claimCard.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary-light, rgba(25, 118, 210, 0.2));
}
```

**Step 4: Verify active styling**

Run: `npm run dev`
Click a claim card or marker - the selected card should have a highlighted border.

**Step 5: Commit**

```bash
git add src/components/claims-detector/ClaimCard.jsx src/components/claims-detector/ClaimCard.module.css
git commit -m "feat: add active state styling to claim cards"
```

---

### Task 6: Final Integration Test

**Step 1: Test full flow with mock data**

Run: `npm run dev`
Navigate to: `http://localhost:5173/mkg?mock=true`

Verify:
- [ ] Upload PDF displays correctly
- [ ] Click Analyze shows colored circles on PDF
- [ ] Circle colors match confidence (green ≥80%, amber ≥50%, red <50%)
- [ ] Clicking circle highlights card and scrolls to it
- [ ] Clicking card navigates PDF to correct page
- [ ] Active circle pulses
- [ ] Clicking empty area on PDF clears selection
- [ ] Pan/zoom keeps circles aligned
- [ ] Page navigation shows correct claims per page
- [ ] Footer shows "X claims on this page"

**Step 2: Test with real Gemini API (optional)**

Remove `?mock=true` from URL, upload a real pharma PDF, verify Gemini returns positions.

**Step 3: Run build to verify no errors**

```bash
npm run build
```

**Step 4: Run lint**

```bash
npm run lint
```

Fix any lint errors.

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete PDF claim markers implementation"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add position to Gemini prompt & response | gemini.js, MKGClaimsDetector.jsx |
| 2 | Add marker CSS styles | PDFViewer.module.css |
| 3 | Render markers layer on PDF | PDFViewer.jsx |
| 4 | Wire up bidirectional sync | MKGClaimsDetector.jsx |
| 5 | Add active styling to ClaimCard | ClaimCard.jsx, ClaimCard.module.css |
| 6 | Final integration test | - |
