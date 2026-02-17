# CLAUDE.md

Claims Detector: React + Express POC for AI-powered detection of medical/regulatory claims in pharma documents. Built for MKG to streamline MLR (Medical, Legal, Regulatory) review.

## Design Principles (IMPORTANT)

- **Over-flag, never under-flag.** False positives cost reviewer time. False negatives cost clients (FDA warning letters). Always err toward sensitivity.
- **Regulatory language is precise.** "Superior," "improved," "favorable," "significant" carry specific regulatory weight in pharma.
- **Claims live in three content layers:** (1) Text — speaker notes, bullets, body copy. (2) Visual data — charts, graphs, tables (a bar showing "47% reduction" is a claim). (3) Annotation markers — daggers (†), double daggers (‡), asterisks (*), superscripts linking to footnotes.
- **This is a pre-screening tool**, not a replacement for human MLR review. Reviewers have final say.

## Routes

- `/` — Home (mock demos). Redirects to `/mkg` on Vercel production.
- `/mkg` — POC1: AI claim detection with PDF upload
- `/demo` — Client-friendly `/mkg` (hides POC badge)
- `/mkg2` — POC2: Full pipeline with brand reference library, claim-to-reference mapping, and feedback

## POC2 Success Criteria

**Purpose:** Validate whether AI-detected claims can be accurately mapped to brand-specific reference content.

**KPIs:**
- Claim detection accuracy consistently exceeds **90%**
- Claim-to-reference mapping accuracy consistently exceeds **70%**

**Capabilities:** Brand-based reference repository (PDF/Word upload), brand-aware claim detection, claim-to-reference mapping with click-through to source docs, feedback loop (approve/reject with reasons).

**Status:** All scope items implemented. Benchmark deliverable pending — see @docs/plans/2026-02-13-poc2-sow-alignment-assessment.md for full assessment.

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

**POC2 matching pipeline** (see `referenceMatching.js`): Semantic search → hybrid rerank (semantic 75% + keyword 15% + numeric 10%) → diversity selection → AI confirmation → fallbacks. Match tiers: `hybrid-semantic`, `hybrid-autoconfirm`, `hybrid-direct`, `keyword-fallback`.

**Fact indexing:** Auto-indexes new uploads via Gemini. Condensed fact inventory (max 14 refs, 5 facts/ref, 18K chars, 260 chars/fact) appended to detection prompts when brand has indexed refs.

**Passage embeddings:** 768-dim Gemini vectors (`gemini-embedding-001`), JS cosine similarity, LRU-cached 5min. Auto-embeds on upload.

**Database:** SQLite + WAL + `better-sqlite3` + `sqlite-vec`. Soft delete via `deleted_at` timestamp. 5 migrations auto-run on startup.

**Document structure:** "Notes page" PDFs: slide region (top ~50%, y < 55%) and speaker notes (bottom ~50%, y > 55%). Same stat in both regions = 1 pin (dedup by design, do not try to force duplicates).

**Gemini is non-deterministic** even with `temperature: 0`. Expect ~10-15% variance in claim counts between runs. This is normal behavior.

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
| Passage search returns 0 results | Run `cd backend && node scripts/embed-references.js` |
| `response.embedding.values` undefined | Use `response.embeddings[0].values` (plural `embeddings`, array index) |
| Reference matching returns few matches | Gemini sometimes returns array instead of object — `referenceMatching.js` normalizes this |

## Reference Docs

For detailed specs beyond this file:
- POC2 scope & validation: @docs/plans/2026-02-13-poc2-sow-alignment-assessment.md
- Workflow diagram: @docs/workflow-infographic.jpg
- Matching tuning vars: see `referenceMatching.js` header comments
- Backend API endpoints: see route files in `backend/src/routes/`
