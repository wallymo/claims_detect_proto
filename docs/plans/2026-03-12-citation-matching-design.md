# Citation Matching Improvement Design

**Date:** 2026-03-12
**Goal:** Improve two weak links in the View Source flow: (1) matching citation text to the correct library PDF, and (2) opening the PDF on the correct page.

## Problem

### Which PDF? (doc matching)
`matchCitationToLibrary()` compares citation text (e.g., "Bragazzi NL et al. J Neuroinflammation. 2021;18:264") against `display_alias` and prettified `filename`. These are lossy representations — keyword overlap often fails because journal abbreviations differ, "et al." is stripped, etc.

### Which Page? (page targeting)
`handleViewRef()` fetches pre-extracted facts and does fuzzy word overlap against claim text. Facts are paraphrased summaries, not verbatim quotes — overlap scores are low, so it falls back to page 1.

## Solution

### Part 1: Pre-indexed citation metadata

At upload time, extract structured citation metadata from the filename and first-page content of each reference PDF. Store as a JSON column on `reference_documents`.

**Fields:**
```json
{
  "first_author": "bragazzi",
  "author_tokens": ["bragazzi", "kolahi", "nejadghaderi"],
  "year": "2021",
  "journal_tokens": ["journal", "neuroinflammation"],
  "doi": "10.1186/s12974-021-02319-4",
  "title_tokens": ["global", "regional", "national", "burden", "guillain", "barré", "syndrome"],
  "normalized_filename": "bragazzi nl j neuroinflammation 2021",
  "normalized_alias": "bragazzi nl j neuroinflammation 2021"
}
```

**Extraction logic:**
- `first_author`: first word of filename after stripping timestamp, or first surname from content_text
- `author_tokens`: all author surnames from first page (before "Abstract" or first heading)
- `year`: 4-digit year from filename or content
- `journal_tokens`: journal name words from first page header/footer
- `doi`: regex match `10.\d{4,}/\S+` from first page
- `title_tokens`: significant words from the article title (first large text block)
- `normalized_filename/alias`: lowercase, stripped of timestamps and extensions

**Matching scorer (replaces `matchCitationToLibrary`):**
1. DOI exact match → instant win (score 1.0)
2. First author + year match → strong signal (score 0.8 base + journal bonus)
3. Author token overlap + year → medium signal
4. Fall back to current keyword overlap on filename/alias

**Data flow:**
- Backend: new migration adds `citation_metadata` TEXT column
- Backend: `referenceController.upload()` calls new `extractCitationMetadata(filename, contentText, pageBoundaries)` after text extraction
- Backend: backfill script for existing references
- Frontend: `loadBrandReferences()` fetches metadata with each ref
- Frontend: `matchCitationToLibrary()` uses metadata for scoring

### Part 2: Page targeting via content_text search

Instead of relying on fact text overlap, search the reference's actual `content_text` for the claim text, then use `page_boundaries` to resolve the matching char offset to a page number.

**Flow:**
1. `handleViewRef(ref, claimText)` called
2. Fetch `/api/files/references/:refId/text` (extended to return `page_boundaries`)
3. Search `content_text` for claim text using normalized substring search
4. If found: convert char offset → page via `page_boundaries`
5. If not found: fall back to existing fact lookup
6. If fact lookup fails: page 1

**Why content_text search works better than fact lookup:**
- Facts are AI-generated summaries — paraphrased, condensed
- content_text is the actual PDF text — if the claim quotes the reference, the exact words are there
- page_boundaries gives deterministic page resolution (no approximate `fact.page`)

### Part 3: Backend changes

**Migration (006):**
```sql
ALTER TABLE reference_documents ADD COLUMN citation_metadata TEXT;
```

**Extend `fileController.getText()`:**
Return `page_boundaries` alongside `content_text`.

**New service: `citationMetadataExtractor.js`:**
- `extractCitationMetadata(filename, contentText, pageBoundaries)` → JSON blob
- Called at upload time and by backfill script

**Backfill script: `scripts/backfill-citation-metadata.js`:**
- Iterates all references, extracts metadata from existing content_text + filename
- Idempotent (skips refs that already have metadata)

## What this does NOT change

- No changes to the AI annotation pipeline or prompts
- No changes to the fact extraction system
- No new AI/LLM calls — all extraction is regex/heuristic
- No changes to the PDF viewer or highlight system
- MKG/MKG2 pages unaffected (they don't use `matchCitationToLibrary`)

## Files changed

| File | Change |
|------|--------|
| `backend/migrations/006-citation-metadata.js` | New column |
| `backend/src/services/citationMetadataExtractor.js` | New: extract metadata from filename + content |
| `backend/src/controllers/referenceController.js` | Call extractor at upload time |
| `backend/src/controllers/fileController.js` | Return page_boundaries in getText() |
| `backend/src/models/Reference.js` | Include citation_metadata in queries |
| `backend/scripts/backfill-citation-metadata.js` | Backfill existing refs |
| `app/src/services/api.js` | No change needed (already fetches getText) |
| `app/src/pages/MKG3ClaimsDetector.jsx` | Update matchCitationToLibrary + handleViewRef |
