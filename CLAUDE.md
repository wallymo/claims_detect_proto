# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claims Detector is a React + Express POC for AI-powered detection of medical/regulatory claims in pharmaceutical documents. Built for MKG (a pharma agency) to streamline MLR (Medical, Legal, Regulatory) review processes.

**Visual workflow overview:** See `docs/workflow-infographic.jpg` for a complete diagram of the current detection pipeline (5 steps: Reference Library → Document Upload → AI Detection → Reference Matching → Review & Feedback).

## What This Tool IS and ISN'T

**Client:** MKG (Medical Knowledge Group) — 650+ person medical communications company serving biopharma. Every promotional piece they create goes through MLR (Medical, Legal, Regulatory) review where every claim must be substantiated by approved references. Errors = FDA warning letters, lost clients, patient safety risk.

**What it IS:**
- A pre-screening tool that catches claims a human reviewer then validates
- A reference lookup accelerator — connects claims to source material so reviewers don't have to dig
- A safety net — catches things humans might miss in long documents
- A triage tool — confidence scores help reviewers prioritize what to review first

**What it ISN'T:**
- A replacement for human MLR review
- A compliance approval system — it doesn't decide if claims are acceptable
- An authority on what is or isn't a claim — the reviewer has final say

**Core design principles:**
- **Over-flag, never under-flag.** False positives cost reviewer time. False negatives cost clients. Always err toward sensitivity over specificity.
- **Regulatory language is precise.** Words like "superior," "improved," "favorable," "significant" carry specific regulatory weight in pharma. The tool must be sensitive to these distinctions.
- **Claims live in three content layers:**
  1. **Text** — speaker notes, bullet points, body copy
  2. **Visual data** — charts, graphs, tables, infographics (a bar showing "47% reduction" is a claim)
  3. **Annotation markers** — daggers (†), double daggers (‡), asterisks (*), superscripts that link to footnotes with study details, populations, p-values, statistical significance. Each annotation is a substantiable reference point.
- **Document types vary.** Speaker notes, print ads, digital banners, leave-behinds all have different claim density, layout, and review needs.
- **References can expire.** Some references get superseded and can no longer be used for substantiation. Freshness matters.

**Four routes:**
- `/` — Home page with mock data for demos (client selection). Redirects to `/mkg` on Vercel production.
- `/mkg` — POC1: Real AI integration for PDF claim detection
- `/demo` — Same as `/mkg` but with `demoMode` prop (client-friendly title, hides POC badge)
- `/mkg2` — **POC2 (this is the only POC2 route):** Full pipeline with brand reference library, AI claim-to-reference mapping, and feedback

## POC2 Scope of Work & Success Criteria

**Project Purpose:** Validate whether AI-detected claims can be accurately mapped to brand-specific reference content at a level that supports real review workflows.

**Two critical capabilities to prove:**
1. Whether brand-grounded knowledge improves claim detection accuracy
2. Whether detected claims can be reliably mapped back to the correct source material

**Success Criteria:**
- Claim detection accuracy consistently exceeds **90%**
- Claim-to-reference mapping accuracy consistently exceeds **70%**

**Scope:**
- **Brand-based content repository** — Upload client-specific reference documents (PI, supporting materials), associated to a brand. PDF and Word support.
- **Brand-aware claim detection** — User selects brand → detector uses associated brand documents for contextual accuracy. Claims identified with awareness of brand-specific language and constraints.
- **Claim-to-reference mapping** — Each detected claim mapped to relevant reference content. Click-through access to source documents. Reviewers verify claim is correctly supported.
- **Claim feedback loop** — Users confirm valid detections or reject with optional reason. Feedback stored and used to refine future detection and mapping.
- **UI enhancements** — Brand selection, claim list with mapped references, click-through to source docs, feedback controls for training input.

**Deliverables:** Functional hosted POC, benchmark summary (best model), claim detection interface, prompt modification panel, JSON claim extraction/display, approval/rejection tracking system.

**Validation status (as of 2026-02-13):** All scope items implemented. Benchmark deliverable pending — requires manual validation using annotated test documents (clean PDFs run through POC2, results compared against human-annotated answer keys). See `docs/plans/2026-02-13-poc2-sow-alignment-assessment.md` for full alignment assessment.

## Commands

**Frontend** (from `app/`):
```bash
npm run dev           # Vite dev server on :5173
npm run build         # Production build
npm run lint          # ESLint
npm run test          # Vitest (single run)
npm run test:watch    # Vitest (watch mode)
npm run test:coverage # Vitest with coverage
npx vitest run test/utils/logger.test.js  # Run a single test file
```

**Backend** (from `backend/`):
```bash
npm run dev           # Express with --watch on :3001
npm start             # Express without watch
npm run preload       # Load 54 reference PDFs into SQLite from MKG Knowledge Base/
node scripts/index-references.js          # Batch-index all refs for fact extraction (requires VITE_GEMINI_API_KEY)
node scripts/index-references.js --force  # Re-index all (even already indexed)
node scripts/index-references.js --brand "MKG Reference Library"  # Index one brand only
node scripts/index-references.js --force --concurrency 5  # Control parallel extractions (default: 10)
node scripts/embed-references.js                         # Batch-embed all refs for semantic search (requires VITE_GEMINI_API_KEY)
node scripts/embed-references.js --force                 # Re-embed all (even already embedded)
node scripts/embed-references.js --brand "MKG Reference Library"  # Embed one brand only
node scripts/embed-references.js --force --concurrency 3 # Control parallel embeddings (default: 5)
node scripts/benchmark-passages-search.js --claims-file path/to/claims.json --brand-id 1 --spawn-local  # Benchmark search recall/latency
```

**Full development requires two terminals:**
1. `cd backend && npm run dev`
2. `cd app && npm run dev`

Vite proxies `/api` requests to `http://localhost:3001`.

**Tests** live in `app/test/` (not colocated with source). Environment: happy-dom. Coverage thresholds: 50% (lines, functions, branches, statements).

## Environment Setup

`app/.env.local`:
```
VITE_GEMINI_API_KEY=your_key
VITE_OPENAI_API_KEY=your_key
VITE_ANTHROPIC_API_KEY=your_key
```

Backend uses `backend/.env`:
```
VITE_GEMINI_API_KEY=your_key     # Gemini access (frontend + backend fact indexing + embeddings)
VITE_OPENAI_API_KEY=your_key
VITE_ANTHROPIC_API_KEY=your_key
MATCHING_EMBED_CACHE_TTL_MS=300000       # Query embedding cache TTL (5 min default)
MATCHING_EMBED_CACHE_MAX_ENTRIES=500     # Query embedding cache max size
```
Defaults: port 3001, `./data/claims_detector.db`. No `.env.local` — all config lives in `.env`.

Frontend matching tuning (optional, in `app/.env.local`):
```
VITE_MATCHING_HYBRID_ENABLED=true              # Hybrid reranking (default: true)
VITE_MATCHING_AUTOCONFIRM_ENABLED=false        # Auto-confirm high-confidence matches (default: false)
VITE_MATCHING_TOPK=20                          # Top-K passages to retrieve (default: 20)
VITE_MATCHING_CANDIDATE_POOL=40               # Internal ranking depth (default: 40)
VITE_MATCHING_CONFIRM_TOPN=8                  # Passages sent to AI confirmation (default: 8)
VITE_MATCHING_CONFIRM_DIVERSITY_ENABLED=true  # Cap passages per reference in AI confirmation (default: true)
VITE_MATCHING_CONFIRM_PER_REFERENCE_CAP=2     # Max passages per reference sent to AI (default: 2)
```

**Deployment:** Vercel config in `app/vercel.json`. Production redirects `/` → `/mkg`. SPA rewrites for `/mkg2`, `/demo`, and catch-all to `index.html`.

## Architecture

```
claims_detector/
├── app/                          # React frontend (Vite)
│   └── src/
│       ├── components/
│       │   ├── atoms/            # Button, Icon, Input, Toggle, Spinner, etc.
│       │   ├── molecules/        # Tabs, FileUpload, DropdownMenu, etc.
│       │   ├── claims-detector/  # LibraryTab, ReferenceListItem, DocumentTypeSelector
│       │   └── mkg/              # PDFViewer, MKGClaimCard, ClaimPinsOverlay
│       ├── pages/                # Home, MKGClaimsDetector, MKG2ClaimsDetector
│       ├── services/             # AI clients + backend API + reference matching
│       ├── mocks/                # Mock data for Home page demos
│       └── tokens/               # Design tokens (CSS variables)
├── backend/                      # Express + SQLite API
│   ├── server.js                 # Entry point
│   ├── migrations/               # SQL schema files (run on startup)
│   ├── scripts/                  # preload-references.js, index-references.js, embed-references.js, benchmark-passages-search.js
│   └── src/
│       ├── app.js                # Express factory, CORS, route registration
│       ├── config/               # database.js (SQLite + WAL), env.js
│       ├── models/               # Brand, Reference, ClaimFeedback, Folder, ReferenceFact, ReferencePassage
│       ├── controllers/          # brand, reference, file, feedback, fact, passage controllers
│       ├── routes/               # REST route wiring
│       ├── services/             # textExtractor, aliasGenerator, factExtractor, passageEmbedder
│       └── middleware/           # errorHandler, upload (Multer), validate
├── docs/                         # Briefs and plans
└── MKG Knowledge Base/           # Source reference PDFs (54 files)
```

### Path Aliases (vite.config.js)
- `@` → `./src`
- `@tokens` → `./src/tokens`
- `@components` → `./src/components`
- `@utils` → `./src/utils`

### Frontend Services

| Service | Purpose |
|---------|---------|
| `gemini.js` | Gemini claim detection + `matchClaimToReferences()` for reference mapping |
| `openai.js` | GPT-4o claim detection (same interface) |
| `anthropic.js` | Claude claim detection (same interface) |
| `api.js` | Backend REST client (brands, references, folders, feedback, files, facts, passages) |
| `referenceMatching.js` | Hybrid matching pipeline: semantic search → hybrid rerank → diversity selection → AI confirmation (keyword fallback) |

### Backend API

| Endpoint | Purpose |
|----------|---------|
| `GET/POST/DELETE /api/brands` | Brand CRUD |
| `GET/POST/PATCH/DELETE /api/brands/:brandId/references` | Reference document CRUD with file upload |
| `POST /api/brands/:brandId/references/bulk-move` | Move refs to folder |
| `POST /api/brands/:brandId/references/bulk-delete` | Bulk soft-delete refs (move to trash) |
| `GET /api/brands/:brandId/references/trash` | List trashed references |
| `POST /api/brands/:brandId/references/restore` | Bulk restore from trash |
| `DELETE /api/brands/:brandId/references/permanent` | Bulk permanent delete (removes files from disk) |
| `GET /api/files/references/:refId` | Serve reference PDF file |
| `GET /api/files/references/:refId/text` | Get extracted text |
| `GET/POST/PATCH /api/feedback` | Claim feedback persistence |
| `GET/POST/PATCH/DELETE /api/folders` | Folder management |
| `GET /api/brands/:brandId/references/:refId/facts` | Extracted facts for a reference |
| `POST /api/references/:refId/facts/extract` | Trigger fact extraction for one reference |
| `GET /api/brands/:brandId/facts/summary` | Fact counts + status for all refs in a brand |
| `PATCH /api/facts/:factId/feedback` | Confirm or reject a specific fact |
| `POST /api/brands/:brandId/passages/search` | Semantic search: embed claim, return top-K similar passages |
| `GET /api/brands/:brandId/passages/status` | Embedding status per reference in a brand |

### Database

SQLite with WAL mode, better-sqlite3 (synchronous), sqlite-vec extension loaded. Key tables:
- `brands` — brand/client groupings
- `reference_documents` — PDFs with pre-extracted `content_text`, `filename` (original), `display_alias` (editable name), `deleted_at` (soft delete timestamp, NULL = active)
- `reference_facts` — pre-extracted structured facts per reference (`facts_json`, `extraction_status`, `confirmed_count`, `rejected_count`, `model_used`)
- `reference_passages` — chunked passages with embedding vectors for semantic search (`passage_text`, `embedding` BLOB as Float32Array buffer 768-dim, `passage_index`, `page_estimate`, `start_char`, `end_char`)
- `claim_feedback` — approve/reject decisions per claim
- `folders` — organize reference documents

**Soft delete pattern:** `DELETE /api/brands/:brandId/references/:refId` sets `deleted_at` timestamp (soft delete). All queries filter `WHERE deleted_at IS NULL` by default. Restore sets `deleted_at = NULL` and moves to root folder (`folder_id = NULL`). Permanent delete removes the DB row and file from disk.

Migrations run automatically on startup (001 → 002 → 003 → 004 → 005). The `preload` script reads PDFs from `MKG Knowledge Base/References/`, extracts text via pdf-parse, and inserts into DB. The `index-references` script batch-extracts structured facts from all references via Gemini. The `embed-references` script batch-embeds all reference passages for semantic search.

### AI Service Architecture

Three interchangeable AI backends in `src/services/`. All send PDFs as base64 with multimodal processing. Gemini returns x/y coordinates for claim positions — no client-side text matching needed.

**Key pattern:** AI returns `position: { x, y }` as % of page dimensions. Pin placement: `x = (position.x / 100) * canvasWidth`.

### POC2 Reference Matching Pipeline (MKG2)

1. **Step 1: Claim Detection** — selected AI model (same as POC1). If brand has indexed facts, a condensed fact inventory is appended to the detection prompt for grounded knowledge.
2. **Step 2: Hybrid Matching** — for each claim (deduplicated, concurrent batches of 3):
   - **Semantic search** — backend embeds claim via Gemini `gemini-embedding-001` (768-dim, cached 5 min), KNN cosine similarity across all brand passages (computed in JS, not sqlite-vec virtual tables)
   - **Hybrid reranking** — combines semantic (75%), keyword (15%), and numeric overlap (10%) into a `hybrid_score`
   - **Diversity selection** — caps passages per reference (default 2) before AI confirmation to avoid one reference dominating
   - **AI confirmation** — top 8 diverse candidates sent to Gemini 2.0 Flash (passage text truncated to ~3000 chars). AI returns `referenceIndex`, `referenceName`, `supportingExcerpt`, `confidence`
   - **Auto-confirm** (disabled by default) — skips AI call if semantic >= 0.92, hybrid >= 0.76, keyword >= 0.10, lead margin >= 0.10
   - **Fallback** — keyword matching if backend semantic search fails (e.g., embeddings not generated)
   - **AI failure fallback** — if AI confirmation errors, uses top semantic result directly if similarity >= 0.85 or hybrid >= 0.78
3. **Claim dedup at matching stage** — identical claim texts are matched once; result is fanned out to duplicates
4. **All claims always shown** — over-flag principle means we never hide unmatched claims
5. **Telemetry** — `matchAllClaimsToReferences()` returns `{ claims, telemetry }` with timing stats, cache hits, tier counts, diversity metrics

**Match tiers:** `hybrid-semantic` (AI confirmed), `hybrid-autoconfirm` (score gating), `hybrid-direct` (AI error fallback), `keyword-fallback` (no embeddings)

### Reference Fact Indexing

Pre-extracts structured facts (efficacy, safety, dosage, mechanism, population, endpoint, statistical, regulatory) from each reference document via Gemini 2.0 Flash. Facts are stored as JSON in `reference_facts` table.

- **Batch indexing:** `node scripts/index-references.js` processes unindexed refs in parallel (default concurrency: 10, configurable via `--concurrency <n>`)
- **Auto-index on upload:** New references are automatically indexed async after upload (non-blocking, requires `VITE_GEMINI_API_KEY`)
- **Detection integration:** Fact inventory appended to all 3 AI prompts when brand has indexed refs
- **Library UI:** "Indexing..." badge on pending refs, "Index failed" with retry button on failed refs, no badge when indexed

### Reference Passage Embeddings

Pre-chunks reference documents into overlapping passages and embeds each via Gemini `gemini-embedding-001` (768-dim vectors via MRL dimensionality reduction from 3072). Stored as `Float32Array` buffers in `reference_passages` table, searched via JS cosine similarity.

- **Chunking:** `passageEmbedder.js` — 2400 chars / 400 overlap for normal docs; 1800 chars / 300 overlap for dense docs (120K+ chars). Breaks at sentence boundaries when possible.
- **Batch embedding:** `node scripts/embed-references.js` with `--force`, `--brand`, `--concurrency`, `--chunk-size`, `--chunk-overlap`, `--limit`, `--dry-run` flags. Default concurrency: 5. Retry logic for 429 rate limit errors.
- **Auto-embed on upload:** New references are automatically chunked and embedded async after upload (non-blocking, requires `VITE_GEMINI_API_KEY`)
- **Search:** `POST /api/brands/:brandId/passages/search` — embeds query text (LRU-cached 5 min, 500 entries max), KNN cosine similarity in JS across all brand passages, returns candidate pool with `passage_text` hydrated only for top results
- **Status:** `GET /api/brands/:brandId/passages/status` — embedding status per reference
- **Benchmarking:** `node scripts/benchmark-passages-search.js` — tests semantic search recall (recall@1, recall@5, recall@20) and latency (p50/p95/p99). Accepts JSON claims file with expected reference labels. Flags: `--claims-file`, `--brand-id`, `--spawn-local`, `--top-k`, `--candidate-pool`, `--scorecard`, `--label`
- **Dependencies:** `sqlite-vec` (loaded into better-sqlite3), `gemini-embedding-001` via `@google/genai`

### Claim Schema
```javascript
{
  id: 'claim_001',
  text: 'Reduces cardiovascular events by 47%...',
  confidence: 0.92,                    // 0-1 scale
  type: 'efficacy',                    // efficacy|safety|regulatory|comparative|dosage|ingredient|testimonial|pricing
  status: 'pending',                   // pending|approved|rejected
  page: 1,
  position: { x: 25.0, y: 14.5 }      // x/y as % of page (0-100)
}
```

## Coding Conventions

- Functional components: `export default function ComponentName`
- CSS Modules with camelCase: `styles.claimCard`
- Component folders: `ComponentName/ComponentName.jsx` + `ComponentName.module.css`
- Design tokens in `src/tokens/tokens.css` — use existing variables, don't hardcode colors/spacing
- Shared upload drop zone: use `dropZone`, `dropZoneIcon`, `dropZoneText`, `dropZoneHint` classes from `App.css` for any file upload UI
- Empty states: use `flex: 1` (not fixed height) to fill container — prevents layout jumps between tab panels
- Backend uses ESM modules (`"type": "module"` in package.json)
- pdf-parse import quirk: `import pdfParse from 'pdf-parse/lib/pdf-parse.js'` then `pdfParse.default()`

## Gemini API Notes

Gemini is **non-deterministic** even with `temperature: 0, topP: 0.1, topK: 1`. The `seed` parameter is "best effort" only. Expect ~10-15% variance in claim counts between runs.

**If results seem wrong after code changes:** Restart the Vite dev server to clear caching before assuming code is broken.

### Document Structure (Notes Pages)

Prompts are tuned for "notes page" PDFs with two regions per page:
- **Top ~50%**: Slide image (visual content, icons, charts)
- **Bottom ~50%**: Speaker notes (bullet points starting with "Speaker notes" header)

Claims with `y < 55%` are from slides; `y > 55%` are from speaker notes.

### Claim Deduplication

The prompt includes: "Combine related statements into ONE claim if same substantiation needed." If the same statistic appears in both slide and speaker notes, Gemini returns one pin (usually on the slide). Attempts to force duplicate extraction made results worse — leave as-is.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Claim count varies between runs | Gemini non-determinism | Normal behavior, not a bug |
| Results seem stale after code change | Vite/browser cache | Restart dev server |
| Missing claims in speaker notes | Check y-coordinates | Should have claims with y > 55% |
| Same stat in slide + notes = 1 pin | Deduplication rule | Expected behavior |
| `/api` routes return 404 | Backend not running | Start backend: `cd backend && npm run dev` |
| Build warning >500KB chunk | pdf.js worker | Expected, not an error |
| Reference matching returns very few matches | `matchClaimToReferences()` returns array instead of object | Gemini AI sometimes returns `[{matched:true,...}]` array; `referenceMatching.js` normalizes with `Array.isArray()` check |
| `response.embedding.values` is undefined | `@google/genai` SDK response format | Use `response.embeddings[0].values` (plural `embeddings`, array index) |
| Passage search returns 0 results | Embeddings not generated for brand | Run `cd backend && node scripts/embed-references.js` |
