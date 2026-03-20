# Evidence Suggestion + Approval Workflow

**Date:** March 19, 2026
**Branch:** newworkflow
**Depends on:** PyMuPDF pipeline (already built), ReferenceViewer (already built)
**Goal:** When a reviewer opens a source PDF from a claim, suggest up to 6 candidate evidence regions using deterministic parsing + Gemini reranking. Reviewer accepts, rejects, or draws their own red box.

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Trigger | On-demand "Suggest Evidence" button inside ReferenceViewer | Keeps PDF open fast, user controls when AI runs |
| Pipeline location | All backend — single Express endpoint | Consistent with /mkg3 pattern, no frontend AI calls |
| Gemini calls | Two: flash-lite decomposes claim, 2.5-pro reranks | Cheap decomposition gives reranker better signal |
| Layout | PDF left, 320px suggestion sidebar right | PDF is the star, cards don't need much width |
| Manual box | Explicit draw mode toggle | Avoids conflict with pan/zoom |
| Existing markers | Replaced entirely | Source PDFs typically have no pre-existing highlights |
| Persistence | Two tables: evidence_suggestions + accepted_evidence | Clean rendering query + debug trail for bad suggestions |
| Models | gemini-2.5-pro (rerank), gemini-2.5-flash-lite (decompose) | Stable model family, good structured output |

## Architecture

### Backend Pipeline: `POST /api/evidence-suggestions`

Request:
```json
{
  "claim_text": "Drug X reduced risk by 22%...",
  "claim_id": "pymupdf-2-0",
  "reference_id": 42
}
```

Steps:
1. Look up reference PDF path from `reference_documents` table
2. Call `scripts/evidence_candidates.py <pdf_path> --claim "..." --top-k 30` via `child_process.execFile`
3. Python script: PyMuPDF extracts all text blocks with bboxes, classifies block types, scores against claim (65% token overlap + 35% numeric overlap), returns top 30
4. Call Gemini 2.5 Flash Lite — decompose claim into structured fields (drug names, endpoints, population, numerics, etc.)
5. Call Gemini 2.5 Pro — rerank 30 candidates to best 6 with support strength + rationale
6. Save all 6 to `evidence_suggestions` table (with raw debug data)
7. Return 6 suggestion objects

Response:
```json
{
  "suggestions": [
    {
      "suggestion_id": "es_001",
      "claim_id": "pymupdf-2-0",
      "source_pdf_id": 42,
      "page_number": 8,
      "type": "text",
      "rects": [{"x0": 120.1, "y0": 244.3, "x1": 420.8, "y1": 262.0}],
      "text": "Hazard ratio for progression was 0.78...",
      "score": 0.93,
      "support_strength": "direct_support",
      "rationale": "Contains the quantitative statistic corresponding to 22% risk reduction.",
      "status": "suggested",
      "origin": "rules_plus_ai"
    }
  ]
}
```

### Additional Endpoints

```
GET    /api/evidence/accepted?claim_id=X&reference_id=Y  — fetch saved red boxes on mount
PATCH  /api/evidence-suggestions/:id                     — accept or reject { "status": "accepted"|"rejected" }
POST   /api/evidence/manual                              — save manual drawn box
```

### Python Script: `scripts/evidence_candidates.py`

```
scripts/.venv/bin/python3 scripts/evidence_candidates.py <pdf_path> --claim "..." --top-k 30 --pretty
```

1. Opens PDF with PyMuPDF, extracts all text blocks with bounding boxes per page
2. Classifies each block as text|table|figure|caption|chart based on layout heuristics
3. Scores each block against claim: 65% keyword token overlap + 35% numeric term overlap
4. Returns top 30 candidates as JSON to stdout

Different from `pymupdf_poc.py`: that script parses slide/notes regions on the uploaded analysis document. This script parses reference PDFs (published papers, PIs). No slide/notes split, no superscript detection.

## Database Schema

Migration: `backend/migrations/006_evidence_suggestions.sql`

```sql
CREATE TABLE evidence_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id TEXT UNIQUE NOT NULL,
  claim_id TEXT NOT NULL,
  reference_id INTEGER NOT NULL,
  page_number INTEGER NOT NULL,
  type TEXT NOT NULL,
  rects JSON NOT NULL,
  text TEXT,
  score REAL NOT NULL,
  support_strength TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'suggested',
  origin TEXT NOT NULL DEFAULT 'rules_plus_ai',
  raw_shortlist JSON,
  raw_gemini_response JSON,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (reference_id) REFERENCES reference_documents(id)
);

CREATE TABLE accepted_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_id TEXT UNIQUE NOT NULL,
  claim_id TEXT NOT NULL,
  reference_id INTEGER NOT NULL,
  page_number INTEGER NOT NULL,
  type TEXT NOT NULL,
  rects JSON NOT NULL,
  text TEXT,
  origin TEXT NOT NULL,
  suggestion_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (reference_id) REFERENCES reference_documents(id)
);
```

## Frontend: ReferenceViewer Changes

### Layout (when suggestions active)
```
┌─────────────────────────────────────────────────────────┐
│  [< Page 8 of 24 >]  [Zoom]  [Suggest Evidence]  [X]   │
├──────────────────────────────────────┬──────────────────┤
│                                      │  Suggestion 1    │
│                                      │  "direct_support"│
│          PDF Canvas                  │  snippet...      │
│          (red boxes on accepted)     │  [Accept][Reject]│
│                                      │                  │
│                                      │  Suggestion 2    │
│                                      │  snippet...      │
│                                      │  [Accept][Reject]│
│                                      │                  │
│                                      │  ─────────────── │
│                                      │  [Draw Box]      │
└──────────────────────────────────────┴──────────────────┘
```

### States
1. **Initial open** — full-width PDF. Query accepted_evidence. If any, render red boxes. "Suggest Evidence" button in toolbar.
2. **Loading** — spinner, sidebar slides in with skeleton cards.
3. **Suggestions loaded** — up to 6 cards with snippet, strength badge, rationale, Accept/Reject. Click card → scroll to page + highlight region.
4. **Accept** — solid red box on PDF, card shows accepted, saved to backend.
5. **Reject** — card dims/collapses, status saved.
6. **Draw mode** — "Draw Box" button, crosshair cursor, drag rectangle, confirm, save as manual evidence.

### Props change
Replace `markers` prop with `claimId` + `referenceId`. ReferenceViewer fetches accepted evidence on mount.

## Gemini Prompts

### Claim Decomposition (flash-lite)
Extract structured fields: drug_names[], endpoint_terms[], population_terms[], comparator_terms[], numeric_terms[], temporal_terms[], study_terms[], normalized_claim. Strict JSON only.

### Candidate Reranking (2.5-pro)
Given claim text + structured metadata + 30 candidate regions: select best 6, label support_strength (direct|partial|weak), score 0-1, one-line rationale. No near-duplicates from same paragraph. Strict JSON only.

## File Changes

### New files (6)
- `scripts/evidence_candidates.py` — PyMuPDF parse + deterministic shortlist
- `backend/migrations/006_evidence_suggestions.sql` — two new tables
- `backend/src/controllers/evidenceController.js` — 4 endpoints
- `backend/src/routes/evidence.js` — route definitions
- `backend/src/models/EvidenceSuggestion.js` — DB model
- `backend/src/models/AcceptedEvidence.js` — DB model

### Modified files (3)
- `backend/server.js` — register evidence routes
- `app/src/components/mkg/ReferenceViewer/ReferenceViewer.jsx` — split-panel, sidebar, draw mode, red boxes, drop markers
- `app/src/pages/MKG3ClaimsDetector.jsx` — pass claimId + referenceId instead of markers, remove marker fetching

### Deprecated
- Marker extraction calls (api.fetchReferenceMarkers, extract_markers.py invocations) no longer called
- `scripts/extract_markers.py` stays on disk, nothing calls it

### Untouched
- MKGClaimCard, PDFViewer, pymupdf_poc.py, claim detection, brand library, all existing backend models

## Handoff Reference

Source package: `evidence_suggestion_ai_handoff.zip`
- Schemas: `evidence_suggestion.schema.json`, `accepted_evidence.schema.json`
- Prompts: `claim_decomposition_prompt.md`, `rerank_candidates_prompt.md`
- Python stubs: `candidate_region_extractor.py`, `deterministic_shortlist.py`
- Example payloads: `gemini_rerank_payload_example.json`, `suggestions.example.json`
