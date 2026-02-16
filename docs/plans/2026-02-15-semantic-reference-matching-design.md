# Semantic Reference Matching Design

**Date:** 2026-02-15
**Status:** Approved
**Problem:** Claim-to-reference matching accuracy is declining. Exact 1:1 lines present in reference documents are being missed because the current pipeline truncates references to 2,000 characters and uses fragile keyword matching.

## Root Cause Analysis

The current three-tier matching pipeline has three compounding weaknesses:

1. **Tier 2 truncation:** `truncateForPrompt()` in `referenceMatching.js` cuts each reference to 2,000 characters (~1 page). If the matching line is on page 5+ of a 20-page PI, the AI never sees it.
2. **Tier 1 keyword fragility:** Simple word-in-string matching with no stemming or synonym handling. "Reduction" won't match "reduced."
3. **Tier 0 fact lookup is lossy:** Depends on Gemini's non-deterministic fact extraction producing the right keywords. Missing facts = missing matches.

## Solution: Embedding-Based Semantic Search

Replace the keyword-based matching pipeline with a vector embedding search that covers the **full text** of all reference documents.

### Embedding Model

**Model:** `gemini-embedding-001` (Google's latest, #1 on MTEB multilingual leaderboard, score 68.32)
**Dimensions:** 768 (trimmed from 3072 default via Matryoshka Representation Learning)
**SDK:** `@google/genai` (already installed)
**Cost:** $0.15/1M tokens. For 54 references (~540 passages × ~300 tokens): ~$0.02 total.

### Vector Storage & Search

**Extension:** `sqlite-vec` — native vector KNN search for SQLite, integrates directly with `better-sqlite3`
**Benefits:** SIMD-accelerated C code, no JS loops, scales to thousands of references

### Chunking Strategy

- **Chunk size:** ~1,000 words (~4,000 characters) per passage
- **Overlap:** 200 words (20%) — ensures no claim-relevant sentence is split across boundaries
- **Validation:** Aligns with 2025 research recommending 512-1024 tokens for contextual document retrieval
- **Estimated passages:** 54 references × ~10 passages avg = ~540 total

## Data Model

### New Migration: `004_reference_embeddings.sql`

```sql
CREATE TABLE IF NOT EXISTS reference_passages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_id INTEGER NOT NULL,
  passage_index INTEGER NOT NULL,       -- 0-based order within document
  passage_text TEXT NOT NULL,            -- the ~1000 word chunk
  start_char INTEGER,                   -- offset in original content_text
  end_char INTEGER,                     -- for highlighting/navigation
  page_estimate INTEGER,                -- approximate page number
  embedding BLOB,                       -- 768-dim float32 vector
  embedding_model TEXT DEFAULT 'gemini-embedding-001',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reference_id) REFERENCES reference_documents(id) ON DELETE CASCADE,
  UNIQUE(reference_id, passage_index)
);
```

**Storage estimate:** 540 passages × 3,072 bytes (768 × 4 bytes) = ~1.6MB

## Embedding Pipeline (Backend)

### New Service: `passageEmbedder.js`

**Batch embedding:**
1. For each reference, split `content_text` into ~1000-word overlapping passages
2. Call `gemini-embedding-001` for each passage (768-dim output)
3. Store passage text + embedding BLOB in `reference_passages` table
4. Estimate page numbers from character offsets using average chars-per-page

**Auto-embed on upload:** Same pattern as auto-fact-indexing. When a new reference is uploaded, chunk + embed async in the background. Non-blocking, requires `VITE_GEMINI_API_KEY`.

**Re-embedding strategy:**
- On reference update/re-upload: delete all passages, re-chunk, re-embed
- On reference delete: `ON DELETE CASCADE` handles cleanup
- On batch re-index (`--force`): wipe and re-embed all
- Embeddings are deterministic — same text produces identical vectors

### New Model: `ReferencePassage.js`

- `findByReferenceId(refId)` — get all passages for a reference
- `findByBrandId(brandId)` — get all passages for a brand
- `createPassages(refId, passages)` — bulk insert passages with embeddings
- `deleteByReferenceId(refId)` — clean up on re-index or delete
- `searchByEmbedding(brandId, queryVector, topK)` — KNN search via sqlite-vec

### New Batch Script: `embed-references.js`

Same pattern as `index-references.js`:
- `--force` flag to re-embed all (even already embedded)
- `--brand "Brand Name"` to embed one brand only
- `--concurrency N` to control parallel API calls (default: 10)
- Rate limiting: Gemini embedding API allows 1,500 RPM

### Backend Endpoints

- `POST /api/brands/:brandId/references/embed` — trigger embedding for a brand
- `GET /api/brands/:brandId/embeddings/status` — check embedding status

## New Matching Pipeline

### Current Pipeline (Being Replaced)

```
Claim → Tier 0 fact keywords (60%+ overlap) → Tier 1 keyword pre-filter (top 8, 2000 chars each)
      → Tier 2 Gemini AI matching → Match result
```

### New Pipeline

```
Claim → Embed claim text → KNN search (sqlite-vec, top 5 passages) → AI confirmation → Match result
```

**Step by step:**

1. **Embed the claim:** Single API call to `gemini-embedding-001`. Returns 768-dim vector. (~50ms)
2. **KNN search:** sqlite-vec finds top 5 most similar passages across all brand references. Native SQL, SIMD-accelerated. (~5ms)
3. **AI confirmation:** Send claim + top 5 passages (FULL text, not truncated) to Gemini 2.0 Flash. The AI sees real, relevant content. (~1-2s)
4. **Return match:** Same output shape as current pipeline (reference name, page, excerpt, confidence, reasoning).

### What This Fixes

- **No more 2,000-char truncation** — every word of every reference is searchable
- **No more keyword fragility** — semantic similarity handles paraphrases and synonyms
- **Exact 1:1 lines score extremely high** in cosine similarity (nearly identical embeddings)
- **Fewer AI calls** — one embed + one confirmation vs. multi-tier approach
- **Deterministic retrieval** — embedding search is deterministic, unlike Gemini fact extraction

### Backward Compatibility

`matchAllClaimsToReferences()` keeps the same function signature and return shape. `MKG2ClaimsDetector.jsx` doesn't need changes — only the internals of the matching pipeline change.

## Frontend Changes

**Minimal:**
- Matching progress text: "Searching reference library..." instead of "Matching claim 3/15..."
- Reference cards in Library: "Embedded" badge (like current "Indexed" for facts)
- Batch embedding runs alongside fact indexing during setup

## Dependencies

- `sqlite-vec` npm package (new)
- `gemini-embedding-001` model access via `@google/genai` SDK (existing)

## What Stays the Same

- Claim detection step (all 3 AI services unchanged)
- Fact indexing (still useful for detection prompt grounding)
- Fact inventory in AI prompts (still appended for brand-aware detection)
- Feedback system
- Library tab / reference management
- MKG2ClaimsDetector page component

## References

- [Gemini Embedding GA](https://developers.googleblog.com/gemini-embedding-available-gemini-api/)
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec)
- [sqlite-vec Node.js integration](https://alexgarcia.xyz/sqlite-vec/js.html)
- [RAG Chunking Best Practices 2025](https://www.firecrawl.dev/blog/best-chunking-strategies-rag-2025)
- [NVIDIA Chunking Strategy](https://developer.nvidia.com/blog/finding-the-best-chunking-strategy-for-accurate-ai-responses/)
