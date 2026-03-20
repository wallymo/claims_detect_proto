# Evidence Suggestion Workflow — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a reviewer opens a source PDF from a claim, an on-demand "Suggest Evidence" button runs a backend pipeline (PyMuPDF parse → deterministic shortlist → Gemini rerank) and presents up to 6 candidate evidence regions. Reviewer accepts, rejects, or draws their own red box.

**Architecture:** Backend-only pipeline via a new Express endpoint. Python script extracts + shortlists candidate regions from the reference PDF. Express controller calls Gemini twice (flash-lite for claim decomposition, 2.5-pro for reranking). Frontend ReferenceViewer gains a split-panel layout with suggestion sidebar. Two new SQLite tables persist suggestions and accepted evidence.

**Tech Stack:** PyMuPDF (Python), Express + better-sqlite3 (backend), @google/genai SDK (Gemini), React + pdf.js (frontend), CSS Modules

**Design doc:** `docs/plans/2026-03-19-evidence-suggestion-design.md`

---

## Task 1: Database Migration

**Files:**
- Create: `backend/migrations/016_evidence_suggestions.sql`
- Modify: `backend/src/config/database.js:135-139` (add migration 016 registration)

**Step 1: Write the migration SQL**

Create `backend/migrations/016_evidence_suggestions.sql`:

```sql
-- Evidence suggestion pipeline: AI-suggested evidence regions from source PDFs
CREATE TABLE IF NOT EXISTS evidence_suggestions (
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

CREATE INDEX IF NOT EXISTS idx_evidence_suggestions_claim_ref
  ON evidence_suggestions(claim_id, reference_id);

-- Accepted evidence: persisted red boxes from accepted suggestions + manual user draws
CREATE TABLE IF NOT EXISTS accepted_evidence (
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

CREATE INDEX IF NOT EXISTS idx_accepted_evidence_claim_ref
  ON accepted_evidence(claim_id, reference_id);
```

**Step 2: Register migration in database.js**

In `backend/src/config/database.js`, after the migration 015 block (around line 138), add:

```javascript
  // 016: evidence suggestion pipeline tables
  const migration016Path = path.resolve(__dirname, '../../migrations/016_evidence_suggestions.sql')
  const migration016 = fs.readFileSync(migration016Path, 'utf-8')
  db.exec(migration016)
```

**Step 3: Verify migration runs**

Run: `cd backend && npm run dev`

Expected: Server starts without errors, "Database initialized" message prints. Check SQLite:

```bash
cd backend && node -e "
  import Database from 'better-sqlite3';
  const db = new Database('data/claims_detector.db');
  console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%evidence%'\").all());
  db.close();
"
```

Expected: `[{ name: 'evidence_suggestions' }, { name: 'accepted_evidence' }]`

**Step 4: Commit**

```bash
git add backend/migrations/016_evidence_suggestions.sql backend/src/config/database.js
git commit -m "feat: add evidence_suggestions + accepted_evidence tables (migration 016)"
```

---

## Task 2: Backend Models

**Files:**
- Create: `backend/src/models/EvidenceSuggestion.js`
- Create: `backend/src/models/AcceptedEvidence.js`

**Step 1: Write EvidenceSuggestion model**

Create `backend/src/models/EvidenceSuggestion.js`:

```javascript
import { getDb } from '../config/database.js'

export const EvidenceSuggestion = {
  bulkCreate(suggestions, debugData = {}) {
    const db = getDb()
    const stmt = db.prepare(`
      INSERT INTO evidence_suggestions
        (suggestion_id, claim_id, reference_id, page_number, type, rects, text,
         score, support_strength, rationale, status, origin, raw_shortlist, raw_gemini_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', 'rules_plus_ai', ?, ?)
    `)
    const insert = db.transaction((rows) => {
      for (const s of rows) {
        stmt.run(
          s.suggestion_id, s.claim_id, s.reference_id, s.page_number,
          s.type, JSON.stringify(s.rects), s.text,
          s.score, s.support_strength, s.rationale,
          debugData.raw_shortlist ? JSON.stringify(debugData.raw_shortlist) : null,
          debugData.raw_gemini_response ? JSON.stringify(debugData.raw_gemini_response) : null
        )
      }
    })
    insert(suggestions)
    return suggestions
  },

  findByClaimAndRef(claimId, referenceId) {
    const db = getDb()
    return db.prepare(`
      SELECT * FROM evidence_suggestions
      WHERE claim_id = ? AND reference_id = ?
      ORDER BY score DESC
    `).all(claimId, referenceId)
  },

  updateStatus(suggestionId, status) {
    const db = getDb()
    db.prepare(`
      UPDATE evidence_suggestions SET status = ? WHERE suggestion_id = ?
    `).run(status, suggestionId)
    return db.prepare('SELECT * FROM evidence_suggestions WHERE suggestion_id = ?').get(suggestionId)
  }
}
```

**Step 2: Write AcceptedEvidence model**

Create `backend/src/models/AcceptedEvidence.js`:

```javascript
import { getDb } from '../config/database.js'

export const AcceptedEvidence = {
  create({ evidence_id, claim_id, reference_id, page_number, type, rects, text, origin, suggestion_id }) {
    const db = getDb()
    db.prepare(`
      INSERT INTO accepted_evidence
        (evidence_id, claim_id, reference_id, page_number, type, rects, text, origin, suggestion_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      evidence_id, claim_id, reference_id, page_number,
      type, JSON.stringify(rects), text, origin, suggestion_id || null
    )
    return db.prepare('SELECT * FROM accepted_evidence WHERE evidence_id = ?').get(evidence_id)
  },

  findByClaimAndRef(claimId, referenceId) {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM accepted_evidence
      WHERE claim_id = ? AND reference_id = ?
      ORDER BY page_number, created_at
    `).all(claimId, referenceId)
    return rows.map(r => ({ ...r, rects: JSON.parse(r.rects) }))
  },

  delete(evidenceId) {
    const db = getDb()
    db.prepare('DELETE FROM accepted_evidence WHERE evidence_id = ?').run(evidenceId)
  }
}
```

**Step 3: Commit**

```bash
git add backend/src/models/EvidenceSuggestion.js backend/src/models/AcceptedEvidence.js
git commit -m "feat: add EvidenceSuggestion + AcceptedEvidence data models"
```

---

## Task 3: Python Script — evidence_candidates.py

**Files:**
- Create: `scripts/evidence_candidates.py`

**Reference files to study:**
- `scripts/pymupdf_poc.py` — existing PyMuPDF pattern, argparse, JSON output
- Handoff stubs: `candidate_region_extractor.py`, `deterministic_shortlist.py` (in the zip)

**Step 1: Write the script**

Create `scripts/evidence_candidates.py`. This script:
1. Opens a reference PDF with PyMuPDF
2. Extracts all text blocks with bounding boxes (using `page.get_text("blocks")`)
3. Classifies block types by heuristics (table-like if many `|` chars or tab-separated columns, caption if short + starts with "Figure"/"Table", heading if bold + short, else text)
4. Scores each block against the claim using token overlap (65%) + numeric overlap (35%)
5. Returns top-k candidates as JSON to stdout

```python
#!/usr/bin/env python3
"""
Evidence candidate extractor: parse a reference PDF into candidate regions,
score them against a claim, and return the top-k shortlist as JSON.

Usage:
    scripts/.venv/bin/python3 scripts/evidence_candidates.py <pdf_path> --claim "claim text" --top-k 30 --pretty
"""

import argparse
import json
import re
import sys

import pymupdf


def normalize(text):
    return re.sub(r"\s+", " ", text.lower()).strip()


def extract_terms(claim):
    claim_n = normalize(claim)
    tokens = sorted(set(t for t in re.findall(r"[a-zA-Z0-9\-%\.]+", claim_n) if len(t) > 2))
    numeric = sorted(set(re.findall(
        r"\b\d+(?:\.\d+)?%?|hr\s*0?\.\d+|p\s*[<=>]\s*0?\.\d+\b", claim_n
    )))
    return {"tokens": tokens, "numeric": numeric}


def score_candidate(claim_terms, candidate_text):
    text_n = normalize(candidate_text)
    token_hits = sum(1 for t in claim_terms["tokens"] if t in text_n)
    numeric_hits = sum(1 for n in claim_terms["numeric"] if n in text_n)
    token_score = min(token_hits / max(len(claim_terms["tokens"]), 1), 1.0)
    numeric_score = (
        min(numeric_hits / max(len(claim_terms["numeric"]), 1), 1.0)
        if claim_terms["numeric"]
        else 0.0
    )
    return round(0.65 * token_score + 0.35 * numeric_score, 4)


def classify_block(text, rect, page_width, page_height):
    """Heuristic block type classification."""
    x0, y0, x1, y1 = rect
    width_ratio = (x1 - x0) / page_width if page_width else 0
    text_stripped = text.strip()
    lines = text_stripped.split("\n")

    # Caption: short text starting with Figure/Table/Chart
    if len(text_stripped) < 200 and re.match(
        r"^(figure|table|chart|fig\.?)\s", text_stripped, re.IGNORECASE
    ):
        return "caption"

    # Table heuristic: multiple lines with tab/pipe alignment or many numeric cells
    pipe_lines = sum(1 for l in lines if "|" in l)
    tab_lines = sum(1 for l in lines if "\t" in l)
    if len(lines) >= 3 and (pipe_lines >= len(lines) * 0.5 or tab_lines >= len(lines) * 0.5):
        return "table"

    # Heading: short, typically bold (we can't check bold from blocks API, use length)
    if len(text_stripped) < 80 and len(lines) <= 2 and width_ratio < 0.7:
        return "heading"

    return "text"


def extract_candidate_regions(pdf_path, claim, top_k=30):
    doc = pymupdf.open(pdf_path)
    candidates = []
    region_index = 1
    claim_terms = extract_terms(claim)

    for page_number in range(len(doc)):
        page = doc[page_number]
        pw, ph = page.rect.width, page.rect.height
        blocks = page.get_text("blocks")

        for block in blocks:
            x0, y0, x1, y1, text, block_no, block_type = block
            # block_type 1 = image, skip
            if block_type == 1:
                candidates.append({
                    "candidate_id": f"cand_{region_index:04d}",
                    "page_number": page_number + 1,
                    "type": "figure",
                    "rects": [{"x0": round(x0, 1), "y0": round(y0, 1),
                               "x1": round(x1, 1), "y1": round(y1, 1)}],
                    "text": None,
                    "pre_score": 0.0,
                })
                region_index += 1
                continue

            text = (text or "").strip()
            if not text or len(text) < 10:
                continue

            block_type_label = classify_block(text, (x0, y0, x1, y1), pw, ph)
            pre_score = score_candidate(claim_terms, text)

            candidates.append({
                "candidate_id": f"cand_{region_index:04d}",
                "page_number": page_number + 1,
                "type": block_type_label,
                "rects": [{"x0": round(x0, 1), "y0": round(y0, 1),
                           "x1": round(x1, 1), "y1": round(y1, 1)}],
                "text": text,
                "pre_score": pre_score,
            })
            region_index += 1

    # Sort by pre_score descending, keep top_k
    candidates.sort(key=lambda c: c["pre_score"], reverse=True)
    shortlisted = candidates[:top_k]

    return {
        "candidates": shortlisted,
        "total_extracted": region_index - 1,
        "shortlisted": len(shortlisted),
    }


def main():
    parser = argparse.ArgumentParser(description="Extract evidence candidate regions from a PDF")
    parser.add_argument("pdf_path", help="Path to the reference PDF")
    parser.add_argument("--claim", required=True, help="Claim text to score against")
    parser.add_argument("--top-k", type=int, default=30, help="Number of top candidates to return")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")

    args = parser.parse_args()
    result = extract_candidate_regions(args.pdf_path, args.claim, args.top_k)

    indent = 2 if args.pretty else None
    json.dump(result, sys.stdout, indent=indent)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
```

**Step 2: Test the script standalone**

Pick any reference PDF from the library and run:

```bash
scripts/.venv/bin/python3 scripts/evidence_candidates.py \
  "References/References/Leonhard SE - Nat Rev Dis Primers - 2019.pdf" \
  --claim "GBS is the most common cause of acute flaccid paralysis worldwide" \
  --top-k 10 --pretty
```

Expected: JSON with `candidates` array, each having `candidate_id`, `page_number`, `type`, `rects`, `text`, `pre_score`. Top candidates should have relevant text about GBS/flaccid paralysis.

**Step 3: Commit**

```bash
git add scripts/evidence_candidates.py
git commit -m "feat: add evidence_candidates.py — PyMuPDF parse + deterministic shortlist"
```

---

## Task 4: Backend Controller + Routes

**Files:**
- Create: `backend/src/controllers/evidenceController.js`
- Create: `backend/src/routes/evidence.js`
- Modify: `backend/src/routes/index.js:1-16` (add import) and `:23-42` (add route registration)

**Reference files to study:**
- `backend/src/controllers/pymupdfController.js` — pattern for calling Python via execFile
- `backend/src/services/factExtractor.js` — pattern for Gemini SDK calls (@google/genai)
- Handoff prompts: `claim_decomposition_prompt.md`, `rerank_candidates_prompt.md`

**Step 1: Write the evidence controller**

Create `backend/src/controllers/evidenceController.js`:

```javascript
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { GoogleGenAI } from '@google/genai'
import { AppError } from '../middleware/errorHandler.js'
import { Reference } from '../models/Reference.js'
import { EvidenceSuggestion } from '../models/EvidenceSuggestion.js'
import { AcceptedEvidence } from '../models/AcceptedEvidence.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_BIN = path.join(PROJECT_ROOT, 'scripts/.venv/bin/python3')
const CANDIDATES_SCRIPT = path.join(PROJECT_ROOT, 'scripts/evidence_candidates.py')

function getGeminiClient() {
  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) throw new AppError('VITE_GEMINI_API_KEY not set', 500)
  return new GoogleGenAI({ apiKey })
}

function stripCodeFences(text) {
  return text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
}

async function decomposeClaimWithGemini(ai, claimText) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-lite',
    contents: `You extract structured claim metadata for an evidence retrieval workflow.

Given the following claim, extract the following fields and return strict JSON only:
- drug_names[]
- endpoint_terms[]
- population_terms[]
- comparator_terms[]
- numeric_terms[]
- temporal_terms[]
- study_terms[]
- normalized_claim

Claim:
${claimText}

Return JSON only.`,
    config: { temperature: 0, topP: 0.1, topK: 1 }
  })
  return JSON.parse(stripCodeFences(response.text.trim()))
}

async function rerankCandidatesWithGemini(ai, claimText, claimMetadata, candidates) {
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: `You are ranking candidate evidence regions from a source PDF for a human review workflow.
You do not invent evidence.
You only select from the candidates provided.
Return strict JSON only.

Claim:
${claimText}

Structured claim metadata:
${JSON.stringify(claimMetadata)}

Candidate regions:
${JSON.stringify(candidates)}

Task:
Select the best 6 candidate regions that could support the claim.
Prefer direct support, but include diverse useful candidates when appropriate.
Do not return 6 near-duplicates from the same paragraph.
For each selected candidate, return:
- candidate_id
- support_strength (direct_support | partial_support | weak_support)
- score (0 to 1)
- rationale (1 sentence)

Return JSON in this shape:
{
  "selected": [
    {
      "candidate_id": "cand_0001",
      "support_strength": "direct_support",
      "score": 0.93,
      "rationale": "..."
    }
  ]
}

Return JSON only.`,
    config: { temperature: 0, topP: 0.1, topK: 1 }
  })
  return JSON.parse(stripCodeFences(response.text.trim()))
}

export const evidenceController = {
  /**
   * POST /api/evidence-suggestions
   * Full pipeline: parse PDF → shortlist → decompose claim → rerank → save → return
   */
  async generateSuggestions(req, res, next) {
    try {
      const { claim_text, claim_id, reference_id } = req.body
      if (!claim_text || !claim_id || !reference_id) {
        throw new AppError('claim_text, claim_id, and reference_id are required', 400)
      }

      // Look up reference PDF path
      const ref = Reference._findByIdFull(reference_id)
      if (!ref) throw new AppError('Reference document not found', 404)
      if (!ref.file_path || !fs.existsSync(ref.file_path)) {
        throw new AppError('Reference PDF file not found on disk', 404)
      }

      // Step 1: Parse PDF + deterministic shortlist via Python
      if (!fs.existsSync(PYTHON_BIN)) {
        throw new AppError('Python venv not found. Run: python3 -m venv scripts/.venv && scripts/.venv/bin/pip install -r scripts/requirements.txt', 500)
      }

      const { stdout, stderr } = await execFileAsync(
        PYTHON_BIN,
        [CANDIDATES_SCRIPT, ref.file_path, '--claim', claim_text, '--top-k', '30'],
        { maxBuffer: 50 * 1024 * 1024, timeout: 30_000 }
      )
      if (stderr) console.warn('evidence_candidates.py stderr:', stderr)

      const candidateResult = JSON.parse(stdout)
      const candidates = candidateResult.candidates

      if (!candidates || candidates.length === 0) {
        return res.json({ suggestions: [] })
      }

      // Step 2: Gemini claim decomposition (flash-lite)
      const ai = getGeminiClient()
      let claimMetadata
      try {
        claimMetadata = await decomposeClaimWithGemini(ai, claim_text)
      } catch (err) {
        console.error('Claim decomposition failed:', err.message)
        // Fallback: proceed without structured metadata
        claimMetadata = { normalized_claim: claim_text }
      }

      // Step 3: Gemini reranking (2.5-pro)
      const rerankResult = await rerankCandidatesWithGemini(ai, claim_text, claimMetadata, candidates)
      const selected = rerankResult.selected || []

      // Build suggestion objects by merging rerank results with candidate data
      const candidateMap = new Map(candidates.map(c => [c.candidate_id, c]))
      const suggestions = selected.slice(0, 6).map((sel, idx) => {
        const cand = candidateMap.get(sel.candidate_id) || {}
        return {
          suggestion_id: `es_${reference_id}_${claim_id}_${idx + 1}`,
          claim_id,
          reference_id,
          page_number: cand.page_number || 1,
          type: cand.type || 'text',
          rects: cand.rects || [],
          text: cand.text || null,
          score: sel.score || 0,
          support_strength: sel.support_strength || 'weak_support',
          rationale: sel.rationale || null,
          status: 'suggested',
          origin: 'rules_plus_ai',
        }
      })

      // Save to database
      EvidenceSuggestion.bulkCreate(suggestions, {
        raw_shortlist: candidateResult,
        raw_gemini_response: rerankResult,
      })

      res.json({ suggestions })
    } catch (err) {
      if (err.killed) return next(new AppError('Evidence candidate extraction timed out', 504))
      if (err instanceof SyntaxError) return next(new AppError('Invalid JSON from pipeline', 500))
      next(err)
    }
  },

  /**
   * GET /api/evidence/accepted?claim_id=X&reference_id=Y
   * Fetch saved red boxes for a claim+reference pair
   */
  async getAccepted(req, res, next) {
    try {
      const { claim_id, reference_id } = req.query
      if (!claim_id || !reference_id) {
        throw new AppError('claim_id and reference_id query params required', 400)
      }
      const evidence = AcceptedEvidence.findByClaimAndRef(claim_id, Number(reference_id))
      res.json({ evidence })
    } catch (err) {
      next(err)
    }
  },

  /**
   * PATCH /api/evidence-suggestions/:suggestionId
   * Accept or reject a suggestion
   */
  async updateSuggestionStatus(req, res, next) {
    try {
      const { suggestionId } = req.params
      const { status } = req.body
      if (!['accepted', 'rejected'].includes(status)) {
        throw new AppError('status must be "accepted" or "rejected"', 400)
      }

      const updated = EvidenceSuggestion.updateStatus(suggestionId, status)
      if (!updated) throw new AppError('Suggestion not found', 404)

      // If accepting, also create accepted_evidence entry
      if (status === 'accepted') {
        AcceptedEvidence.create({
          evidence_id: `ae_${suggestionId}`,
          claim_id: updated.claim_id,
          reference_id: updated.reference_id,
          page_number: updated.page_number,
          type: updated.type,
          rects: JSON.parse(updated.rects),
          text: updated.text,
          origin: 'suggestion_accepted',
          suggestion_id: suggestionId,
        })
      }

      res.json({ suggestion: updated })
    } catch (err) {
      next(err)
    }
  },

  /**
   * POST /api/evidence/manual
   * Save a manually drawn evidence box
   */
  async createManualEvidence(req, res, next) {
    try {
      const { claim_id, reference_id, page_number, rects, text } = req.body
      if (!claim_id || !reference_id || !page_number || !rects) {
        throw new AppError('claim_id, reference_id, page_number, and rects are required', 400)
      }

      const evidence_id = `ae_manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const created = AcceptedEvidence.create({
        evidence_id,
        claim_id,
        reference_id,
        page_number,
        type: 'manual_box',
        rects,
        text: text || null,
        origin: 'manual_user_box',
      })

      res.status(201).json({ evidence: created })
    } catch (err) {
      next(err)
    }
  },
}
```

**Step 2: Write the routes file**

Create `backend/src/routes/evidence.js`:

```javascript
import { Router } from 'express'
import { evidenceController } from '../controllers/evidenceController.js'

const router = Router()

router.post('/suggestions', evidenceController.generateSuggestions)
router.get('/accepted', evidenceController.getAccepted)
router.patch('/suggestions/:suggestionId', evidenceController.updateSuggestionStatus)
router.post('/manual', evidenceController.createManualEvidence)

export default router
```

**Step 3: Register routes in index.js**

In `backend/src/routes/index.js`:

Add import at the top (after line 16):
```javascript
import evidenceRoutes from './evidence.js'
```

Add route registration (after the pymupdf line, around line 42):
```javascript
  app.use('/api/evidence', evidenceRoutes)
```

**Step 4: Test the endpoint**

Start backend: `cd backend && npm run dev`

Test with curl (use a real reference ID from your DB):

```bash
curl -X POST http://localhost:3001/api/evidence/suggestions \
  -H "Content-Type: application/json" \
  -d '{"claim_text": "GBS is the most common cause of acute flaccid paralysis worldwide", "claim_id": "test-1", "reference_id": 1}'
```

Expected: JSON response with `suggestions` array (up to 6 items). If reference_id 1 doesn't exist, you'll get a 404 — use a valid ID.

Also test the accepted evidence endpoint:

```bash
curl "http://localhost:3001/api/evidence/accepted?claim_id=test-1&reference_id=1"
```

Expected: `{ "evidence": [] }` (empty before any accepts).

**Step 5: Commit**

```bash
git add backend/src/controllers/evidenceController.js backend/src/routes/evidence.js backend/src/routes/index.js
git commit -m "feat: add evidence suggestion backend — pipeline endpoint + accept/reject/manual"
```

---

## Task 5: Frontend API Functions

**Files:**
- Modify: `app/src/services/api.js` (add 4 new functions at the end)

**Step 1: Add API functions**

Append to `app/src/services/api.js` (before the final closing, after the last export):

```javascript
// --- Evidence suggestion pipeline ---

export async function generateEvidenceSuggestions({ claim_text, claim_id, reference_id }) {
  return request('/evidence/suggestions', {
    method: 'POST',
    body: JSON.stringify({ claim_text, claim_id, reference_id }),
  })
}

export async function fetchAcceptedEvidence(claimId, referenceId) {
  return request(`/evidence/accepted?claim_id=${encodeURIComponent(claimId)}&reference_id=${encodeURIComponent(referenceId)}`)
}

export async function updateEvidenceSuggestionStatus(suggestionId, status) {
  return request(`/evidence/suggestions/${encodeURIComponent(suggestionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export async function createManualEvidence({ claim_id, reference_id, page_number, rects, text }) {
  return request('/evidence/manual', {
    method: 'POST',
    body: JSON.stringify({ claim_id, reference_id, page_number, rects, text }),
  })
}
```

**Step 2: Commit**

```bash
git add app/src/services/api.js
git commit -m "feat: add evidence suggestion API client functions"
```

---

## Task 6: ReferenceViewer — Split-Panel Layout + Suggestion Sidebar

This is the largest task. It modifies `ReferenceViewer.jsx` and `ReferenceViewer.module.css` to:
- Accept new props: `claimId`, `claimText`, `referenceId` (replacing `markers`)
- Add "Suggest Evidence" button in toolbar
- Add 320px sidebar with suggestion cards
- Render red bounding boxes for accepted evidence on the PDF canvas
- Add accept/reject handlers that call the backend
- Add draw mode for manual boxes

**Files:**
- Modify: `app/src/components/mkg/ReferenceViewer/ReferenceViewer.jsx` (significant rewrite)
- Modify: `app/src/components/mkg/ReferenceViewer/ReferenceViewer.module.css` (add sidebar styles)

**Step 1: Update ReferenceViewer.jsx**

Replace the entire component. The new version:

- **Props**: `{ referenceId, page, excerpt, claimId, claimText }` — drops `markers`
- **State**: `suggestions`, `acceptedEvidence`, `suggestionsLoading`, `sidebarOpen`, `drawMode`, `drawingRect`
- **On mount**: Fetches accepted evidence via `api.fetchAcceptedEvidence(claimId, referenceId)` if claimId exists
- **"Suggest Evidence" button**: Calls `api.generateEvidenceSuggestions()`, populates suggestions state, opens sidebar
- **Suggestion cards**: Each shows snippet (truncated to 120 chars), support strength badge, rationale, Accept/Reject buttons
- **Click card**: Navigates to that page, highlights the region with a dashed red box
- **Accept**: Calls `api.updateEvidenceSuggestionStatus(id, 'accepted')`, adds to `acceptedEvidence`, renders solid red box
- **Reject**: Calls `api.updateEvidenceSuggestionStatus(id, 'rejected')`, dims the card
- **Draw mode**: Toggle button, crosshair cursor on canvas, mousedown/mousemove/mouseup to draw rect, save via `api.createManualEvidence()`
- **Red boxes**: Rendered as absolute-positioned divs over the PDF canvas using the `rects` coordinates, converted from PDF coords to viewport coords using `fitScale`

Key implementation details:

For the PDF coordinate → viewport coordinate conversion (for red boxes):
```javascript
function pdfRectToViewport(rect, fitScale) {
  return {
    left: rect.x0 * fitScale,
    top: rect.y0 * fitScale,
    width: (rect.x1 - rect.x0) * fitScale,
    height: (rect.y1 - rect.y0) * fitScale,
  }
}
```

For the draw mode mouse handlers on the canvas wrapper:
```javascript
function handleCanvasMouseDown(e) {
  if (!drawMode) return
  const wrapperRect = e.currentTarget.getBoundingClientRect()
  setDrawStart({ x: e.clientX - wrapperRect.left, y: e.clientY - wrapperRect.top })
  setDrawingRect(null)
}

function handleCanvasMouseMove(e) {
  if (!drawMode || !drawStart) return
  const wrapperRect = e.currentTarget.getBoundingClientRect()
  const x = e.clientX - wrapperRect.left
  const y = e.clientY - wrapperRect.top
  setDrawingRect({
    left: Math.min(drawStart.x, x),
    top: Math.min(drawStart.y, y),
    width: Math.abs(x - drawStart.x),
    height: Math.abs(y - drawStart.y),
  })
}

function handleCanvasMouseUp() {
  if (!drawMode || !drawingRect) return
  // Convert viewport rect back to PDF coords for saving
  const pdfRect = {
    x0: drawingRect.left / fitScale,
    y0: drawingRect.top / fitScale,
    x1: (drawingRect.left + drawingRect.width) / fitScale,
    y1: (drawingRect.top + drawingRect.height) / fitScale,
  }
  // Save via API
  handleSaveManualBox(pdfRect)
  setDrawStart(null)
  setDrawingRect(null)
  setDrawMode(false)
}
```

For the support strength badge colors, use CSS variables:
- `direct_support` → `var(--green-5)` background, `var(--green-9)` text
- `partial_support` → `var(--amber-5)` background, `var(--amber-9)` text
- `weak_support` → `var(--gray-4)` background, `var(--gray-9)` text

**Step 2: Update ReferenceViewer.module.css**

Add these new styles (append to existing file):

```css
/* Split-panel layout */
.splitLayout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.pdfPanel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Suggestion sidebar */
.sidebar {
  width: 320px;
  border-left: 1px solid var(--gray-3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-background-primary);
}

.sidebarHeader {
  padding: 12px 16px;
  border-bottom: 1px solid var(--gray-3);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebarCards {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Suggestion card */
.suggestionCard {
  border: 1px solid var(--gray-3);
  border-radius: 8px;
  padding: 12px;
  background: var(--color-background-primary);
  cursor: pointer;
  transition: border-color 0.15s;
}

.suggestionCard:hover {
  border-color: var(--gray-5);
}

.suggestionCardActive {
  border-color: var(--red-5);
  box-shadow: 0 0 0 1px var(--red-3);
}

.suggestionCardAccepted {
  border-color: var(--green-5);
  background: var(--green-1);
}

.suggestionCardRejected {
  opacity: 0.4;
  pointer-events: none;
}

.suggestionSnippet {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.4;
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.suggestionMeta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.strengthBadge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.strengthDirect {
  background: var(--green-2);
  color: var(--green-9);
}

.strengthPartial {
  background: var(--amber-2);
  color: var(--amber-9);
}

.strengthWeak {
  background: var(--gray-3);
  color: var(--gray-8);
}

.suggestionRationale {
  font-size: 11px;
  color: var(--gray-7);
  font-style: italic;
  margin-bottom: 8px;
  line-height: 1.3;
}

.suggestionActions {
  display: flex;
  gap: 6px;
}

.pageLabel {
  font-size: 11px;
  color: var(--gray-6);
}

/* Red evidence boxes on PDF */
.evidenceBox {
  position: absolute;
  border: 2px solid var(--red-6);
  background: rgba(239, 68, 68, 0.08);
  border-radius: 2px;
  pointer-events: none;
}

.evidenceBoxDashed {
  border-style: dashed;
  background: rgba(239, 68, 68, 0.12);
}

/* Draw mode */
.canvasWrapperDrawMode {
  cursor: crosshair;
}

.drawingRect {
  position: absolute;
  border: 2px dashed var(--red-6);
  background: rgba(239, 68, 68, 0.15);
  pointer-events: none;
}

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--gray-3);
  background: var(--color-background-primary);
}

.toolbarSpacer {
  flex: 1;
}

/* Draw box footer in sidebar */
.sidebarFooter {
  padding: 12px 16px;
  border-top: 1px solid var(--gray-3);
}
```

**Step 3: Verify the component renders**

Start both servers (`cd app && npm run dev` in one tab, `cd backend && npm run dev` in another).

1. Navigate to `/mkg3`
2. Upload a test PDF and run analysis
3. Click a claim's linked reference → ReferenceViewer opens
4. Verify: PDF renders, "Suggest Evidence" button visible in toolbar
5. Click "Suggest Evidence" → sidebar slides in, loading state, then cards appear
6. Click a card → PDF navigates to that page, dashed red box appears at region
7. Click Accept → box becomes solid, card turns green
8. Click Reject → card dims
9. Close and re-open → accepted red boxes appear immediately

**Step 4: Commit**

```bash
git add app/src/components/mkg/ReferenceViewer/ReferenceViewer.jsx app/src/components/mkg/ReferenceViewer/ReferenceViewer.module.css
git commit -m "feat: ReferenceViewer split-panel with evidence suggestion sidebar + draw mode"
```

---

## Task 7: MKG3ClaimsDetector — Wiring Changes

**Files:**
- Modify: `app/src/pages/MKG3ClaimsDetector.jsx`

**Step 1: Update handleViewRef**

In `handleViewRef` (line 1195-1338), simplify:

- Remove the marker fetching block (lines 1314-1328 — the `api.fetchReferenceMarkers` call and cache)
- Remove `markers` from the `setReferenceViewerData` call (line 1336)
- Add `claimId` and `claimText` to the data object:

Change the `setReferenceViewerData` call at line 1330 to:

```javascript
    setReferenceViewerData({
      referenceId: ref.id,
      page: targetPage,
      excerpt: excerpt || (!resolvedPage ? claimText : null),
      pageResolution: resolutionReason,
      claimId: ref._claimId || null,
      claimText: claimText || null,
    })
```

Note: `ref._claimId` needs to be passed through. In `MKGClaimCard` the `onViewRef` callback receives `(ref, displayStatement)`. The claim's `id` is available in the card's parent scope. The simplest approach: when calling `onViewRef`, also attach the claim ID to the ref object. In `MKG3ClaimsDetector.jsx` where `onViewRef={handleViewRef}` is used, the claim object is in scope. Update `handleViewRef` signature to accept a third argument:

```javascript
const handleViewRef = async (ref, claimText, claimId) => {
```

And in the JSX where `onViewRef` is passed to claim cards, wrap it:

```javascript
onViewRef={(ref, statement) => handleViewRef(ref, statement, claim.id)}
```

**Step 2: Update ReferenceViewer rendering**

At line 2428-2433, change:

```jsx
<ReferenceViewer
  referenceId={referenceViewerData.referenceId}
  page={referenceViewerData.page}
  excerpt={referenceViewerData.excerpt}
  claimId={referenceViewerData.claimId}
  claimText={referenceViewerData.claimText}
/>
```

Remove `markers` prop.

**Step 3: Clean up marker imports/refs**

- Remove `markerCacheRef` (if it exists as a useRef)
- Remove import of `fetchReferenceMarkers` from api if it was imported directly (check if it's used via `api.fetchReferenceMarkers` — if so, no import to remove)

**Step 4: Test end-to-end**

1. Navigate to `/mkg3`, upload test PDF, run analysis
2. Click a linked reference on a claim card
3. Overlay opens with PDF + "Suggest Evidence" button
4. Click button → suggestions load → sidebar shows cards
5. Accept one → red box persists
6. Close overlay, re-open same reference → red box still there
7. Draw a manual box → saves and renders

**Step 5: Commit**

```bash
git add app/src/pages/MKG3ClaimsDetector.jsx
git commit -m "feat: wire evidence suggestion flow into MKG3 — pass claimId, drop markers"
```

---

## Task 8: Cleanup + Lint Check

**Files:**
- Various — fix any lint errors

**Step 1: Run lint**

```bash
cd app && npm run lint
```

Fix any errors. Common ones:
- Unused imports (old marker-related imports)
- `no-console` violations (use `logger` instead)
- Missing variable declarations

**Step 2: Run tests**

```bash
cd app && npm run test
```

Fix any broken tests. The existing tests shouldn't break since we're only modifying ReferenceViewer (which likely has no tests) and adding to MKG3ClaimsDetector.

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: lint fixes for evidence suggestion feature"
```

---

## Summary

| Task | Files | Depends On |
|------|-------|------------|
| 1. DB Migration | `016_evidence_suggestions.sql`, `database.js` | — |
| 2. Backend Models | `EvidenceSuggestion.js`, `AcceptedEvidence.js` | Task 1 |
| 3. Python Script | `evidence_candidates.py` | — |
| 4. Backend Controller + Routes | `evidenceController.js`, `evidence.js`, `index.js` | Tasks 2, 3 |
| 5. Frontend API Functions | `api.js` | Task 4 |
| 6. ReferenceViewer Rewrite | `ReferenceViewer.jsx`, `.module.css` | Task 5 |
| 7. MKG3 Wiring | `MKG3ClaimsDetector.jsx` | Task 6 |
| 8. Cleanup + Lint | Various | Task 7 |

**Parallelizable:** Tasks 1, 3 can run in parallel (no dependencies). Tasks 2 + 3 can run in parallel. Task 4 needs both 2 and 3. Tasks 5-8 are sequential.
