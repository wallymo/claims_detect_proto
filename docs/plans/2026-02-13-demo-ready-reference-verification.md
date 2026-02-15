# Demo-Ready Reference Verification

**Date:** 2026-02-13
**Goal:** Verify and fix the reference pipeline for a client demo of `/mkg2` this week.
**Approach:** Verify & Fix — audit DB state, fill indexing gaps, dry-run the full flow, fix issues.

## Context

- Demo route: `/mkg2` (POC2 full pipeline)
- Demo brand: Annexon or XCOPRI (selectable in dropdown)
- Shared library: "MKG Reference Library" (55 refs, hidden from dropdown)
- Test document: Existing pharma PDF
- Timeline: This week

## Architecture Clarification

"MKG Reference Library" is a **shared backing store**, not a selectable brand:
- Dropdown shows only Annexon, XCOPRI, and user-created brands
- "MKG Reference Library" and "AI Only" are filtered out (`MKG2ClaimsDetector.jsx:192-195`)
- All brands share references from the library via `libraryBrandId`
- Uploads also go to the shared library (`line 675`)

## Step 1: Database Audit

Query the database to determine the indexing status of all 55 references:
- Total reference count
- Count by `extraction_status`: indexed, pending, failed, extracting (stuck)
- Any with empty `content_text` (broken text extraction)
- Output: "X/55 indexed, Y failed, Z pending"

## Step 2: Fill Indexing Gaps

- Run `node scripts/index-references.js` to process any `pending` or `failed` refs
- Rate limit: ~1s per ref via Gemini API. Worst case 55 refs = 5-10 min
- Re-run with `--force` for persistent failures
- Verify: all refs should be `indexed` with non-empty `facts_json`
- Prerequisite: `GEMINI_API_KEY` must be set in `backend/.env`
- Acceptable: 50+/55 indexed is fine for demo; document any stubborn failures

## Step 3: End-to-End Dry Run

Full demo flow test:
1. Open `/mkg2`
2. Select Annexon or XCOPRI from brand dropdown
3. Library tab → verify 55 shared references with indexing badges
4. Claims tab → upload test PDF
5. Select Gemini model → Detect Claims
6. Observe reference matching (Tier 0 → 1 → 2)
7. Review claim cards with mapped references
8. Click through to source PDFs
9. Approve/reject claims → verify feedback persists

**Verify:**
- Brand dropdown excludes MKG Reference Library and AI Only
- References load correctly for any selected brand
- Fact inventory appended to detection prompt
- Tier 0 fast matches work for obvious claims
- File serving works (PDF click-through)
- No console errors or broken UI

## Step 4: Issue Triage & Fix

| Priority | Category | Action |
|----------|----------|--------|
| P0 — Demo blocker | Broken core flow (detection fails, matching crashes, refs don't load, 404s) | Fix immediately |
| P1 — Visible to client | UI rough edges (wrong loading states, missing badges, confusing labels) | Fix if time permits |
| P2 — Nice to have | Polish (console warnings, slow transitions, layout shifts) | Document, skip |

**No new features.** Goal is reliability of what exists.
