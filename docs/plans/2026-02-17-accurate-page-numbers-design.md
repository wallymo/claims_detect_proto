# Design: Accurate Page Numbers for Reference Passages

**Date:** February 17, 2026
**Status:** Approved
**Peer Review:** Codex GPT-5.3 — NEEDS CHANGES (all issues addressed below)

## Problem

Page numbers shown on reference matches are wrong (e.g., "Page 22" on a 14-page PDF) because:
1. `estimatePage()` in `passageEmbedder.js` divides character offset by hardcoded 3000 chars/page — wildly inaccurate for dense documents
2. Gemini's fact extraction in `factExtractor.js` guesses page numbers without seeing actual page breaks
3. No validation clamps results against actual `page_count` stored in the database

## Solution: Page-aware text extraction via `pagerender` hook

### Changes by File

**1. `backend/src/services/textExtractor.js` — Add `extractTextByPage()`**

New export using pdf-parse's `pagerender` callback to capture per-page text:
- Returns `{ pages: [{ page: 1, text: "..." }], pageCount, fullText, pageBoundaries }`
- `fullText` must byte-for-byte match current pdf-parse output format (leading `\n\n` before first page, `\n\n` between pages) — verified by Codex runtime test
- `pageBoundaries`: `[{ page: 1, startChar: 0, endChar: 8126 }, ...]` computed from cumulative page text lengths within `fullText`
- Existing `extractText()` unchanged (backward compatible)

**2. `backend/src/services/passageEmbedder.js` — Use real page boundaries**

- `embedReference(contentText, options)` gains optional `options.pageBoundaries` parameter
- New function: `resolvePageFromBoundaries(startChar, pageBoundaries)` — binary search to find which page a character offset falls on
- When `pageBoundaries` provided: each passage gets real page number
- When not provided (Word docs): improved fallback using `totalChars / pageCount` if pageCount available, else current 3000 default
- `estimatePage()` retained as ultimate fallback

**3. `backend/src/services/factExtractor.js` — Safe page clamping**

- `extractFacts(contentText, options)` accepts optional `options.pageCount`
- New helper: `sanitizeFactPage(page, pageCount)` — only clamps finite integers to `[1, pageCount]`; preserves `null`/`undefined`/non-numeric as `null` (never fabricates page numbers)
- Applied after Gemini extraction, before deduplication

**4. `backend/scripts/embed-references.js` — Pass page boundaries**

- Query fetches `rd.page_count`, `rd.doc_type`, `rd.file_path`
- For PDFs with readable `file_path`: calls `extractTextByPage()` to get boundaries, passes to `embedReference()`
- For Word docs or missing files: falls back to improved estimate (`contentLength / pageCount` + clamp)
- Guards: skip references with missing/unreadable files (log warning, don't crash)

**5. `backend/src/controllers/referenceController.js` — Page-aware upload**

- On PDF upload: call `extractTextByPage()` instead of `extractText()`
- Store `content_text` = `fullText` (no schema change)
- Pass `pageBoundaries` to `embedReference()` for auto-embedding
- Pass `pageCount` to `extractFacts()` for clamping

**6. `backend/src/controllers/factController.js` — Pass pageCount**

- When re-indexing facts, fetch `page_count` from the reference record
- Pass to `extractFacts(ref.content_text, { pageCount: ref.page_count })`

**7. `backend/scripts/index-references.js` — Pass pageCount**

- Query fetches `rd.page_count`
- Pass to `extractFacts(ref.content_text, { pageCount: ref.page_count })`

### What Stays the Same

- Passage chunking logic (size, overlap, sentence boundaries)
- Embedding model and dimensions (768-dim Gemini)
- Frontend matching pipeline in `app/src/services/referenceMatching.js` (reads `page_estimate`, which will now be accurate)
- Database schema (no migration needed)
- UI components (already show Page X + excerpt)
- Word doc handling (no page-aware extraction available for .docx)

### Migration

```bash
cd backend && node scripts/embed-references.js --force    # Re-embed with accurate pages
cd backend && node scripts/index-references.js --force     # Re-extract facts with clamped pages
```

### Testing

- Boundary mapping: verify `resolvePageFromBoundaries()` returns correct page for offsets at page edges
- Text parity: verify `extractTextByPage().fullText` matches `extractText().text` for same PDF
- Fact sanitization: verify `sanitizeFactPage(null, 14)` = `null`, `sanitizeFactPage(22, 14)` = `14`, `sanitizeFactPage(3, 14)` = `3`
- End-to-end: upload a known PDF, verify passage page numbers don't exceed actual page count

### Future Consideration (Deferred)

Codex suggested `start_page`/`end_page` per passage for chunks spanning page breaks. Valid for long-term accuracy but requires schema migration — defer beyond POC.
