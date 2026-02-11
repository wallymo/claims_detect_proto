# Reference Fact Sheet Indexing

**Date:** 2026-02-11
**Status:** Implemented (all 4 sprints complete)
**Purpose:** Pre-extract substantiable facts from each reference document so detection and matching prompts have grounded knowledge of what references contain.

## Problem

The detection AI doesn't know what references contain. It receives a promotional PDF and must identify claims, but has no context about what facts exist in the brand's reference library. This causes it to miss granular claims (specific data points, mechanism details, statistical findings) that a reviewer would catch.

The matching pipeline has the same blind spot: it keyword-filters then sends raw text excerpts to Gemini. Structured facts would enable faster, more precise matching.

## Solution

Extract a structured JSON inventory of substantiable facts from each reference on upload. Feed this condensed inventory into detection prompts and add a fast-path fact lookup to the matching pipeline.

## Database Schema

New migration: `002_reference_facts.sql`

```sql
CREATE TABLE IF NOT EXISTS reference_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_id INTEGER NOT NULL UNIQUE,
  facts_json TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  confirmed_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  model_used TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reference_id) REFERENCES reference_documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_reference_facts_reference_id ON reference_facts(reference_id);
CREATE INDEX idx_reference_facts_status ON reference_facts(extraction_status);
```

One row per reference. `facts_json` stores a JSON array:

```json
[
  {
    "id": "fact_001",
    "text": "XCOPRI showed 47% reduction in seizure frequency vs placebo (p<0.001, N=1,200)",
    "category": "efficacy",
    "keywords": ["47%", "seizure frequency", "placebo", "p<0.001"],
    "page": 3
  }
]
```

**Fact categories:** `efficacy`, `safety`, `dosage`, `mechanism`, `population`, `endpoint`, `statistical`, `regulatory`

## Backend: Fact Extraction Service

New file: `backend/src/services/factExtractor.js`

### Responsibilities

1. Accept a reference's `content_text` (already in DB from upload)
2. Send to Gemini (`gemini-3-pro-preview`) with a pharma-tuned extraction prompt
3. Parse structured JSON response
4. Handle chunking for long documents (split into ~8K token windows with overlap)
5. Return facts array or error

### Extraction Prompt Design

The prompt instructs Gemini to:
- Extract every substantiable statement: statistics, efficacy data, safety findings, dosage info, mechanism of action, population details, endpoint definitions
- Categorize each fact
- Extract searchable keywords per fact
- Note approximate page number
- Flag annotation markers (dagger, double dagger, asterisk, section mark) as separate facts
- Combine related statements if they reference the same data point

### Error Handling

- If extraction fails, set `extraction_status = 'failed'` and store `error_message`
- Failed references can be retried via batch script or API
- Extraction never blocks the upload response

### API Key

Backend needs `GEMINI_API_KEY` in `backend/.env.local`. Uses `@google/genai` SDK.

## New API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /api/brands/:brandId/references/:refId/facts` | GET | Fetch extracted facts for a reference |
| `POST /api/references/:refId/facts/extract` | POST | Trigger fact extraction for one reference |
| `GET /api/brands/:brandId/facts/summary` | GET | Fact counts + status for all refs in a brand |
| `PATCH /api/facts/:factId/feedback` | PATCH | Confirm or reject a specific fact |

### Updated Existing Endpoints

`GET /api/brands/:brandId/references` response adds per-reference:
```json
{
  "extraction_status": "indexed",
  "facts_count": 47
}
```

## Backend: Model + Controller

### ReferenceFact Model (`backend/src/models/ReferenceFact.js`)

- `findByReferenceId(refId)` — Get facts for a reference
- `findByBrandId(brandId)` — Get all facts for a brand (for detection prompt)
- `createOrUpdate(refId, factsJson, status, model)` — Upsert extraction result
- `updateStatus(refId, status, errorMessage)` — Update extraction status
- `updateFeedback(refId, factId, decision)` — Increment confirmed/rejected count
- `getSummaryByBrandId(brandId)` — Lightweight: status + count per reference

### Fact Controller (`backend/src/controllers/factController.js`)

Wires API endpoints to model methods. Handles validation, error responses.

### Route Registration (`backend/src/routes/factRoutes.js`)

Registers all fact endpoints on the Express router.

## Batch Script: `backend/scripts/index-references.js`

### Behavior

1. Query all references where `reference_facts` row is missing or `extraction_status = 'failed'`
2. Process sequentially (avoids Gemini rate limits)
3. For each: read `content_text` from DB, call factExtractor, store result
4. Log progress: `Indexing 3/54: XCOPRI_PI.pdf... 47 facts extracted`
5. Skip already-indexed references (safe to re-run)

### Flags

- `--force` — Re-index all references (even already indexed)
- `--brand <name>` — Index only one brand's references

## Frontend: UI Changes

### Library Tab — Reference Cards

- While indexing: "Indexing..." label on card
- Indexed: no badge (clean default — indexed is the norm)
- Failed: "Index failed" with retry button

No fact count displayed on cards (keeps UI clean).

### Detection Prompt Enhancement

When "Detect Claims" is clicked on MKG2:

1. Fetch condensed fact inventory: `GET /api/brands/:brandId/facts/summary` (or a new endpoint that returns all facts as a condensed string)
2. Append to detection prompt in all 3 AI services (gemini.js, openai.js, anthropic.js):

```
REFERENCE FACT INVENTORY (use these known facts to identify substantiable claims):
- [XCOPRI PI] 47% seizure reduction (p<0.001, N=1,200) | efficacy
- [XCOPRI PI] Most common adverse reaction: dizziness (12%) | safety
- [XCOPRI PI] Recommended starting dose: 12.5 mg once daily | dosage
...
```

3. This gives the AI grounded knowledge of what the brand's references actually contain

### Matching Pipeline — Tier 0 Fast Path

New step in `referenceMatching.js` before existing pipeline:

```
Claim Text
    |
Tier 0: Direct Fact Lookup (NEW)
    |-- Compare claim keywords against fact keywords
    |-- If high overlap: return matched reference immediately
    |-- If no match: fall through
    |
Tier 1: Keyword Pre-Filter (existing)
    |
Tier 2: AI Matching (existing)
```

## Upload Flow Changes

When a new reference is uploaded via `POST /api/brands/:brandId/references`:

1. (Existing) File saved, text extracted, reference created in DB
2. (New) Create `reference_facts` row with `extraction_status: 'pending'`
3. (New) Kick off async fact extraction (non-blocking)
4. (Existing) Return 201 response immediately
5. (New) Background: factExtractor processes text, updates row to `indexed` or `failed`

## Implementation Order

### Sprint 1: Backend Foundation
1. Migration `002_reference_facts.sql`
2. ReferenceFact model
3. factExtractor service (Gemini integration)
4. Fact controller + routes
5. Update reference list endpoint to include extraction_status + facts_count

### Sprint 2: Batch Indexing
1. `index-references.js` batch script
2. Run against all 54 existing references
3. Verify facts quality (spot-check 5-10 references)

### Sprint 3: Frontend Integration
1. Update Library tab with indexing status badges
2. Add fact inventory to detection prompts (all 3 AI services)
3. Add Tier 0 fact lookup to referenceMatching.js
4. Wire up new upload flow (auto-index on upload)

### Sprint 4: Feedback Loop
1. Fact feedback UI (confirm/reject per fact)
2. PATCH endpoint for feedback
3. Weight confirmed facts higher in matching
