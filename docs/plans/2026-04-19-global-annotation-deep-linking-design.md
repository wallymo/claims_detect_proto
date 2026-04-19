# Global Annotation Deep Linking — Design

**Date:** April 19, 2026
**Branch:** newworkflow
**Depends on:** PyMuPDF pipeline (built), Evidence suggestion pipeline (built), ReferenceViewer (built)
**Goal:** When PyMuPDF finds orphan references (global annotations), automatically discover unsuperscripted claims on the slide and link each to precise evidence regions (page, figure, table, paragraph) in the source reference PDF.

## Problem

Slides often contain claims with no superscript citations but have orphan references in the footnotes. Example: a slide says "Drug X reduced risk by 47%" with no superscript, but reference #3 at the bottom is the source. Today, PyMuPDF creates a flat "Global" annotation for the orphan reference — no connection between the reference and specific claims on the slide.

The reviewer sees a "Global" badge and knows the reference applies somewhere on the slide, but can't tell which statement it supports or where to find the evidence in the source PDF.

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Claim detection | AI-driven (Gemini) | Pharma language is nuanced; deterministic scoring too blunt for claim-reference matching |
| Evidence location | Two-pass: Flash Lite (claim discovery) → Pro (evidence location) | Balances cost (~$0.02-0.05 per global annotation) with precision |
| Trigger | Automatic during `/api/pymupdf-extract` | No extra user action needed; runs as part of analysis |
| UI | Nested under global card — expandable child claims | Keeps claim list clean; hierarchy is clear |
| Evidence precision | Same bounding-box system as ReferenceViewer | Reuses existing infrastructure; page + rects + type |
| Persistence | Inline in annotation data (not separate DB table) | Child claims are derived, not user-created; no need for persistence |

## Architecture

### Pipeline: Automatic on PyMuPDF Analysis

```
POST /api/pymupdf-extract (PDF)
  → PyMuPDF runs (deterministic, <1s)
  → For pages with global_annotations:
      → Pass 1: Gemini Flash Lite discovers claims
         Input: slide text + orphan reference texts
         Output: array of { text, position_hint, reference_index, evidence_type_expected, confidence }
      → Pass 2: For each discovered claim (parallel):
         → evidence_candidates.py extracts scored candidates from reference PDF
         → Gemini Pro reranks to best 1-2 evidence regions
         Output: { page_number, type, rects, snippet, rationale }
      → Attach childClaims to each global annotation
  → Return enriched JSON to frontend
```

### Backend Orchestration

New service: `backend/src/services/globalAnnotationLinker.js`

1. Receives PyMuPDF result + slide content per page
2. For each page with global annotations:
   - Calls Gemini Flash Lite for claim discovery
   - For each discovered claim, calls `evidence_candidates.py` + Gemini Pro for evidence location
3. Returns enriched global annotations with `childClaims` array

Integration point: `pymupdfController.js:56` — after `res.json(result)`, change to intercept and enrich before sending.

### Pass 1: Claim Discovery (Gemini Flash Lite)

**Input:** Slide region text + notes region text + orphan reference texts for that page.

**Prompt essence:**
"Here is slide content from a pharma deck and references that apply to this slide but have no superscript citations. Identify specific statements in the slide content that these references likely support. For each: the exact claim text, its approximate location (as % of page dimensions), which reference number supports it, what type of evidence you'd expect to find (statistical data, mechanism description, safety finding, etc.), and your confidence (0-1). Return strict JSON."

**Output shape:**
```json
{
  "discovered_claims": [
    {
      "text": "GBS is the most common cause of acute flaccid paralysis",
      "position_hint": { "x": 15.2, "y": 22.1 },
      "reference_index": 0,
      "evidence_type_expected": "text",
      "confidence": 0.92
    }
  ]
}
```

### Pass 2: Evidence Location (Gemini Pro)

Reuses existing infrastructure from evidence suggestion pipeline:

1. **`evidence_candidates.py`** — extracts scored candidates from the reference PDF using the claim text as query
2. **Gemini Pro reranker** — selects best 1-2 evidence regions from the shortlist

Same pattern as `evidenceController.js` lines 71-87: `execFileAsync(PYTHON_BIN, [CANDIDATES_SCRIPT, pdfPath, '--claim', claimText, '--top-k', '30'])` → parse JSON → Gemini rerank.

**Output per child claim:**
```json
{
  "page_number": 8,
  "type": "text",
  "rects": [{ "x0": 120, "y0": 244, "x1": 420, "y1": 262 }],
  "snippet": "GBS is the leading cause of acute flaccid paralysis globally...",
  "rationale": "Direct statement matching the claim"
}
```

## Data Model

### Enriched Global Annotation (backend response)

```js
{
  id: "pymupdf-g-2-0",
  text: "GBS incidence data across regions",
  globalSpot: true,
  globalReason: "orphan-slide-reference",
  references: [{ number: 1, text: "Leonhard SE et al...", id: 42 }],
  childClaims: [
    {
      id: "pymupdf-gc-2-0-0",
      text: "GBS is the most common cause of acute flaccid paralysis",
      position: { x: 15.2, y: 22.1 },
      source: "global-deep-link",
      confidence: 0.92,
      reference_id: 42,
      evidence: {
        page_number: 8,
        type: "text",
        rects: [{ x0: 120, y0: 244, x1: 420, y1: 262 }],
        snippet: "GBS is the leading cause of...",
        rationale: "Direct statement of GBS as most common cause"
      }
    }
  ]
}
```

### Frontend Transform

In `transformPyMuPDFResults()` (MKG3ClaimsDetector.jsx:180-200), global annotations already get processed. Add `childClaims` pass-through — no transform needed since the backend returns them in annotation-compatible format.

## UI Changes

### MKGClaimCard — Expandable Child Claims

When `claim.childClaims` exists:

1. Show count badge next to "Global" badge: "3 claims linked"
2. Expand/collapse toggle (chevron icon)
3. Expanded state: each child claim renders as a sub-row:
   - Claim text (truncated)
   - Evidence badge: page number + type icon (Text/Figure/Table)
   - Click badge → opens ReferenceViewer at that page with highlight rects

### ReferenceViewer — Already Supports This

`ReferenceViewer` already accepts `page` prop (line 27, line 29) and navigates to it via useEffect (lines 242-245). No changes needed for opening to a specific page.

For highlight rects: accepted evidence already renders as red boxes. The child claim's evidence can be passed as temporary highlight rects or as accepted evidence.

## File Changes

### New files (1)
- `backend/src/services/globalAnnotationLinker.js` — orchestrates two-pass AI pipeline

### Modified files (4)
- `backend/src/controllers/pymupdfController.js` — call globalAnnotationLinker after PyMuPDF, enrich response
- `app/src/components/mkg/MKGClaimCard.jsx` — expandable child claims section under global cards
- `app/src/components/mkg/MKGClaimCard.module.css` — child claim row styles + evidence badge
- `app/src/pages/MKG3ClaimsDetector.jsx` — pass child claims through transform, wire evidence click → ReferenceViewer

### Untouched
- `scripts/pymupdf_poc.py` — orphan detection unchanged
- `scripts/evidence_candidates.py` — reused as-is for Pass 2
- `ReferenceViewer.jsx` — already handles page navigation
- `evidenceController.js` — no changes, linker calls same patterns
- Database schema — no new tables; child claims are inline

## Cost & Latency

- **Per global annotation:** ~$0.02-0.05 (Flash Lite claim discovery + Pro evidence location)
- **Typical deck:** 3-5 global annotations → $0.06-0.25 total
- **Latency:** PyMuPDF (1s) + claim discovery (2-3s) + evidence location parallelized (3-5s) ≈ **6-8s total**
- **Zero cost** when no global annotations exist (pipeline skipped)

## Edge Cases

| Case | Handling |
|------|----------|
| No orphan references | Pipeline skipped entirely, zero cost |
| Orphan reference but no matchable claims | `childClaims: []`, global annotation shows as today |
| Reference PDF not in library | Skip Pass 2, child claim has no evidence |
| AI finds 0 evidence for a claim | Child claim shows with "No evidence found" status |
| Multiple orphan refs on same page | Each gets independent claim discovery |
| Claim matches multiple references | One child claim per reference match |
| Gemini API key not configured | Pipeline skipped, global annotations show as today (graceful degradation) |

## Future Enhancements (Out of Scope)

- Child claim pins on ClaimPinsOverlay (smaller, different color)
- Reviewer feedback on child claims (approve/reject the AI-discovered link)
- Confidence threshold filter in settings
- Batch re-analysis of global annotations after reference library changes
