# PyMuPDF App Integration: Side-by-Side Comparison

**Date:** March 16, 2026
**Depends on:** `2026-03-16-pymupdf-poc-design.md` (POC script already built)
**Goal:** Run the PyMuPDF parser from the app and show results alongside the current pipeline via a tab switcher.

## Backend: New Endpoint

### `POST /api/pymupdf-extract`

- Receives uploaded PDF via Multer (existing middleware)
- Saves file to temp location
- Calls `scripts/.venv/bin/python3 scripts/pymupdf_poc.py <temp_path> --pretty` via `child_process.execFile`
- Parses stdout JSON, returns to frontend
- Cleans up temp file

**Response shape:** Same as POC output:
```json
{
  "file": "...",
  "total_pages": 31,
  "pages": [
    {
      "page": 2,
      "slide_claims": [...],
      "notes_claims": [...],
      "slide_footnotes": {...},
      "notes_references": {...},
      "unresolved_superscripts": [...]
    }
  ]
}
```

**No new npm dependencies.** Uses `child_process.execFile` (built-in).

**Files to create/modify:**
- `backend/src/controllers/pymupdfController.js` — new controller
- `backend/src/routes/pymupdf.js` — new route
- `backend/server.js` — register new route

## Frontend: Tab Switcher

### Data Flow

1. User uploads PDF and clicks Analyze
2. Current pipeline runs client-side (pdf.js + Gemini Vision) → stores in `annotations` state
3. Simultaneously, PDF POST'd to `/api/pymupdf-extract` → stores in `pymupdfAnnotations` state
4. Tab switcher controls which annotation set renders

### Tab UI

- Two tabs above results: **"Vision + pdf.js"** (default) | **"PyMuPDF"**
- Switching tabs swaps the data source for existing components
- No changes to ClaimPinsOverlay, MKGClaimCard, or other display components

### PyMuPDF → Annotation Transform

Map PyMuPDF output to the existing annotation format so components work unchanged:

```javascript
// Each slide_claim / notes_claim becomes:
{
  id: `pymupdf-${pageNum}-${index}`,
  text: claim.text,
  claim: claim.text,
  statement: claim.text,
  region: 'slide' | 'notes',
  refNumbers: claim.superscripts,
  superscripts: claim.superscripts,
  references: claim.references.map(r => ({
    number: r.number,
    text: r.text,
    missing: false
  })),
  source: 'pymupdf',
  matched: true,
  matchTier: 'on-page',
  confidence: 95,
  page: pageNum,
  position: claim.position,  // already in % coordinates
  globalSpot: false,
}
```

Unresolved superscripts become annotations with `matched: false`.

### Files to Modify

- `app/src/pages/MKG3ClaimsDetector.jsx` — add state, tab switcher, parallel API call
- `app/src/services/api.js` — add `extractWithPyMuPDF(file)` function (or inline fetch)

### No Changes Required

- `ClaimPinsOverlay` — receives annotations, renders pins (data-agnostic)
- `MKGClaimCard` — receives annotation object, renders card (data-agnostic)
- `textOnlyAnnotations.js` — still used for current pipeline tab
- Any other existing components
