# CLAUDE.md

Claims Detector: React + Express POC for AI-powered annotation and claim detection in pharma documents. Built for MKG to streamline MLR (Medical, Legal, Regulatory) review. Primary goal: automate reference annotation (connecting on-page references to content). Secondary goal: AI-powered claim detection as QA.

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
- `/mkg3` — Current deterministic annotation workflow for this branch

## MKG3 — Annotation Engine (newworkflow branch)

**Purpose:** Automate reference annotation from page-local evidence. `/mkg3` extracts page text and positions, detects superscript-backed statements, and maps them to the references on that same page. Saves the manual annotation step without making AI the primary engine.

**Primary flow (always runs):**
1. Extract text from each page with positions.
2. Split each page into `slide` and `notes` regions by coordinates.
3. Parse superscript-backed statements in each region.
   - Numeric superscripts only for now. Ignore dagger, double-dagger, asterisk, and other symbol markers in `/mkg3`.
4. Parse page-local reference pools:
   - slide footnotes at the bottom of the slide
   - notes references under the speaker notes `References` section
5. Match superscript numbers directly to the local pool for that same page and region.
6. Place pins from extracted text coordinates.
7. If a reference pool exists but no clear superscript target exists, emit a global annotation for that page/region.

**Secondary flow (AI QA toggle in settings, off by default):**
- When ON, model does additional pass looking for potential claims with NO on-page reference
- Tagged `"source": "ai-find"` — flagged for human review
- When OFF, it must not interfere with deterministic extraction; only deterministic on-page annotations and required global annotations are shown

**Reference scope rule:** Slide content may only resolve against that page's slide footnotes. Speaker notes bullets may only resolve against that page's notes references. Never cross-reference between the two pools.

**See:** [PROCESS.md](./PROCESS.md)

**Previous approach (deprecated on this branch):** Multi-tier backend matching pipeline (semantic search, AI confirmation, keyword fallback) against brand reference library. `/mkg3` should not use that as its primary path.

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
VITE_GEMINI_API_KEY=your_key     # Required for fact indexing + embeddings
```

Matching pipeline has 15+ optional tuning env vars with sensible defaults — see `referenceMatching.js` header or `app/.env.local` for the full list.

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
│       │   └── mkg/              # PDFViewer, MKGClaimCard, ClaimPinsOverlay
│       ├── pages/                # Home, MKGClaimsDetector, MKG2ClaimsDetector
│       ├── services/             # AI clients, api.js, referenceMatching.js, normalizer.js
│       └── tokens/               # Design tokens (CSS variables)
├── backend/
│   ├── migrations/               # 001-005, auto-run on startup
│   ├── scripts/                  # preload, index, embed, benchmark
│   └── src/
│       ├── models/               # Brand, Reference, ClaimFeedback, Folder, ReferenceFact, ReferencePassage
│       ├── controllers/          # brand, reference, file, feedback, fact, passage
│       ├── services/             # textExtractor, factExtractor, passageEmbedder
│       └── middleware/           # errorHandler, upload (Multer)
├── docs/                         # Plans and briefs
└── MKG Knowledge Base/           # 54 source reference PDFs
```

## Key Technical Details

**AI services:** Three interchangeable backends (`gemini.js`, `openai.js`, `anthropic.js`). All send PDFs as base64 multimodal. Gemini returns `position: { x, y }` as % of page dimensions for claim pin placement.

**Model defaults:** Gemini 3 Pro Preview, Claude Opus 4.6, GPT-5.2 Codex. Override Gemini with `VITE_GEMINI_MODEL`.

**Gemini two-pass detection:** Primary pass extracts claims from text + notes. Optional visual sweep (`VITE_GEMINI_VISUAL_SWEEP_ENABLED`, default: true) re-scans for chart/table statistics. Results merged with deduplication.

**OpenAI uses Responses API** — `client.responses.create()` with `input[]` array format, NOT `chat.completions.create()`.

**MKG3 annotation pipeline:** Hybrid two-engine pipeline. pdf.js text layer handles speaker notes candidates and reference pool extraction (deterministic). Gemini Vision reads every slide image for annotated statements with proper layout-aware reading order and positions. Vision results replace text-layer slide candidates. Optional AI QA remains separate and off by default.

**Database:** SQLite + WAL + `better-sqlite3` + `sqlite-vec`. Soft delete via `deleted_at` timestamp. 5 migrations auto-run on startup.

**Document structure:** "Notes page" PDFs: slide region (top ~50%, y < 55%) and speaker notes (bottom ~50%, y > 55%). Same stat in both regions = 1 pin (dedup by design, do not try to force duplicates).

**Hybrid pipeline rule:** For `/mkg3`, the text layer (pdf.js) owns speaker notes and reference pool extraction. Gemini Vision owns slide-region annotation extraction. Both are first-class engines, not fallbacks.

## Coding Conventions

- Functional components: `export default function ComponentName`
- CSS Modules with camelCase: `styles.claimCard`
- Component folders: `ComponentName/ComponentName.jsx` + `ComponentName.module.css`
- Design tokens in `src/tokens/tokens.css` — use existing variables, don't hardcode colors/spacing
- IMPORTANT: ESLint enforces `no-console: error` — use `logger` from `@/utils/logger` instead of `console.log`
- Backend: ESM modules (`"type": "module"`). pdf-parse import quirk: `import pdfParse from 'pdf-parse/lib/pdf-parse.js'` then `pdfParse.default()`
- Shared drop zone CSS: `dropZone*` classes in `App.css` for file upload UI
- Empty states: use `flex: 1` (not fixed height) to prevent layout jumps between tab panels

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Claim count varies between runs | Normal — Gemini non-determinism, not a bug |
| Results seem stale after code change | Restart Vite dev server to clear cache |
| `/api` routes return 404 | Backend not running — `cd backend && npm run dev` |
| Build warning >500KB chunk | Expected (pdf.js worker) |
| Annotations missing on-page references | Check page-local text extraction, slide/notes split, and superscript parsing before considering AI fallback |

## Reference Docs

For detailed specs beyond this file:
- Deterministic `/mkg3` workflow: [PROCESS.md](./PROCESS.md)
- POC2 scope & validation: @docs/plans/2026-02-13-poc2-sow-alignment-assessment.md
- Workflow diagram: @docs/workflow-infographic.jpg
- Matching tuning vars: see `referenceMatching.js` header comments
- Backend API endpoints: see route files in `backend/src/routes/`
