# Citation Matching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve citation-to-library matching (which PDF?) and page targeting (which page?) using pre-indexed citation metadata and content_text search with page_boundaries.

**Design doc:** `docs/plans/2026-03-12-citation-matching-design.md`

---

### Task 1: Add citation_metadata column (migration)

**Files:**
- Create: `backend/migrations/006-citation-metadata.js`

**Step 1: Create migration file**

```js
export function up(db) {
  db.exec(`ALTER TABLE reference_documents ADD COLUMN citation_metadata TEXT`)
}
```

Follow the pattern of existing migrations in `backend/migrations/`.

**Step 2: Verify migration runs on server startup**

Run: `cd backend && npm run dev` — check logs for migration 006 execution.

**Step 3: Commit**

```bash
git add backend/migrations/006-citation-metadata.js
git commit -m "feat: add citation_metadata column to reference_documents"
```

---

### Task 2: Create citation metadata extractor service

**Files:**
- Create: `backend/src/services/citationMetadataExtractor.js`

**Step 1: Implement extractCitationMetadata()**

The function takes `filename`, `contentText`, and `pageBoundaries` and returns a JSON object with:
- `first_author`: first surname from filename (strip timestamp prefix, take first token)
- `author_tokens`: parse author names from first page of content_text (before "Abstract", "Background", "Introduction", or "HIGHLIGHTS"). Split on commas, "and", newlines. Extract surname-like tokens.
- `year`: regex `\b(19|20)\d{2}\b` from filename first, then content
- `journal_tokens`: look for journal name patterns in first page (after author block, before abstract). Common patterns: "Journal of X", "X et al. JournalName (year)", header/footer text.
- `doi`: regex `10\.\d{4,}\/\S+` from content_text (first page)
- `title_tokens`: extract article title — typically the largest text block on page 1, after authors/journal header, before author names. Use first sentence/heading that isn't an author name or journal name.
- `normalized_filename`: filename stripped of timestamp prefix and extension, underscores to spaces, lowercase
- `normalized_alias`: display_alias lowercased

Use `page_boundaries` to slice content_text to just page 1 for author/title/journal extraction.

**Step 2: Add unit-testable parsing helpers**

Export helper functions:
- `parseAuthorsFromText(firstPageText)` → string[]
- `parseDoi(text)` → string | null
- `parseYear(text)` → string | null
- `parseJournalFromHeader(firstPageText)` → string[]

**Step 3: Run lint**

Run: `cd backend && npx eslint src/services/citationMetadataExtractor.js --no-error-on-unmatched-pattern`

**Step 4: Commit**

```bash
git add backend/src/services/citationMetadataExtractor.js
git commit -m "feat: citation metadata extractor — parse author, year, journal, DOI from references"
```

---

### Task 3: Call extractor at upload time + expose in API

**Files:**
- Modify: `backend/src/controllers/referenceController.js`
- Modify: `backend/src/models/Reference.js`
- Modify: `backend/src/controllers/fileController.js`

**Step 1: Call extractor after text extraction in referenceController.upload()**

After the `content_text` and `page_boundaries` are computed, call:
```js
import { extractCitationMetadata } from '../services/citationMetadataExtractor.js'

const citationMetadata = extractCitationMetadata(file.originalname, text, pageBoundaries)
```

Pass `citationMetadata` to the Reference.create() call (as JSON string).

**Step 2: Update Reference model**

- In `create()`: accept and store `citation_metadata`
- In `findByBrand()`: include `citation_metadata` in SELECT
- In `findById()`: include `citation_metadata` in SELECT

**Step 3: Extend fileController.getText()**

Add `page_boundaries` to the response:
```js
res.json({
  id: ref.id,
  display_alias: ref.display_alias,
  content_text: ref.content_text,
  page_count: ref.page_count,
  page_boundaries: ref.page_boundaries
})
```

**Step 4: Run lint**

Run: `cd backend && npx eslint src/controllers/referenceController.js src/models/Reference.js src/controllers/fileController.js --no-error-on-unmatched-pattern`

**Step 5: Commit**

```bash
git add backend/src/controllers/referenceController.js backend/src/models/Reference.js backend/src/controllers/fileController.js
git commit -m "feat: extract citation metadata at upload, return page_boundaries from getText API"
```

---

### Task 4: Backfill script for existing references

**Files:**
- Create: `backend/scripts/backfill-citation-metadata.js`

**Step 1: Write backfill script**

- Open the SQLite database
- Query all references where `citation_metadata IS NULL` and `content_text IS NOT NULL`
- For each: call `extractCitationMetadata(filename, content_text, page_boundaries)`
- Update the row with the result
- Log progress: `[n/total] Backfilled: display_alias`
- Idempotent: skip refs that already have metadata

**Step 2: Run the backfill**

```bash
cd backend && node scripts/backfill-citation-metadata.js
```

Verify a few results:
```bash
node -e "const db = require('better-sqlite3')('./data/claims_detector.db'); const rows = db.prepare('SELECT id, display_alias, citation_metadata FROM reference_documents WHERE citation_metadata IS NOT NULL LIMIT 3').all(); rows.forEach(r => console.log(r.display_alias, JSON.parse(r.citation_metadata)))"
```

**Step 3: Commit**

```bash
git add backend/scripts/backfill-citation-metadata.js
git commit -m "feat: backfill citation metadata for existing references"
```

---

### Task 5: Upgrade frontend matching + page targeting

**Files:**
- Modify: `app/src/pages/MKG3ClaimsDetector.jsx`

**Step 1: Update loadBrandReferences to include citation_metadata**

In `loadBrandReferences()`, add `citationMetadata` to the ref object:
```js
citationMetadata: ref.citation_metadata ? JSON.parse(ref.citation_metadata) : null
```

**Step 2: Replace matchCitationToLibrary with metadata-aware scorer**

New scoring tiers:
1. **DOI match**: parse DOI from citation text, compare to `ref.citationMetadata.doi` → instant match
2. **Author + year**: parse first author surname and year from citation text, compare to `ref.citationMetadata.first_author` and `ref.citationMetadata.year` → strong match (0.8+). Bonus if journal tokens overlap.
3. **Author tokens overlap**: any author token from citation appears in `ref.citationMetadata.author_tokens` + year matches → medium match
4. **Fall back to existing Tier A/B/C** (name/alias matching) for references without metadata

Parse citation text with a helper:
```js
function parseCitationText(text) {
  const stripped = text.replace(/^\d+\.\s*/, '')
  const doi = stripped.match(/10\.\d{4,}\/\S+/)?.[0] || null
  const year = stripped.match(/\b(19|20)\d{2}\b/)?.[0] || null
  // First author: first word before any delimiter (comma, space+letter, "et al")
  const firstAuthor = stripped.match(/^([A-Za-z\u00C0-\u024F'-]+)/)?.[1]?.toLowerCase() || null
  return { doi, year, firstAuthor, normalized: stripped.toLowerCase().trim() }
}
```

**Step 3: Upgrade handleViewRef with content_text page search**

After matching the doc, before falling back to fact lookup:
1. Fetch `/api/files/references/:refId/text` (now returns `page_boundaries`)
2. Search `content_text` for claim text (normalized substring match)
3. If found: use char offset + `page_boundaries` to determine page number
4. Pass the matched substring as `excerpt` for highlighting
5. If not found: fall back to existing fact lookup
6. If fact lookup fails: page 1

Add a helper to resolve char offset to page:
```js
function charOffsetToPage(offset, pageBoundaries) {
  if (!pageBoundaries) return 1
  const boundaries = typeof pageBoundaries === 'string' ? JSON.parse(pageBoundaries) : pageBoundaries
  // page_boundaries is { "1": { start: 0, end: 500 }, "2": { start: 501, end: 1200 }, ... }
  for (const [pageNum, bounds] of Object.entries(boundaries)) {
    if (offset >= bounds.start && offset <= bounds.end) return parseInt(pageNum, 10)
  }
  return 1
}
```

**Step 4: Run lint**

Run: `cd app && npx eslint src/pages/MKG3ClaimsDetector.jsx --no-error-on-unmatched-pattern`

**Step 5: Commit**

```bash
git add app/src/pages/MKG3ClaimsDetector.jsx
git commit -m "feat: metadata-aware citation matching + content_text page targeting"
```

---

### Task 6: Integration test

**No files changed — verification only.**

1. Restart both dev servers
2. Navigate to `/mkg3`, select a brand with library references
3. Upload a test PDF and run annotation
4. Verify: ref callouts that were previously dimmed now show as linked (green, clickable)
5. Click a linked ref → verify PDF opens on the correct page (not page 1)
6. Check that the highlighted excerpt matches the relevant passage
7. Test with multiple ref callouts on the same claim card
8. Test edge cases: ref with no metadata, ref where content_text search fails

---

## Summary of changes

| File | What changes |
|------|-------------|
| `backend/migrations/006-citation-metadata.js` | New column `citation_metadata` on `reference_documents` |
| `backend/src/services/citationMetadataExtractor.js` | New: parse author, year, journal, DOI from filename + content |
| `backend/src/controllers/referenceController.js` | Call extractor at upload time |
| `backend/src/models/Reference.js` | Store/return citation_metadata |
| `backend/src/controllers/fileController.js` | Return page_boundaries from getText() |
| `backend/scripts/backfill-citation-metadata.js` | Backfill existing references |
| `app/src/pages/MKG3ClaimsDetector.jsx` | Metadata-aware matching + content_text page targeting |

**No new AI calls. No prompt changes. No frontend component changes beyond MKG3ClaimsDetector.**
