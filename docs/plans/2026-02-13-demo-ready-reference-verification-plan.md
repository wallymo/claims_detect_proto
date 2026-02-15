# Demo-Ready Reference Verification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the `/mkg2` demo pipeline reliable — audit DB, fix a fact-lookup bug, fill indexing gaps, and dry-run the full flow.

**Architecture:** The system uses a shared "MKG Reference Library" brand (hidden from dropdown) that holds all 55 reference PDFs. Selectable brands (Annexon, XCOPRI) load references from this shared library via `libraryBrandId`. Pre-extracted facts in `reference_facts` table power Tier 0 fast matching and brand-grounded detection prompts.

**Tech Stack:** React + Vite frontend, Express + SQLite backend, Gemini API for fact extraction, better-sqlite3 for DB queries.

---

### Task 1: Database Audit — Check Indexing Status

**Files:**
- Read: `backend/data/claims_detector.db` (via sqlite3 CLI or script)

**Step 1: Query reference counts and indexing status**

Run from the `backend/` directory:

```bash
cd /Users/wallymo/claims_detector/backend && node -e "
import 'dotenv/config';
import { initDb, getDb, closeDb } from './src/config/database.js';
initDb();
const db = getDb();

const totalRefs = db.prepare('SELECT COUNT(*) as count FROM reference_documents').get();
console.log('Total references:', totalRefs.count);

const byBrand = db.prepare('SELECT b.name, COUNT(*) as count FROM reference_documents rd JOIN brands b ON b.id = rd.brand_id GROUP BY b.name').all();
console.log('\nBy brand:');
byBrand.forEach(r => console.log('  ' + r.name + ': ' + r.count));

const factStatus = db.prepare('SELECT extraction_status, COUNT(*) as count FROM reference_facts GROUP BY extraction_status').all();
console.log('\nFact indexing status:');
factStatus.forEach(r => console.log('  ' + r.extraction_status + ': ' + r.count));

const noFacts = db.prepare('SELECT COUNT(*) as count FROM reference_documents rd LEFT JOIN reference_facts rf ON rf.reference_id = rd.id WHERE rf.id IS NULL').get();
console.log('\nRefs with NO fact record at all:', noFacts.count);

const emptyText = db.prepare('SELECT COUNT(*) as count FROM reference_documents WHERE content_text IS NULL OR content_text = \"\"').get();
console.log('Refs with empty content_text:', emptyText.count);

const apiKey = process.env.GEMINI_API_KEY ? 'SET' : 'NOT SET';
console.log('\nGEMINI_API_KEY:', apiKey);

closeDb();
"
```

Expected output: A report showing X/55 refs indexed, Y failed, Z pending, plus whether the API key is configured.

**Step 2: Document the audit results**

Write down what needs fixing based on the output. Possible outcomes:
- All 55 indexed → skip to Task 3
- Some pending/failed → proceed to Task 2 (fill gaps)
- `GEMINI_API_KEY` not set → must configure it in `backend/.env` before indexing
- Empty `content_text` → those refs can't be indexed (PDF extraction failed)

**Step 3: Commit audit script (optional)**

No commit needed — this is a one-off diagnostic.

---

### Task 2: Fix P0 Bug — Fact Lookup Uses Wrong Brand ID

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx:448-471` (fact inventory for detection)
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx:553-572` (brand facts for Tier 0 matching)

**Context:** When a user selects Annexon, `selectedBrandId` is Annexon's ID. But all references (and their facts) belong to "MKG Reference Library" (`libraryBrandId`). Two code sections fetch facts using `selectedBrandId` instead of `libraryBrandId`, causing empty results — no fact inventory in detection prompt, no Tier 0 matching.

**Step 1: Fix detection fact inventory (lines 448-450, 456)**

In `app/src/pages/MKG2ClaimsDetector.jsx`, find the detection section (~line 446-471):

Change line 448:
```javascript
// BEFORE
if (selectedBrandId) {

// AFTER
const factBrandId = libraryBrandId || selectedBrandId
if (factBrandId) {
```

Change line 450:
```javascript
// BEFORE
const factRefs = await api.fetchFactsSummary(selectedBrandId)

// AFTER
const factRefs = await api.fetchFactsSummary(factBrandId)
```

Change line 456:
```javascript
// BEFORE
const factsData = await api.fetchFacts(selectedBrandId, ref.reference_id)

// AFTER
const factsData = await api.fetchFacts(factBrandId, ref.reference_id)
```

**Step 2: Fix Tier 0 matching facts (lines 554-563)**

In the matching section (~line 552-572):

Change line 554:
```javascript
// BEFORE
if (selectedBrandId) {

// AFTER
const matchFactBrandId = libraryBrandId || selectedBrandId
if (matchFactBrandId) {
```

Change line 556:
```javascript
// BEFORE
const factRefs = await api.fetchFactsSummary(selectedBrandId)

// AFTER
const factRefs = await api.fetchFactsSummary(matchFactBrandId)
```

Change line 563:
```javascript
// BEFORE
indexedRefIds.map(refId => api.fetchFacts(selectedBrandId, refId))

// AFTER
indexedRefIds.map(refId => api.fetchFacts(matchFactBrandId, refId))
```

**Step 3: Verify the fix compiles**

Run:
```bash
cd /Users/wallymo/claims_detector/app && npm run build
```

Expected: Build succeeds with no errors (500KB chunk warning is expected).

**Step 4: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "fix: use libraryBrandId for fact lookup in detection and matching

Facts are stored under the shared MKG Reference Library brand, not the
selected brand (Annexon/XCOPRI). Using selectedBrandId returned empty
results, breaking fact-grounded detection and Tier 0 matching.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: Fill Indexing Gaps

**Files:**
- Run: `backend/scripts/index-references.js`

**Prerequisite:** `GEMINI_API_KEY` must be set in `backend/.env`. If Task 1 showed "NOT SET", add it before proceeding.

**Step 1: Run the indexing script**

```bash
cd /Users/wallymo/claims_detector/backend && node scripts/index-references.js
```

Expected output:
- If all are already indexed: "No references need indexing. Use --force to re-index all."
- If gaps exist: "Found N references to index" followed by progress per ref, ending with a status summary.

The script rate-limits at 1s per ref. For 55 unindexed refs, expect ~5-10 minutes.

**Step 2: If any failed, retry with --force on those**

If the summary shows failures:
```bash
cd /Users/wallymo/claims_detector/backend && node scripts/index-references.js --brand "MKG Reference Library" --force
```

**Step 3: Verify final status**

Re-run the audit query from Task 1, Step 1. Confirm:
- `indexed` count is 50+ out of 55
- `failed` count is 5 or fewer (acceptable for demo)
- No refs are stuck in `extracting` status

If some refs persistently fail, note which ones. They likely have corrupt PDFs or empty text. The demo will work fine without them — Tier 1+2 matching still covers those references via keyword overlap.

---

### Task 4: Start Both Servers

**Step 1: Start the backend**

```bash
cd /Users/wallymo/claims_detector/backend && npm run dev
```

Expected: "Backend running on http://localhost:3001" + "Database initialized"

**Step 2: Start the frontend (separate terminal)**

```bash
cd /Users/wallymo/claims_detector/app && npm run dev
```

Expected: Vite dev server on http://localhost:5173

---

### Task 5: End-to-End Dry Run Checklist

This task is **manual testing in the browser**. Open http://localhost:5173/mkg2 and work through each check.

**Step 1: Brand dropdown verification**

- [ ] Dropdown shows Annexon and XCOPRI
- [ ] "MKG Reference Library" does NOT appear in dropdown
- [ ] "AI Only" does NOT appear in dropdown
- [ ] Selecting a brand doesn't error in console

**Step 2: Library tab verification**

- [ ] After selecting a brand, switch to Library tab
- [ ] References load (should show ~55 documents)
- [ ] Most references show "indexed" status (green/blue badge)
- [ ] Any failed refs show "Index failed" with retry button (red badge)
- [ ] No refs stuck showing "Indexing..." indefinitely
- [ ] Clicking a reference name opens/downloads the PDF file

**Step 3: Claims detection**

- [ ] Switch to Claims tab
- [ ] Upload a test PDF (an existing pharma document)
- [ ] Select "Gemini" as the AI model
- [ ] Click "Detect Claims"
- [ ] Detection runs without errors
- [ ] Open browser DevTools → Console: look for "Loaded N facts from M indexed references" log (confirms fact inventory was loaded — Task 2 fix working)
- [ ] Claims appear with pin positions on the PDF
- [ ] Claim cards show type, confidence, and text

**Step 4: Reference matching**

- [ ] After detection completes, matching starts automatically (or click Match)
- [ ] Progress indicator shows matching activity
- [ ] Console shows "Loaded facts from N refs for Tier 0 matching" (confirms Tier 0 is working)
- [ ] Some claims get reference matches with page numbers and excerpts
- [ ] Clicking a matched reference opens/links to the source PDF
- [ ] Unmatched claims still appear (over-flag principle)

**Step 5: Feedback**

- [ ] Click approve (thumbs up) on a claim — state updates
- [ ] Click reject (thumbs down) on a claim — state updates
- [ ] Refresh page → re-select brand → re-detect: feedback should persist
- [ ] No console errors during feedback actions

**Step 6: Overall**

- [ ] No unhandled exceptions in browser console
- [ ] No 404s or 500s in network tab
- [ ] Loading states appear during operations (not blank screens)
- [ ] UI doesn't look broken or half-styled

**Step 7: Document any issues found**

Create a list of issues categorized by priority:
- **P0 (demo blocker):** detection fails, matching crashes, refs don't load, 404s
- **P1 (visible to client):** wrong loading states, missing badges, confusing labels
- **P2 (nice to have):** console warnings, slow transitions, minor layout shifts

---

### Task 6: Fix Issues Found During Dry Run

This task is dynamic — it depends on what Task 5 surfaces. For each P0 issue:

**Step 1: Identify the root cause**

Read the relevant code, check console errors, inspect network requests.

**Step 2: Write a targeted fix**

Keep fixes minimal. No refactoring, no new features. Just make it work.

**Step 3: Re-test the specific flow that broke**

Verify the fix resolves the issue without breaking other flows.

**Step 4: Commit each fix separately**

```bash
git add <changed-files>
git commit -m "fix: <what was broken and why>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

For P1 issues, fix if time permits. For P2, skip and document for later.

---

## Execution Order

| Task | Type | Depends On | Est. Time |
|------|------|-----------|-----------|
| 1. Database Audit | Diagnostic | None | 5 min |
| 2. Fix Fact Lookup Bug | Code fix | None | 10 min |
| 3. Fill Indexing Gaps | Run script | Task 1 (to know if needed) | 5-30 min |
| 4. Start Both Servers | Operational | Tasks 2-3 | 2 min |
| 5. End-to-End Dry Run | Manual test | Task 4 | 20-30 min |
| 6. Fix Issues | Code fixes | Task 5 | Variable |

Tasks 1, 2, and 3 can be partially parallelized (audit first, then fix + index simultaneously).
