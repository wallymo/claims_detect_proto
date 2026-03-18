# View Source Evidence Overlay — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the "View Source" reference PDF overlay to extract real highlight annotations, render red bounding boxes with numbered margin markers, and add prev/next navigation across evidence regions.

**Architecture:** PyMuPDF extracts highlight annotations (type 8) from reference PDFs on the backend → new endpoint returns marker objects with rects/quads → frontend renders red overlay rects + numbered badges on top of the PDF.js canvas → prev/next navigation jumps across markers. Existing excerpt-search fallback preserved for PDFs with no highlights (16 of 54 refs).

**Tech Stack:** PyMuPDF (Python), Express endpoint, PDF.js canvas, React overlay layer, CSS Modules

---

## Task 1: Python highlight marker extraction script

**Files:**
- Create: `scripts/extract_markers.py`

**What:** Adapt the handoff's `extract_highlight_markers.py` to match project conventions. Extract PDF annotation type 8 (Highlight) with quads/multiline support. Output JSON to stdout.

**Key differences from handoff:**
- `import pymupdf` (not `import fitz`) — matches `pymupdf_poc.py` line 24
- CLI: `scripts/.venv/bin/python3 scripts/extract_markers.py <pdf_path>` with `--pretty` flag
- Output to stdout (same pattern as `pymupdf_poc.py`)
- Shebang: `#!/usr/bin/env python3`

**Output schema per marker:**
```json
{
  "marker_id": "m-3-1",
  "page_number": 3,
  "page_height": 792.0,
  "index": 1,
  "label": "1",
  "origin": "annotation",
  "text": "Mortality was 20% in patients ventilated for GBS.",
  "color": [1.0, 0.85, 0.0],
  "rects": [
    { "x0": 72.0, "y0": 680.5, "x1": 540.0, "y1": 695.0 }
  ]
}
```

**Important:** Include `page_height` (in points) per marker so the frontend can do the Y-flip coordinate conversion without a separate PDF.js call. Rects in PDF point coordinates (origin bottom-left).

**Quad handling:** Check `annot.vertices` first. Chunk into groups of 4 points → convert each quad to axis-aligned bounding rect via `fitz.Quad(pts).rect`. Fallback to `annot.rect` if no vertices.

**Sorting:** Sort markers by `page_number` ascending, then topmost rect `y1` descending (visually top-to-bottom). Re-index after sort.

**Verify:**
```bash
scripts/.venv/bin/python3 scripts/extract_markers.py "References/References/Leonhard 2019 Nat Rev Neurology.pdf" --pretty
# Expect: 12 markers with page numbers, rects, extracted text
```

**Commit:** `feat: add PyMuPDF highlight marker extraction script`

---

## Task 2: Backend endpoint

**Files:**
- Modify: `backend/src/controllers/fileController.js` — add `getMarkers` method
- Modify: `backend/src/routes/files.js` — add route

**Endpoint:** `GET /api/files/references/:refId/markers`

**Implementation pattern:** Follow `pymupdfController.js` (lines 31-78):
1. `Reference._findByIdFull(req.params.refId)` → get `file_path`
2. Verify file exists on disk
3. `execFileAsync(PYTHON_BIN, [EXTRACT_MARKERS_SCRIPT, fullPath])` — same `PYTHON_BIN` as pymupdfController (`scripts/.venv/bin/python3`)
4. Parse stdout JSON → `res.json({ markers: [...] })`
5. Error handling: 404 (ref not found), 500 (script error/bad JSON), 504 (timeout)

**Constants to add in fileController.js:**
```javascript
import { execFile } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath } from 'url'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_BIN = path.join(PROJECT_ROOT, 'scripts/.venv/bin/python3')
const EXTRACT_MARKERS_SCRIPT = path.join(PROJECT_ROOT, 'scripts/extract_markers.py')
```

**Route (files.js line 9):**
```javascript
router.get('/references/:refId/markers', validateIdParam('refId'), fileController.getMarkers)
```

**Verify:**
```bash
cd backend && npm run dev
# In another terminal:
curl http://localhost:3001/api/files/references/11/markers | python3 -m json.tool
```

**Commit:** `feat: add GET /api/files/references/:refId/markers endpoint`

---

## Task 3: Coordinate utility + API client + tests

**Files:**
- Create: `app/src/utils/markerCoords.js`
- Create: `app/test/utils/markerCoords.test.js`
- Modify: `app/src/services/api.js` — add `fetchReferenceMarkers`

**`markerCoords.js` — two pure functions:**

```javascript
/**
 * Convert PyMuPDF rects (PDF points, origin bottom-left) to
 * viewport coordinates (pixels, origin top-left).
 */
export function convertPdfRectsToViewport(rects, pageHeightPts, scale) {
  return (rects || []).map(r => ({
    left: r.x0 * scale,
    top: (pageHeightPts - r.y1) * scale,
    width: (r.x1 - r.x0) * scale,
    height: (r.y1 - r.y0) * scale,
  }))
}

/**
 * Sort markers by page asc, then visually top-to-bottom (higher y1 = visually higher).
 */
export function sortMarkersForNavigation(markers) {
  return [...(markers || [])].sort((a, b) => {
    if (a.page_number !== b.page_number) return a.page_number - b.page_number
    const aTopY = Math.max(...(a.rects || []).map(r => r.y1))
    const bTopY = Math.max(...(b.rects || []).map(r => r.y1))
    return bTopY - aTopY
  })
}
```

**Test cases:**
- `convertPdfRectsToViewport`: known rect `{x0:72, y0:680, x1:540, y1:695}` with pageHeight=792, scale=2.0 → `{left:144, top:194, width:936, height:30}`
- Empty/null rects → empty array
- `sortMarkersForNavigation`: markers on pages 1,1,2 with different y values → sorted by page then visual position
- Empty/null markers → empty array

**API client (api.js, after line 146):**
```javascript
export async function fetchReferenceMarkers(refId) {
  return request(`/files/references/${refId}/markers`)
}
```

**Verify:**
```bash
cd app && npx vitest run test/utils/markerCoords.test.js
```

**Commit:** `feat: add marker coordinate utility, API client, and tests`

---

## Task 4: Extract ReferenceViewer component (pure refactor)

**Files:**
- Create: `app/src/components/mkg/ReferenceViewer/ReferenceViewer.jsx`
- Create: `app/src/components/mkg/ReferenceViewer/ReferenceViewer.module.css`
- Modify: `app/src/pages/MKG3ClaimsDetector.jsx` — remove inline `ReferenceViewerContent`, import new component

**This is a pure extraction — zero behavior change.** Move `ReferenceViewerContent` (lines 2607-2970) to its own file.

**Imports the new component needs** (currently inherited from parent scope):
```javascript
import { useState, useRef, useEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import * as api from '@/services/api'
import Spinner from '@/components/atoms/Spinner/Spinner'
import Icon from '@/components/atoms/Icon/Icon'
import Button from '@/components/atoms/Button/Button'
import { logger } from '@/utils/logger'
import styles from './ReferenceViewer.module.css'
```

**CSS Module:** Move inline styles from the JSX to CSS Module classes. Use design tokens (`var(--gray-*)`, `var(--amber-*)` etc.), never hardcoded hex. Key classes:
- `.container` — flex column, overflow hidden, flex:1
- `.excerptBanner` — padding 10px 16px, background `var(--gray-9)`, color `var(--gray-1)`
- `.scrollArea` — flex:1, overflow:auto, background `var(--gray-3)`, padding 16px 40px 16px 16px
- `.canvasWrapper` — position:relative, margin 0 auto
- `.pinMarker` — existing amber teardrop pin
- `.pageNav` — flex center, gap 12px, padding 8px 16px, border-top `var(--gray-3)`

**In MKG3ClaimsDetector.jsx:**
1. Delete `function ReferenceViewerContent(...)` (lines 2607-2970)
2. Add import: `import ReferenceViewer from '@/components/mkg/ReferenceViewer/ReferenceViewer'`
3. Replace `<ReferenceViewerContent` with `<ReferenceViewer` at line ~2428

**Verify:** App works identically — click "View Source" on a linked reference, PDF opens in overlay, excerpt highlighting works, page nav works.

**Commit:** `refactor: extract ReferenceViewer to own component file`

---

## Task 5: Evidence overlay layer + marker badges

**Files:**
- Modify: `app/src/components/mkg/ReferenceViewer/ReferenceViewer.jsx` — add markers prop, overlay rendering
- Modify: `app/src/components/mkg/ReferenceViewer/ReferenceViewer.module.css` — add evidence overlay styles

**Extend component signature:**
```javascript
export default function ReferenceViewer({ referenceId, page, excerpt, markers = [] })
```

**Add state:**
```javascript
const [activeMarkerIndex, setActiveMarkerIndex] = useState(0)
const [pageHeightPts, setPageHeightPts] = useState(0)
const [fitScale, setFitScale] = useState(1)
```

In the `renderPage` effect, after computing `baseViewport`, capture `setPageHeightPts(baseViewport.height)` and `setFitScale(computedFitScale)`.

**Behavioral fork:** If `markers.length > 0`, skip the excerpt-search block entirely. The markers ARE the evidence. Auto-navigate to the first marker's page.

**Compute current page markers:**
```javascript
const sortedMarkers = useMemo(() => sortMarkersForNavigation(markers), [markers])
const currentPageMarkers = useMemo(
  () => sortedMarkers.filter(m => m.page_number === currentPage),
  [sortedMarkers, currentPage]
)
```

**Render overlay (inside canvasWrapper, after textLayer div):**
For each marker in `currentPageMarkers`:
- Convert rects via `convertPdfRectsToViewport(marker.rects, marker.page_height || pageHeightPts, fitScale)`
- Render red rect divs (`.evidenceRect` + active/inactive variant)
- Render marker badge (numbered circle) to the left of topmost rect

**CSS classes to add:**
```css
.evidenceOverlay { position: absolute; inset: 0; pointer-events: none; z-index: 1; }
.evidenceRect { position: absolute; border-radius: 2px; }
.evidenceRectActive { background-color: rgba(239, 83, 80, 0.25); border: 2px solid var(--red-5); }
.evidenceRectInactive { background-color: rgba(255, 205, 210, 0.18); border: 1px solid var(--red-4); }
.markerBadge {
  position: absolute; left: -28px;
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--font-size-xs); font-weight: var(--font-weight-semibold);
  cursor: pointer; pointer-events: auto; z-index: 2;
  transition: background-color 0.15s ease;
}
.markerBadgeActive { background: var(--red-6); color: var(--color-background-primary); box-shadow: 0 0 0 2px var(--red-3); }
.markerBadgeInactive { background: var(--red-2); color: var(--red-8); border: 1px solid var(--red-4); }
```

**Verify:** Start both servers. Upload test PDF in `/mkg3` with a brand that has reference PDFs containing highlights (e.g., Leonhard 2019 has 12 highlights). Click a matched reference → modal opens → red bounding boxes visible around highlighted text → numbered badges in left margin.

**Commit:** `feat: add evidence overlay with red highlight rects and marker badges`

---

## Task 6: Marker navigation controls

**Files:**
- Modify: `app/src/components/mkg/ReferenceViewer/ReferenceViewer.jsx` — add nav bar
- Modify: `app/src/components/mkg/ReferenceViewer/ReferenceViewer.module.css` — nav bar styles

**Nav bar placement:** Between excerpt banner and scroll area, only visible when `sortedMarkers.length > 0`.

**Content:**
```
[chevronLeft] Evidence 1 of 12 [chevronRight]
```

**On prev/next click:**
1. Update `activeMarkerIndex` (clamp to 0..length-1)
2. If new marker is on different page → `setCurrentPage(newMarker.page_number)`
3. Auto-scroll so active marker's topmost rect is in top third of scroll container

**Auto-scroll effect:**
```javascript
useEffect(() => {
  if (sortedMarkers.length === 0 || !containerRef.current) return
  const active = sortedMarkers[activeMarkerIndex]
  if (!active || active.page_number !== currentPage) return
  const topRect = convertPdfRectsToViewport(
    active.rects, active.page_height || pageHeightPts, fitScale
  )[0]
  if (topRect) {
    containerRef.current.scrollTop = Math.max(0, topRect.top - containerRef.current.clientHeight / 3)
  }
}, [activeMarkerIndex, currentPage, pageHeightPts, fitScale])
```

**CSS:**
```css
.markerNav {
  display: flex; align-items: center; justify-content: center;
  gap: var(--spacing-3); padding: var(--spacing-2) var(--spacing-4);
  background: var(--red-1); border-bottom: 1px solid var(--red-3);
  font-size: var(--font-size-sm); color: var(--red-8);
}
.markerNavLabel { font-weight: var(--font-weight-medium); min-width: 120px; text-align: center; }
```

**Commit:** `feat: add prev/next marker navigation controls`

---

## Task 7: Wire markers into MKG3ClaimsDetector

**Files:**
- Modify: `app/src/pages/MKG3ClaimsDetector.jsx`

**Step 1: Add marker cache.**
```javascript
const markerCacheRef = useRef(new Map())
```

**Step 2: Modify `handleViewRef` (line 1212).**

After the existing text/fact resolution logic, before `setReferenceViewerData(...)`:
```javascript
let markers = []
if (ref.id) {
  if (markerCacheRef.current.has(ref.id)) {
    markers = markerCacheRef.current.get(ref.id)
  } else {
    try {
      const result = await api.fetchReferenceMarkers(ref.id)
      markers = result?.markers || []
      markerCacheRef.current.set(ref.id, markers)
    } catch {
      markers = []
    }
  }
}
```

**Step 3: Update `setReferenceViewerData` call (currently at line ~1331):**
```javascript
setReferenceViewerData({
  referenceId: ref.id,
  page: markers.length > 0 ? markers[0].page_number : targetPage,
  excerpt: markers.length > 0 ? null : (excerpt || (!resolvedPage ? claimText : null)),
  pageResolution: resolutionReason,
  citationPageLabel: ref.citationPageLabel || null,
  markers,
})
```

**Step 4: Pass markers to component (line ~2428):**
```jsx
<ReferenceViewer
  referenceId={referenceViewerData.referenceId}
  page={referenceViewerData.page}
  excerpt={referenceViewerData.excerpt}
  markers={referenceViewerData.markers}
/>
```

**Verify (end-to-end):**
1. Start both servers: `cd backend && npm run dev` / `cd app && npm run dev`
2. Open `/mkg3`, select brand with loaded references
3. Upload test PDF, wait for annotation extraction
4. Click a matched reference (one with `ref.id` set) on a claim card → "View Source" opens
5. If reference PDF has highlights: red bounding boxes visible, numbered badges, prev/next nav works
6. If reference PDF has no highlights: existing amber excerpt highlighting works as before
7. Run tests: `cd app && npx vitest run test/utils/markerCoords.test.js`

**Commit:** `feat: wire marker fetching into handleViewRef and pass to ReferenceViewer`

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `scripts/extract_markers.py` | Create | PyMuPDF highlight annotation extractor |
| `backend/src/controllers/fileController.js` | Modify | Add `getMarkers` method |
| `backend/src/routes/files.js` | Modify | Add markers route |
| `app/src/services/api.js` | Modify | Add `fetchReferenceMarkers()` |
| `app/src/utils/markerCoords.js` | Create | Coordinate conversion + sorting |
| `app/test/utils/markerCoords.test.js` | Create | Unit tests for coord utils |
| `app/src/components/mkg/ReferenceViewer/ReferenceViewer.jsx` | Create | Extracted + enhanced PDF viewer |
| `app/src/components/mkg/ReferenceViewer/ReferenceViewer.module.css` | Create | Viewer styles |
| `app/src/pages/MKG3ClaimsDetector.jsx` | Modify | Remove inline component, add marker cache + fetching |

No new npm/pip dependencies. No database changes.
