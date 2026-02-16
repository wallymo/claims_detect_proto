# Reference Matching Optimization - Implementation Plan

**Date:** February 16, 2026  
**Scope:** Improve reference matching speed and match rate in MKG2 flow  
**Primary Surfaces:** `src/pages/MKG2ClaimsDetector.jsx`, `src/services/referenceMatching.js`, `../backend/src/controllers/passageController.js`, `../backend/src/models/ReferencePassage.js`

---

## Goal

Address two current problems in reference matching:
1. Matching takes too long.
2. Match rate is lower than needed for scope.

This plan keeps the current product flow, then improves it in low-risk phases with measurable gates.

---

## Current Baseline (Observed in Code + Local Data)

### Flow today
1. Claims are detected in `src/pages/MKG2ClaimsDetector.jsx`.
2. `runReferenceMatching()` preloads full text for all references via `fetchReferenceText(ref.id)`.
3. For each claim, `matchAllClaimsToReferences()` runs:
   - `POST /api/brands/:brandId/passages/search` (claim embedding + semantic retrieval)
   - Gemini confirmation call (`matchClaimToReferences`)
4. Claims are processed with concurrency = 3.

### Hotspots
- Unnecessary full-text prefetch for all references before matching.
- Two AI-related calls per claim.
- Backend `searchByEmbedding()` computes cosine in JS across all brand passages per request.
- Current `top_k=5` can miss valid references in dense corpora.

### Local corpus snapshot
- References: 54 non-deleted
- Embedded passages: 1,249
- All facts indexed: 54/54
- Largest doc has 275 passages (highly variable passage counts)

---

## Target End State (Definition of Done)

### Performance
- Reduce matching stage p95 latency by at least 60% from measured baseline.
- Reduce per-claim backend semantic retrieval latency p95 to <= 300ms on local corpus.
- Remove up-front "fetch all reference texts" blocking step from matching start.

### Quality
- Improve final matched-rate by at least +15 percentage points on benchmark set.
- Raise retrieval recall:
  - Recall@5 >= 85%
  - Recall@20 >= 95%
- Keep precision acceptable (>= 90% on manually reviewed sample of matched claims).

### Operability
- Add matching telemetry and stage timing in both frontend and backend.
- Add benchmark script/runbook to repeatably compare before/after.

---

## Implementation Plan (PR Sequence)

## PR1 - Instrumentation and Baseline
**Behavior label:** behavior-preserving  
**Risk:** Low  
**Testing strategy:** Add logs/metrics only; verify no matching output deltas.

### Files
- Modify: `src/pages/MKG2ClaimsDetector.jsx`
- Modify: `src/services/referenceMatching.js`
- Modify: `../backend/src/controllers/passageController.js`
- Modify: `../backend/src/models/ReferencePassage.js`

### Changes
1. Add stage timers in frontend:
   - `analysis_total_ms`
   - `matching_total_ms`
   - `reference_fetch_ms`
   - `per_claim_match_ms` (aggregate summary)
2. Add backend timing logs for `/passages/search`:
   - embedding generation ms
   - candidate retrieval ms
   - total request ms
3. Add structured summary logs:
   - total claims
   - matched count
   - unmatched count
   - tier breakdown (`semantic`, `semantic-direct`, `keyword-fallback`)

### Acceptance checks
- Running one matching job produces timing logs for every stage.
- No functional regression in UI output shape.

---

## PR2 - Remove Frontend Blocking Work
**Behavior label:** behavior-preserving  
**Risk:** Low  
**Testing strategy:** Compare matched outputs on same input before/after.

### Files
- Modify: `src/pages/MKG2ClaimsDetector.jsx`
- Modify: `src/services/referenceMatching.js`
- Optional modify: `src/services/api.js` (if helper endpoints needed)

### Changes
1. Remove eager `Promise.all(fetchReferenceText)` in `runReferenceMatching()`.
2. Pass lightweight reference metadata to matcher (`id`, `display_alias`) instead of full `content_text`.
3. Only fetch full reference text when fallback path actually needs it.
4. Keep matching progress status accurate (separate retrieve vs confirm stages).

### Acceptance checks
- Matching starts immediately after detection (no long "Loading reference texts..." phase).
- Matched-rate does not decrease on baseline examples.

---

## PR3 - Backend Retrieval Performance Upgrade
**Behavior label:** behavior-preserving (result order may shift slightly for ties)  
**Risk:** Medium  
**Testing strategy:** Benchmark endpoint latency and verify top-K stability on sampled claims.

### Files
- Modify: `../backend/src/models/ReferencePassage.js`
- Modify: `../backend/src/controllers/passageController.js`

### Changes
1. Optimize `searchByEmbedding()`:
   - First query only required fields for ranking (`id`, `reference_id`, `embedding`, `page_estimate`, `display_alias`).
   - Compute similarity on minimal payload.
   - Fetch `passage_text` only for top-N candidates after ranking.
2. Add configurable candidate depth:
   - `top_k` for client response (e.g., 5 or 8)
   - `candidate_pool` internal ranking depth (e.g., 20)
3. Add in-process cache for repeated query embeddings by normalized claim text (TTL-based).

### Acceptance checks
- `/passages/search` p95 improves significantly vs PR1 baseline.
- Returned schema remains backward compatible for frontend.

---

## PR4 - Match Policy Upgrade (Hybrid + Confidence Gating)
**Behavior label:** behavior-changing  
**Risk:** Medium  
**Testing strategy:** A/B on benchmark claims; inspect precision and recall deltas.

### Files
- Modify: `src/services/referenceMatching.js`
- Optional modify: `../backend/src/controllers/passageController.js` (if lexical features returned)

### Changes
1. Increase retrieval breadth:
   - request `top_k` > 5 (start with 20), rerank down client-side.
2. Add hybrid rerank score in matcher:
   - semantic similarity
   - keyword overlap
   - numeric overlap (percentages, p-values, N counts)
3. Add short-circuit rule:
   - If top candidate similarity >= threshold and lead margin >= threshold, auto-match without Gemini confirmation.
4. Run Gemini confirmation only for ambiguous claims.
5. Add claim dedup pass before matching (near-identical claim text) and fan-out result to duplicates.

### Acceptance checks
- Reduced number of Gemini confirmation calls per run.
- Match-rate and recall improve on benchmark set.
- Precision remains within target.

---

## PR5 - Indexing and Corpus Quality Improvements
**Behavior label:** behavior-changing (retrieval quality likely improves)  
**Risk:** Medium  
**Testing strategy:** Re-embed sample corpus and compare recall@K + match-rate.

### Files
- Modify: `../backend/src/services/passageEmbedder.js`
- Modify: `../backend/scripts/embed-references.js`
- Optional: add docs/runbook under `../backend/scripts/`

### Changes
1. Tune chunking strategy for retrieval quality:
   - reduce oversized chunks for dense references
   - keep overlap tuned for continuity
2. Add safe re-embedding flow:
   - dry-run option
   - brand scoping
   - progress output
3. Re-embed library and rerun benchmark.

### Acceptance checks
- Recall@K improvement vs pre-reembed baseline.
- No ingestion/indexing failures introduced.

---

## PR6 - Rollout, Guardrails, and Defaults
**Behavior label:** behavior-preserving by default, behavior-changing behind config flags  
**Risk:** Low  
**Testing strategy:** Feature-flag validation and rollback drill.

### Files
- Modify: `src/services/referenceMatching.js`
- Modify: `../backend/src/config/env.js` (if backend flags are introduced)
- Update docs: `README.md` and/or new ops note

### Changes
1. Gate aggressive matching behaviors behind flags:
   - `MATCHING_HYBRID_ENABLED`
   - `MATCHING_AUTOCONFIRM_ENABLED`
   - `MATCHING_TOPK`
2. Set conservative defaults.
3. Document rollback path and tuning knobs.

### Acceptance checks
- Can disable new behavior without code rollback.
- Team can tune thresholds safely in staging.

---

## Benchmark and Validation Plan

## Dataset
- Create a fixed benchmark set of claims with expected supporting references:
  - at least 100 claims
  - include easy, ambiguous, and hard/no-support cases

## Metrics to capture
- End-to-end matching duration
- Per-claim retrieval latency
- Per-claim confirmation latency
- Recall@5, Recall@20
- Final match-rate
- Precision on reviewed matched claims
- Fallback path frequency (`keyword-fallback`, `semantic-direct`)

## Run protocol
1. Record baseline metrics (current main state).
2. Run after each PR.
3. Keep a single markdown scorecard in repo.

---

## Commands to Run

### Frontend
```bash
npm test
npm run typecheck
npm run build
```

### Backend (from `../backend`)
```bash
npm run dev
node scripts/embed-references.js --brand "MKG Reference Library" --concurrency 5
```

### Smoke checks
- Upload doc in `/mkg2`
- Run analysis + matching
- Verify claims, match stats, and source viewer still function

---

## Rollback Strategy

1. Keep new matching heuristics behind flags from PR6.
2. If quality drops, disable auto-confirm first, then hybrid rerank.
3. If latency regresses, revert to previous retrieval path while keeping instrumentation.
4. Re-run benchmark after any rollback.

---

## Open Questions / Decisions Needed

1. Which metric is primary for scope sign-off: latency, match-rate, or precision?
2. What minimum precision is acceptable while increasing matched-rate?
3. Should reference matching use only brand-specific references, or continue using shared library pool only?
4. Do we want strict citation matching (exact passage evidence) or best-support matching (closest available)?

---

## Immediate Next Step

Start with **PR1 + PR2** in one working branch to quickly establish measurement and remove obvious latency waste, then decide threshold values for PR4 using benchmark data.

