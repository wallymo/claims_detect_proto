# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Claims Detector: React + Express POC for AI-powered annotation and claim detection in pharma documents. Built for MKG to streamline MLR (Medical, Legal, Regulatory) review. Primary goal: automate reference annotation (connecting on-page references to content). Secondary goal: AI-powered claim detection as QA. Tertiary: evidence suggestion pipeline for source PDF review.

## Design Principles (IMPORTANT)

- **Over-flag, never under-flag.** False positives cost reviewer time. False negatives cost clients (FDA warning letters). Always err toward sensitivity.
- **Regulatory language is precise.** "Superior," "improved," "favorable," "significant" carry specific regulatory weight in pharma.
- **Claims live in three content layers:** (1) Text — speaker notes, bullets, body copy. (2) Visual data — charts, graphs, tables (a bar showing "47% reduction" is a claim). (3) Annotation markers — daggers (†), double daggers (‡), asterisks (*), superscripts linking to footnotes.
- **This is a pre-screening tool**, not a replacement for human MLR review. Reviewers have final say.

## Routes

- `/` — Home (mock demos). Redirects to `/mkg` on Vercel production.
- `/mkg` — POC1: AI claim detection with PDF upload
- `/demo` — Client-friendly `/mkg` (hides POC badge)
- `/mkg2` — Earlier page-local annotation workflow
- `/mkg3` — Current annotation workflow (PyMuPDF pipeline + evidence suggestions)

## MKG3 — Annotation Engine (newworkflow branch)

**Purpose:** Automate reference annotation from page-local evidence. `/mkg3` extracts page text and positions, detects superscript-backed statements, and maps them to the references on that same page. Saves the manual annotation step without using AI.

**Primary pipeline: PyMuPDF (deterministic, zero-AI)**

The sole annotation engine is a standalone Python script (`scripts/pymupdf_poc.py`) called from the Express backend. No Gemini, no OpenAI, no API keys, no token costs. Processes 31-page decks in under 1 second.

Flow per page:
1. Extract all text spans with coordinates, font size, and flags via `page.get_text("dict")`.
2. Split page into `slide` and `notes` regions by detecting "Speaker notes" label (fallback: 50% y).
3. Detect superscripts using PyMuPDF font flags (`flags & 1`). Numeric only.
4. Parse two reference pools per page:
   - Slide footnotes: tiny text (< 6pt) at bottom of slide region
   - Notes references: text below "References" header in notes region
   - Handles both numbered (`1. Author...`) and unnumbered single citations
5. Associate each superscript with its nearest parent text (same visual line, to the left).
6. Resolve superscripts against their region's pool only. Never cross-reference.
7. Orphan references (pool entries with no superscript) → global annotations.
8. Output structured JSON → frontend transforms to annotation format.

**Backend endpoint:** `POST /api/pymupdf-extract` receives PDF via Multer, calls Python script via `child_process.execFile`, returns JSON.

**Reference scope rule:** Slide content may only resolve against that page's slide footnotes. Speaker notes bullets may only resolve against that page's notes references. Never cross-reference between the two pools.

**Secondary flow (AI QA toggle in settings, off by default):**
- When ON, model does additional pass looking for potential claims with NO on-page reference
- Tagged `"source": "ai-find"` — flagged for human review
- When OFF, only deterministic on-page annotations and global annotations are shown

**See:** [PROCESS.md](./PROCESS.md)

## Evidence Suggestion Pipeline

**Purpose:** When a reviewer opens a source reference PDF from a claim, suggest up to 6 candidate evidence regions. Three-lane approach: deterministic text scoring, structured box grouping, and selective Gemini Vision for charts/figures.

**Pipeline (backend-only, `POST /api/evidence/suggestions`):**
1. `scripts/evidence_candidates.py` — PyMuPDF extracts all text blocks, groups content inside rectangular outlines into composite `structured_box` candidates, flags drawing-dense pages for Vision analysis. Scores candidates via token overlap (65%) + numeric overlap (35%) with 25% boost for structured content.
2. Gemini 2.5 Flash Lite — decomposes claim into structured metadata (drug names, endpoints, numerics, etc.)
3. `scripts/render_page.py` — renders flagged Vision pages to PNG. Gemini Vision identifies figures/charts with bounding boxes + descriptions.
4. Gemini 2.5 Pro — reranks all candidates (text + structured + visual) to best 6, with preference for visual evidence when claim involves quantitative data.

**Four candidate types:**
- `text` — regular text blocks from the PDF
- `structured_box` — grouped content inside rectangular outlines (tables, boxes like "Box 2 | Differential diagnosis...")
- `figure` — caption-anchored regions: when a "Fig. N" or "Table N" caption is detected, the bounding box expands upward to capture the visual content above it (chart, graph, table image). Captions consumed so they don't duplicate as TEXT.
- `chart`/`diagram` — visual elements detected by Gemini Vision with bounding box descriptions (selective, only on drawing-dense pages)

**Additional endpoints:**
- `GET /api/evidence/accepted?claim_id=X&reference_id=Y` — fetch saved evidence boxes
- `PATCH /api/evidence/suggestions/:id` — accept/reject a suggestion
- `POST /api/evidence/manual` — save manually drawn evidence box
- `DELETE /api/evidence/accepted/:id` — remove saved evidence
- `DELETE /api/evidence/suggestions?claim_id=X&reference_id=Y` — clear cached suggestions for re-analysis

**Frontend: ReferenceViewer** (`app/src/components/mkg/ReferenceViewer/`)
- Auto-runs evidence suggestions when PDF opens (if claim context available)
- Split-panel: PDF left, suggestion sidebar right
- Cards show type label (Text/Data/Visual), page number, snippet, rationale
- Accept/Reject buttons per suggestion; accepted → solid red box on PDF
- Manual draw mode: crosshair cursor, drag to create custom evidence box
- Resizable evidence boxes: click box → blue edit handles appear at corners/edges
- Re-analyze button clears cache and re-runs pipeline
- Claim text shown in compact blue header bar

**Persistence:** Two SQLite tables — `evidence_suggestions` (AI candidates + debug data) and `accepted_evidence` (saved red boxes from accepts + manual draws).

## Commands

**Frontend** (from `app/`):
```bash
npm run dev           # Vite on :5173
npm run build         # Production build
npm run lint          # ESLint
npm run test          # Vitest (single run)
npm run test:watch    # Vitest (watch mode)
npm run test:coverage # Vitest with coverage
npx vitest run test/utils/logger.test.js  # Single test file
```

**Backend** (from `backend/`):
```bash
npm run dev           # Express with --watch on :3001
npm run preload       # Load 54 reference PDFs into SQLite
node scripts/index-references.js          # Batch fact extraction (--force, --brand, --concurrency)
node scripts/embed-references.js          # Batch passage embedding (--force, --brand, --concurrency, --dry-run)
node scripts/benchmark-passages-search.js # Search recall/latency benchmarks (--claims-file, --brand-id)
```

**PyMuPDF scripts** (from project root):
```bash
# Setup (one-time)
python3 -m venv scripts/.venv
scripts/.venv/bin/pip install -r scripts/requirements.txt

# Annotation extraction
scripts/.venv/bin/python3 scripts/pymupdf_poc.py <pdf_path> --pretty
scripts/.venv/bin/python3 scripts/pymupdf_poc.py <pdf_path> --debug    # stderr diagnostics
scripts/.venv/bin/python3 scripts/pymupdf_poc.py <pdf_path> --page 2   # single page

# Evidence candidate extraction (for reference PDFs)
scripts/.venv/bin/python3 scripts/evidence_candidates.py <pdf_path> --claim "claim text" --top-k 30 --pretty

# Render PDF page to PNG (base64 JSON output for Vision pipeline)
scripts/.venv/bin/python3 scripts/render_page.py <pdf_path> --page 3
scripts/.venv/bin/python3 scripts/render_page.py <pdf_path> --page 3 --output /tmp/page.png

# Build reference index from filenames
scripts/.venv/bin/python3 scripts/build_reference_index.py --pretty
```

**Both servers required for development.** Vite proxies `/api` → `http://localhost:3001`.

**Tests** in `app/test/` (not colocated). Environment: happy-dom. Coverage threshold: 50%.

## Environment

`app/.env.local`:
```
VITE_GEMINI_API_KEY=your_key
VITE_OPENAI_API_KEY=your_key
VITE_ANTHROPIC_API_KEY=your_key
```

`backend/.env` (no `.env.local`):
```
VITE_GEMINI_API_KEY=your_key     # Required for fact indexing, embeddings, and evidence suggestions
```

**Note:** The PyMuPDF annotation pipeline requires NO API keys. Keys are needed for: AI QA secondary flow, reference fact indexing, and evidence suggestion pipeline (Gemini decompose + rerank + Vision).

**Deployment:** Vercel via `app/vercel.json`. Production: `/` → `/mkg`, SPA rewrites for `/mkg2`, `/demo`.

## Architecture

```
claims_detector/
├── app/                          # React frontend (Vite)
│   └── src/
│       ├── components/
│       │   ├── atoms/            # Button, Icon, Input, Toggle, Spinner
│       │   ├── molecules/        # Tabs, FileUpload, DropdownMenu
│       │   ├── claims-detector/  # LibraryTab, ReferenceListItem, ModelComparison
│       │   └── mkg/              # PDFViewer, MKGClaimCard, ClaimPinsOverlay, ReferenceViewer
│       ├── pages/                # Home, MKGClaimsDetector, MKG2ClaimsDetector, MKG3ClaimsDetector
│       ├── services/             # AI clients, api.js, referenceMatching.js, normalizer.js
│       ├── utils/                # citationLibraryMatcher, logger, textMatcher, markerCoords
│       └── tokens/               # Design tokens (CSS variables)
├── backend/
│   ├── migrations/               # 001-016, auto-run on startup
│   ├── scripts/                  # preload, index, embed, benchmark
│   └── src/
│       ├── models/               # Brand, Reference, ClaimFeedback, Folder, ReferenceFact,
│       │                         # ReferencePassage, AnalysisCache, AnalysisRun, TrainingSession,
│       │                         # BrandPattern, DocumentLineage, AnnotationVersion,
│       │                         # EvidenceSuggestion, AcceptedEvidence
│       ├── controllers/          # brand, reference, file, feedback, fact, passage, pymupdf,
│       │                         # evidence, analysisCache, analysisRun, training, matchingJob,
│       │                         # documentAi, brandPattern, documentLineage, version
│       ├── services/             # textExtractor, factExtractor, passageEmbedder
│       └── middleware/           # errorHandler, upload (Multer)
├── scripts/                      # PyMuPDF scripts + Python venv
│   ├── pymupdf_poc.py            # Annotation extraction from slide+notes PDFs
│   ├── evidence_candidates.py    # Evidence candidate extraction from reference PDFs (rect grouping + vision flagging)
│   ├── render_page.py            # Render PDF page to PNG (base64 JSON for Vision pipeline)
│   ├── build_reference_index.py  # Parse PDF filenames → structured JSON metadata
│   ├── requirements.txt          # PyMuPDF==1.27.2
│   └── .venv/                    # Python virtual environment
├── References/References/        # 55 source reference PDFs (loaded into brand library)
├── docs/                         # Plans and design docs
└── MKG Knowledge Base/           # Test documents for annotation validation
```

## Key Technical Details

**PyMuPDF annotation pipeline (primary):** `scripts/pymupdf_poc.py` is the sole annotation engine. Called from `backend/src/controllers/pymupdfController.js` via `child_process.execFile`. Frontend calls `POST /api/pymupdf-extract` with the PDF, receives JSON, transforms via `transformPyMuPDFResults()` in `MKG3ClaimsDetector.jsx`. Zero AI involvement — pure text extraction.

**Evidence suggestion pipeline:** `scripts/evidence_candidates.py` parses reference PDFs into scored candidate regions. Rect grouping detects rectangular outlines via `page.get_drawings()` and merges 3+ contained text blocks into `structured_box` composites. Vision flagging marks pages with >15 drawings and <40% text coverage for Gemini Vision analysis. Controller (`evidenceController.js`) orchestrates: Python shortlist → Gemini decompose → Vision (selective) → Gemini rerank → save to DB.

**Citation-to-PDF matching:** During transform, each annotation's citation string is matched against the brand's reference library using `matchCitationToLibrary()` from `app/src/utils/citationLibraryMatcher.js`. Scoring: DOI exact match (instant win) > first author + year > author tokens + title/journal overlap. When matched, `ref.id` is set and `MKGClaimCard` renders it as clickable.

**PyMuPDF superscript detection:** Uses `flags & 1` on each text span. Body text threshold is 6pt. Y-tolerance for parent text association is 0.9%.

**AI services (secondary, off by default):** Three interchangeable backends (`gemini.js`, `openai.js`, `anthropic.js`). All send PDFs as base64 multimodal. Only used when AI QA toggle is enabled.

**Model defaults:** Gemini 3 Pro Preview, Claude Opus 4.6, GPT-5.2 Codex. Override Gemini with `VITE_GEMINI_MODEL`. Evidence pipeline uses Gemini 2.5 Flash Lite (decompose), Gemini 2.5 Flash (Vision), Gemini 2.5 Pro (rerank).

**OpenAI uses Responses API** — `client.responses.create()` with `input[]` array format, NOT `chat.completions.create()`.

**Gemini SDK:** Uses `@google/genai` package (new SDK). Pattern: `new GoogleGenAI({ apiKey })` → `ai.models.generateContent({ model, contents, config })`. For Vision: pass `{ inlineData: { mimeType, data } }` as first content element.

**Database:** SQLite + WAL + `better-sqlite3` + `sqlite-vec`. Soft delete via `deleted_at` timestamp. 16 migrations auto-run on startup. Evidence suggestions cached by claim+reference pair — re-analyze clears and re-runs.

**Version system:** Each analysis saves results as a version tied to file hash + brand. Re-analysis creates a new version. Approval/rejection statuses are carried forward from prior versions.

**Frontend state:** PyMuPDF results stored in `pymupdfAnnotations` state. `_activeClaims` is the computed variable used by all display components. ReferenceViewer manages its own evidence suggestion state (suggestions, acceptedEvidence, drawMode).

## Coding Conventions

- Functional components: `export default function ComponentName`
- CSS Modules with camelCase: `styles.claimCard`
- Component folders: `ComponentName/ComponentName.jsx` + `ComponentName.module.css`
- Design tokens in `src/tokens/tokens.css` — use existing variables, don't hardcode colors/spacing
- IMPORTANT: ESLint enforces `no-console: error` — use `logger` from `@/utils/logger` instead of `console.log`
- Backend: ESM modules (`"type": "module"`). pdf-parse import quirk: `import pdfParse from 'pdf-parse/lib/pdf-parse.js'` then `pdfParse.default()`
- Python scripts called via `child_process.execFile` — output JSON to stdout, errors to stderr
- Shared drop zone CSS: `dropZone*` classes in `App.css` for file upload UI
- Empty states: use `flex: 1` (not fixed height) to prevent layout jumps between tab panels

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| PyMuPDF endpoint returns 500 | Check `scripts/.venv/bin/python3` exists. Run setup: `python3 -m venv scripts/.venv && scripts/.venv/bin/pip install -r scripts/requirements.txt` |
| Results seem stale after code change | Restart Vite dev server to clear cache |
| `/api` routes return 404 | Backend not running — `cd backend && npm run dev` |
| Build warning >500KB chunk | Expected (pdf.js worker) |
| Port 3001 in use | `lsof -i :3001 -t \| xargs kill -9` then restart backend |
| Annotations missing on-page references | Check PyMuPDF debug output: `scripts/.venv/bin/python3 scripts/pymupdf_poc.py <pdf> --page N --debug` |
| New PDF shows 0 claims | Check backend logs for PyMuPDF errors. Test endpoint directly: `curl -F "pdf=@file.pdf" http://localhost:3001/api/pymupdf-extract` |
| Evidence suggestions empty | Check backend logs for Vision/Gemini errors. Verify `VITE_GEMINI_API_KEY` set in `backend/.env`. Test: `curl -X POST http://localhost:3001/api/evidence/suggestions -H "Content-Type: application/json" -d '{"claim_text":"test","claim_id":"t1","reference_id":1}'` |
| UNIQUE constraint on evidence_suggestions | Suggestions already cached for that claim+reference pair. Clear via `DELETE /api/evidence/suggestions?claim_id=X&reference_id=Y` or use re-analyze button |

## Reference Docs

For detailed specs beyond this file:
- Deterministic `/mkg3` workflow: [PROCESS.md](./PROCESS.md)
- PyMuPDF POC design: @docs/plans/2026-03-16-pymupdf-poc-design.md
- PyMuPDF integration design: @docs/plans/2026-03-16-pymupdf-integration-design.md
- Evidence suggestion design: @docs/plans/2026-03-19-evidence-suggestion-design.md
- Visual evidence lane design: @docs/plans/2026-03-19-visual-evidence-lane-design.md
- POC2 scope & validation: @docs/plans/2026-02-13-poc2-sow-alignment-assessment.md
- Backend API endpoints: see route files in `backend/src/routes/`
