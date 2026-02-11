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

**Three routes:**
- `/` — Home page with mock data for demos (client selection)
- `/mkg` — POC1: Real AI integration for PDF claim detection
- `/mkg2` — POC2: Full pipeline with brand reference library, AI claim-to-reference mapping, and feedback

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

## Commands

**Frontend** (from `app/`):
```bash
npm run dev           # Vite dev server on :5173
npm run build         # Production build
npm run lint          # ESLint
npm run test          # Vitest (single run)
npm run test:watch    # Vitest (watch mode)
npm run test:coverage # Vitest with coverage
```

**Backend** (from `backend/`):
```bash
npm run dev           # Express with --watch on :3001
npm start             # Express without watch
npm run preload       # Load 54 reference PDFs into SQLite from MKG Knowledge Base/
node scripts/index-references.js          # Batch-index all refs for fact extraction (requires GEMINI_API_KEY)
node scripts/index-references.js --force  # Re-index all (even already indexed)
node scripts/index-references.js --brand "MKG Reference Library"  # Index one brand only
```

**Full development requires two terminals:**
1. `cd backend && npm run dev`
2. `cd app && npm run dev`

Vite proxies `/api` requests to `http://localhost:3001`.

## Environment Setup

`app/.env.local`:
```
VITE_GEMINI_API_KEY=your_key
VITE_OPENAI_API_KEY=your_key
VITE_ANTHROPIC_API_KEY=your_key
```

Backend uses `backend/.env`:
```
GEMINI_API_KEY=your_key          # Required for fact indexing
VITE_GEMINI_API_KEY=your_key     # Frontend Gemini access
VITE_OPENAI_API_KEY=your_key
VITE_ANTHROPIC_API_KEY=your_key
```
Defaults: port 3001, `./data/claims_detector.db`. No `.env.local` — all config lives in `.env`.

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
│   ├── scripts/                  # preload-references.js, index-references.js
│   └── src/
│       ├── app.js                # Express factory, CORS, route registration
│       ├── config/               # database.js (SQLite + WAL), env.js
│       ├── models/               # Brand, Reference, ClaimFeedback, Folder, ReferenceFact
│       ├── controllers/          # brand, reference, file, feedback, fact controllers
│       ├── routes/               # REST route wiring
│       ├── services/             # textExtractor, aliasGenerator, factExtractor
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
| `api.js` | Backend REST client (brands, references, folders, feedback, files, facts) |
| `referenceMatching.js` | Three-tier pipeline: Tier 0 fact lookup → Tier 1 keyword pre-filter → Tier 2 Gemini AI matching |

### Backend API

| Endpoint | Purpose |
|----------|---------|
| `GET/POST/DELETE /api/brands` | Brand CRUD |
| `GET/POST/PATCH/DELETE /api/brands/:brandId/references` | Reference document CRUD with file upload |
| `POST /api/brands/:brandId/references/bulk-move` | Move refs to folder |
| `POST /api/brands/:brandId/references/bulk-delete` | Bulk delete refs |
| `GET /api/files/references/:refId` | Serve reference PDF file |
| `GET /api/files/references/:refId/text` | Get extracted text |
| `GET/POST/PATCH /api/feedback` | Claim feedback persistence |
| `GET/POST/PATCH/DELETE /api/folders` | Folder management |
| `GET /api/brands/:brandId/references/:refId/facts` | Extracted facts for a reference |
| `POST /api/references/:refId/facts/extract` | Trigger fact extraction for one reference |
| `GET /api/brands/:brandId/facts/summary` | Fact counts + status for all refs in a brand |
| `PATCH /api/facts/:factId/feedback` | Confirm or reject a specific fact |

### Database

SQLite with WAL mode, better-sqlite3 (synchronous). Key tables:
- `brands` — brand/client groupings
- `reference_documents` — PDFs with pre-extracted `content_text`, `filename` (original), `display_alias` (editable name)
- `reference_facts` — pre-extracted structured facts per reference (`facts_json`, `extraction_status`, `confirmed_count`, `rejected_count`, `model_used`)
- `claim_feedback` — approve/reject decisions per claim
- `folders` — organize reference documents

Migrations run automatically on startup (001 → 002 → 003). The `preload` script reads PDFs from `MKG Knowledge Base/References/`, extracts text via pdf-parse, and inserts into DB. The `index-references` script batch-extracts structured facts from all references via Gemini.

### AI Service Architecture

Three interchangeable AI backends in `src/services/`. All send PDFs as base64 with multimodal processing. Gemini returns x/y coordinates for claim positions — no client-side text matching needed.

**Key pattern:** AI returns `position: { x, y }` as % of page dimensions. Pin placement: `x = (position.x / 100) * canvasWidth`.

### POC2 Reference Matching Pipeline (MKG2)

1. **Step 1:** Detect claims using selected AI model (same as POC1). If brand has indexed facts, a condensed fact inventory is appended to the detection prompt for grounded knowledge.
2. **Step 2:** For each claim, three-tier matching:
   - **Tier 0 (fast path):** Compare claim text against pre-extracted fact keywords. If >=75% keyword overlap, return match immediately (no AI call needed).
   - **Tier 1:** Keyword pre-filter narrows 54 references to top 5-8.
   - **Tier 2:** Gemini AI matches claim → reference with page/excerpt.
3. **All claims always shown** — over-flag principle means we never hide unmatched claims. AI Discovery toggle was removed.

### Reference Fact Indexing

Pre-extracts structured facts (efficacy, safety, dosage, mechanism, population, endpoint, statistical, regulatory) from each reference document via Gemini. Facts are stored as JSON in `reference_facts` table.

- **Batch indexing:** `node scripts/index-references.js` processes all unindexed refs sequentially
- **Auto-index on upload:** New references are automatically indexed async after upload (non-blocking, requires `GEMINI_API_KEY`)
- **Detection integration:** Fact inventory appended to all 3 AI prompts when brand has indexed refs
- **Matching integration:** Tier 0 uses fact keywords for fast direct matching before keyword pre-filter
- **Feedback weighting:** Confirmed facts get +10% boost in Tier 0 scoring; mostly-rejected facts get -20% penalty
- **Library UI:** "Indexing..." badge on pending refs, "Index failed" with retry button on failed refs, no badge when indexed

### Brand Creation Flow

The "Add New Brand" modal (`MKG2ClaimsDetector.jsx`) is a 3-section expanded form:

1. **Brand Info** — Name (required) + Client/Company (optional)
2. **Reference Library** — Drag-and-drop file upload zone. Files queue in modal state (`brandModalFiles`), then upload sequentially after brand creation. Progress shown inline: "Uploading 2/5..."
3. **Team Access** — Visual placeholder only (Coming Soon badge). No auth system exists yet.

On Create: brand is created → files upload sequentially → brand is auto-selected → modal closes.

### Library Tab Behavior

- **No brand selected:** Only empty state shows ("Select a Brand"). Header, folder tree, upload button, and bulk actions are all hidden.
- **Brand selected, no refs:** Empty state with upload prompt ("No References for {brand}")
- **Brand selected, has refs:** Full UI — header with doc count + upload, folder tree, document list with selection/bulk actions

References load per brand via `loadBrandReferences(brandId)` triggered by `useEffect` on `selectedBrandId`.

### State Management

All state lives in page components (no external state library). Cost tracking persists to localStorage.

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
