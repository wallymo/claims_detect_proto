# Reference Matching V2: Fact-Anchored + Full-Reference Extraction

**Date:** February 17, 2026
**Status:** Approved
**Goal:** Improve matching recall — claims with valid references should not come back unmatched.

## Problem

The current matching pipeline has one retrieval path: embed the claim, cosine-search against 2400-char passage chunks. This misses matches when:

1. **Vocabulary mismatch** — claim and reference use different wording for the same concept
2. **Passage dilution** — key fact buried in a large chunk, embedding dominated by surrounding context
3. **Chunk boundary splits** — supporting sentence split across two chunks

## Design Principles

- **No deduplication.** Every claim instance is a separate MLR annotation, even if identical text appears on multiple pages. Per MLR requirements, each occurrence must be individually annotated.
- **Over-flag, never under-flag.** Consistent with existing project principles.
- **Verified quotes over confidence scores.** A verbatim quote from the reference is more useful to reviewers than a percentage.
- **Early termination.** Stop as soon as a verified match is found. Don't waste API calls on lower-ranked candidates.

## Pipeline Architecture

```
CLAIM → Tier 0.5 → Tier 1 → Tier 2 → Tier 2b
         (facts)    (narrow)  (extract)  (verify)
```

### Tier 0.5: Fact-Anchored Search

Matches claims against pre-extracted structured facts before touching the heavier pipeline.

**Data:** ~270 facts across 54 references (5 facts/ref, 8 categories). Already exist in `reference_facts` table.

**New:** Embed each fact using `gemini-embedding-001` (768-dim, same as passages). Store in new `embedding` BLOB column on `reference_facts`.

**Flow:**
1. Embed claim (use existing LRU cache)
2. Cosine search against brand's fact embeddings (~5-50 facts per brand, near-instant)
3. If top fact scores >= 0.90 similarity AND has keyword overlap (shared numeric token or 2+ keywords) → return match immediately
4. Otherwise → fall through to Tier 1

**Match tier name:** `fact-anchored`

**Cost:** One-time embedding of ~270 facts (~$0.001). Per-claim search is pure math.

### Tier 1: Semantic Retrieval (Reference Narrowing)

Existing pipeline repurposed. Goal shifts from "find best passage" to "identify top 2-3 candidate references."

**Flow:**
1. Embed claim → KNN search passages → hybrid rerank (semantic 75% + keyword 15% + numeric 10%)
2. Group results by reference
3. Pick top 3 references by their best passage hybrid score
4. If no passages above minimum threshold → return "no match"

**What stays:** Passage embeddings, KNN search, hybrid reranking, embedding cache.

**What's removed:** Auto-confirm gating, skip-confirm thresholds, diversity selection. These are no longer needed because Tier 2 handles confirmation differently.

### Tier 2: Full-Reference Extraction

The core change. Send full reference text to Gemini Flash and ask for exact verbatim quotes.

**Flow:**
1. Take top 3 candidate references from Tier 1
2. For each (in score order), send claim + full extracted text to Gemini Flash
3. AI returns: `{ supported: bool, quotes: [{ text, page_estimate }], reasoning }`
4. If `supported: true` → pass to Tier 2b for verification
5. If `supported: false` → try next reference
6. All 3 fail → return "no match"

**Key decisions:**
- **Full text, not PDF binary.** Already have extracted text from upload. Lower token count, works reliably.
- **One reference per call.** Avoids AI conflating text across references. Enables early termination.
- **Early termination.** If Ref #1 matches, skip Ref #2 and #3.
- **Model: Gemini Flash.** 1M context window, fast, cheap. ~25K tokens for a 50-page reference.

**Prompt design:**
```
You are an MLR reviewer verifying whether a reference document
supports a specific claim.

CLAIM: "[claim text]"

REFERENCE DOCUMENT:
[full extracted text]

TASK: Find the exact sentence(s) in this reference that substantiate
this claim. Quote them VERBATIM — do not paraphrase.

Return JSON:
{
  "supported": true/false,
  "quotes": [
    { "text": "exact verbatim quote", "page_estimate": 12 }
  ],
  "reasoning": "brief explanation"
}

If no text in this reference supports the claim, return supported: false.
```

**Cost per claim-reference pair:** ~$0.002-0.003 (Gemini Flash pricing, ~25K input tokens).

### Tier 2b: Quote Verification

Verify the AI's quote actually exists in the reference text. Catches hallucinations.

**Flow:**
1. Normalize both strings: lowercase, collapse whitespace, strip punctuation
2. Check (in order, stop at first hit):
   - Exact substring match → `verified`
   - Longest common subsequence >= 80% of quote length → `verified`
   - Key numeric tokens all present in same paragraph → `partial`
   - None of the above → `unverified`

**Outcomes:**

| Verification | Action |
|-------------|--------|
| Verified | Return match. Tier: `verified-extraction` |
| Partial | Return match, flag quote as approximate |
| Unverified | Discard. Try next reference (back to Tier 2). If all exhausted → no match |

**Page estimation:** When quote is found in reference text, use character offset to estimate page number. More accurate than AI's guess.

## What Gets Removed

| Component | Reason |
|-----------|--------|
| `selectConfirmationCandidates()` | No longer picking passage candidates for AI |
| Auto-confirm gating (4 thresholds + margin) | Tier 0.5 handles fast matches |
| Skip-confirm low-confidence gating (3 thresholds) | Tier 1 minimum threshold replaces this |
| `matchClaimToReferences()` classification prompt | Replaced by extraction prompt |
| Dedup grouping in `matchAllClaims()` | Removed per MLR requirement |
| 6 auto-confirm/skip-confirm env vars | Simpler pipeline, fewer knobs |

## What's New

| Component | Location |
|-----------|----------|
| Fact embedding column | Backend: migration 006 |
| Fact embedding script | Backend: `scripts/embed-facts.js` |
| Fact search endpoint | Backend: fact controller |
| Fact-anchored matching | Frontend: `referenceMatching.js` |
| Full-reference extraction prompt | Frontend: `gemini.js` |
| Quote verification utility | Frontend: `referenceMatching.js` |
| Reference full-text endpoint | Backend: reference controller |

## Cost Comparison (30-claim document)

| Scenario | Current | Proposed |
|----------|---------|----------|
| Best case (most match facts) | ~$0.15 | ~$0.01 |
| Average case | ~$0.15 | ~$0.05 |
| Worst case (all need extraction) | ~$0.15 | ~$0.18 |

## Success Criteria

- Claim-to-reference mapping recall improves measurably (target: >70%, stretch: >80%)
- Every match includes a verifiable quote from the reference
- Pipeline is simpler (fewer env vars, fewer code paths)
- Cost per analysis stays within 2x of current
