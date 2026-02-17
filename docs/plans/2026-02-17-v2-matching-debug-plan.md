# V2 Matching Pipeline Debug & Calibration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Instrument per-tier diagnostics in the V2 matching pipeline, identify where the 4-8 point mapping regression occurs, and apply targeted fixes — with Codex peer review gating each phase.

**Architecture:** Add a `diagnostics` array to each claim result that traces its path through the 4-tier pipeline (Tier 0.5 facts → Tier 1 semantic → Tier 2 extraction → Tier 2b verification). Analyze the output to find the dominant failure mode, then fix one tier at a time.

**Tech Stack:** React/Vite frontend, referenceMatching.js, quoteVerifier.js, gemini.js, Vitest

**Design doc:** `docs/plans/2026-02-17-v2-matching-debug-design.md`

---

## Phase 1: Diagnostic Telemetry

### Task 1: Add diagnostics array to matchSingleClaim

**Files:**
- Modify: `app/src/services/referenceMatching.js:442-518`

**Step 1: Add diagnostics collector at top of matchSingleClaim**

In `matchSingleClaim`, after `const claimStartedAt = Date.now()` (line 451), add a diagnostics array that each tier populates:

```javascript
const claimStartedAt = Date.now()
const diagnostics = []
```

**Step 2: Instrument Tier 0.5 (fact-anchored search)**

Replace the Tier 0.5 block (lines 454-459) with:

```javascript
    // Tier 0.5: Fact-anchored search
    onStage?.('facts')
    const factMatch = await factAnchoredSearch(claim, brandId, telemetry)
    diagnostics.push({
      tier: '0.5-facts',
      result: factMatch ? 'matched' : 'no-match',
      similarity: factMatch?._diag?.similarity ?? null,
      keywordOverlap: factMatch?._diag?.keywordMatches ?? null,
      numericOverlap: factMatch?._diag?.numericMatches ?? null
    })
    if (factMatch) {
      delete factMatch._diag
      return { ...claim, ...factMatch, diagnostics }
    }
```

**Step 3: Instrument Tier 1 (semantic retrieval)**

Replace the Tier 1 block (lines 461-500) with:

```javascript
    // Tier 1: Semantic retrieval → narrow to top references
    let searchResults = []
    try {
      telemetry.semantic_search_count++
      onStage?.('retrieve')
      const retrievalTopK = Math.max(topK, candidatePool)
      const response = await api.searchPassages(brandId, claim.text, retrievalTopK, { candidatePool })
      searchResults = (response.results || []).slice(0, candidatePool)
    } catch (err) {
      telemetry.keyword_fallback_count++
      onStage?.('fallback')
      logger.warn(`Semantic search failed for claim ${claim.id}, falling back to keyword matching:`, err.message)
      diagnostics.push({ tier: '1-semantic', result: 'error', error: err.message })
      const fallbackResult = await keywordFallbackMatch(claim, getFallbackReferencesWithText, telemetry)
      return { ...fallbackResult, diagnostics }
    }

    if (searchResults.length === 0) {
      diagnostics.push({ tier: '1-semantic', result: 'no-passages', passageCount: 0 })
      return {
        ...claim,
        matched: false,
        reference: null,
        matchReasoning: 'No similar passages found in reference library',
        diagnostics
      }
    }

    // Hybrid rerank
    const rerankedResults = MATCHING_HYBRID_ENABLED
      ? rerankSemanticResults(claim.text, searchResults)
      : enrichSemanticOnlyResults(searchResults)

    // Group by reference — pick top N
    const candidateRefs = groupByReference(rerankedResults, TIER2_MAX_REFERENCES)

    diagnostics.push({
      tier: '1-semantic',
      result: candidateRefs.length > 0 ? 'narrowed' : 'no-candidates',
      passageCount: searchResults.length,
      topPassageScores: rerankedResults.slice(0, 5).map(r => ({
        refName: r.display_alias,
        semantic: Number(r.semantic_score?.toFixed(3)),
        hybrid: Number(r.hybrid_score?.toFixed(3))
      })),
      candidateRefCount: candidateRefs.length,
      candidateRefs: candidateRefs.map(r => ({
        refName: r.display_alias,
        bestHybrid: Number(r.bestHybridScore?.toFixed(3)),
        bestSemantic: Number(r.bestSemanticScore?.toFixed(3))
      }))
    })

    if (candidateRefs.length === 0) {
      return {
        ...claim,
        matched: false,
        reference: null,
        matchReasoning: 'No candidate references found above threshold',
        diagnostics
      }
    }
```

**Step 4: Instrument Tier 2 + 2b (extraction + verification)**

Replace the Tier 2 block (lines 502-514) with:

```javascript
    // Tier 2 + 2b: Full-reference extraction with quote verification
    onStage?.('extract')
    const extractionMatch = await fullReferenceExtraction(claim, candidateRefs, allReferences, telemetry, diagnostics)
    if (extractionMatch) {
      return { ...claim, ...extractionMatch, diagnostics }
    }

    diagnostics.push({ tier: 'final', result: 'no-match', lastTier: 'extraction' })
    return {
      ...claim,
      matched: false,
      reference: null,
      matchReasoning: 'No verified supporting quote found in top candidate references',
      diagnostics
    }
```

**Step 5: Update the finally block to include diagnostics**

The `finally` block (line 515-517) stays the same — it only records timing.

**Step 6: Verify lint passes**

Run: `cd app && npm run lint -- --no-warn-ignored 2>&1 | head -20`
Expected: No errors related to referenceMatching.js.

---

### Task 2: Instrument factAnchoredSearch with diagnostic data

**Files:**
- Modify: `app/src/services/referenceMatching.js:286-331`

**Step 1: Add _diag to the return value**

Replace the `factAnchoredSearch` function (lines 286-331) — the only change is passing diagnostic data through a `_diag` property that the caller strips:

```javascript
async function factAnchoredSearch(claim, brandId, telemetry) {
  try {
    const response = await api.searchFacts(brandId, claim.text)
    const results = response.results || []
    if (results.length === 0) return null

    const top = results[0]
    if (top.similarity < FACT_ANCHOR_MIN_SIMILARITY) return null

    const claimKeywords = extractKeywords(claim.text)
    const claimNumerics = extractNumericTokens(claim.text)
    const factTexts = (top.facts || []).map(f => f.text || '').join(' ').toLowerCase()

    const keywordMatches = claimKeywords.filter(kw => factTexts.includes(kw))
    const numericMatches = claimNumerics.filter(n => factTexts.includes(n))

    if (keywordMatches.length < FACT_ANCHOR_MIN_KEYWORD_OVERLAP && numericMatches.length === 0) {
      return null
    }

    const bestFact = (top.facts || []).reduce((best, fact) => {
      const factLower = (fact.text || '').toLowerCase()
      const score = claimKeywords.filter(kw => factLower.includes(kw)).length
      return score > (best?.score || 0) ? { ...fact, score } : best
    }, null)

    telemetry.fact_anchored_count = (telemetry.fact_anchored_count || 0) + 1
    return {
      matched: true,
      matchConfidence: top.similarity,
      matchTier: 'fact-anchored',
      reference: {
        id: top.reference_id,
        name: top.display_alias,
        page: bestFact?.page || null,
        excerpt: bestFact?.text || top.facts?.[0]?.text || null
      },
      matchReasoning: `Fact-anchored match (similarity ${(top.similarity * 100).toFixed(0)}%, ${keywordMatches.length} keywords, ${numericMatches.length} numerics)`,
      _diag: {
        similarity: Number(top.similarity?.toFixed(3)),
        keywordMatches: keywordMatches.length,
        numericMatches: numericMatches.length,
        refName: top.display_alias
      }
    }
  } catch (err) {
    logger.warn('Fact-anchored search failed, falling through:', err.message)
    return null
  }
}
```

---

### Task 3: Instrument fullReferenceExtraction with per-ref diagnostics

**Files:**
- Modify: `app/src/services/referenceMatching.js:351-429`

**Step 1: Add diagnostics parameter and per-ref logging**

Replace `fullReferenceExtraction` — add a `diagnostics` parameter and push per-reference results:

```javascript
async function fullReferenceExtraction(claim, candidateRefs, allReferences, telemetry, diagnostics = []) {
  for (const candidateRef of candidateRefs) {
    const refDiag = {
      tier: '2-extraction',
      refName: candidateRef.display_alias,
      refId: candidateRef.reference_id
    }

    try {
      const refObj = allReferences.find(r => r.id === candidateRef.reference_id)
      if (!refObj) {
        refDiag.result = 'ref-not-found'
        diagnostics.push(refDiag)
        continue
      }

      const textData = await api.fetchReferenceText(candidateRef.reference_id)
      if (!textData?.content_text) {
        refDiag.result = 'no-text'
        diagnostics.push(refDiag)
        continue
      }

      refDiag.textLength = textData.content_text.length
      telemetry.extraction_ai_calls = (telemetry.extraction_ai_calls || 0) + 1

      const extractionResult = await extractSupportingQuote(
        claim.text,
        textData.content_text,
        candidateRef.display_alias
      )

      accumulateMatchingUsage(telemetry, extractionResult?.usage)

      const result = extractionResult?.result
      if (!result || !result.supported || !result.quotes?.length) {
        refDiag.result = 'not-supported'
        refDiag.supported = result?.supported ?? null
        refDiag.quoteCount = result?.quotes?.length ?? 0
        refDiag.reasoning = result?.reasoning?.slice(0, 200) ?? null
        diagnostics.push(refDiag)
        continue
      }

      // Tier 2b: Verify the quote
      const bestQuote = result.quotes[0]
      const verification = verifyQuote(bestQuote.text, textData.content_text)

      refDiag.quoteLength = bestQuote.text?.length ?? 0
      refDiag.verificationStatus = verification.status
      refDiag.quotePreview = bestQuote.text?.slice(0, 120) ?? null

      if (verification.status === 'unverified') {
        telemetry.unverified_quotes = (telemetry.unverified_quotes || 0) + 1

        // Try second quote if available
        if (result.quotes.length > 1) {
          const altVerification = verifyQuote(result.quotes[1].text, textData.content_text)
          refDiag.altQuoteStatus = altVerification.status
          refDiag.altQuotePreview = result.quotes[1].text?.slice(0, 120) ?? null

          if (altVerification.status !== 'unverified') {
            refDiag.result = 'matched-alt-quote'
            diagnostics.push(refDiag)

            const pageEstimate = altVerification.charOffset != null && textData.page_count
              ? Math.floor(altVerification.charOffset / (textData.content_text.length / textData.page_count)) + 1
              : result.quotes[1].page_estimate
            return {
              matched: true,
              matchConfidence: altVerification.status === 'verified' ? 0.90 : 0.75,
              matchTier: altVerification.status === 'verified' ? 'verified-extraction' : 'partial-extraction',
              reference: {
                id: candidateRef.reference_id,
                name: candidateRef.display_alias,
                page: pageEstimate,
                excerpt: result.quotes[1].text
              },
              matchReasoning: result.reasoning
            }
          }
        }

        refDiag.result = 'unverified'
        diagnostics.push(refDiag)
        continue
      }

      // Verified or partial match
      const pageEstimate = verification.charOffset != null && textData.page_count
        ? Math.floor(verification.charOffset / (textData.content_text.length / textData.page_count)) + 1
        : bestQuote.page_estimate

      telemetry.verified_quotes = (telemetry.verified_quotes || 0) + 1
      refDiag.result = 'matched'
      refDiag.matchTier = verification.status === 'verified' ? 'verified-extraction' : 'partial-extraction'
      diagnostics.push(refDiag)

      return {
        matched: true,
        matchConfidence: verification.status === 'verified' ? 0.95 : 0.80,
        matchTier: verification.status === 'verified' ? 'verified-extraction' : 'partial-extraction',
        reference: {
          id: candidateRef.reference_id,
          name: candidateRef.display_alias,
          page: pageEstimate,
          excerpt: bestQuote.text
        },
        matchReasoning: result.reasoning
      }
    } catch (err) {
      logger.warn(`Extraction failed for ref ${candidateRef.reference_id}:`, err.message)
      refDiag.result = 'error'
      refDiag.error = err.message
      diagnostics.push(refDiag)
      continue
    }
  }

  return null
}
```

---

### Task 4: Add pipeline summary to telemetry output

**Files:**
- Modify: `app/src/services/referenceMatching.js:626-726` (matchAllClaimsToReferences)

**Step 1: Add pipeline summary after all claims processed**

After `telemetry.per_claim_match_ms = summarizeDurations(...)` (line 722), add a pipeline summary that aggregates diagnostics across all claims:

```javascript
  telemetry.matching_total_ms = Date.now() - startedAt
  telemetry.per_claim_match_ms = summarizeDurations(telemetry.per_claim_durations_ms)
  delete telemetry.per_claim_durations_ms

  // Pipeline summary: count outcomes by tier
  const pipelineSummary = {
    fact_anchored_matched: 0,
    semantic_no_passages: 0,
    semantic_narrowed: 0,
    extraction_matched: 0,
    extraction_not_supported: 0,
    extraction_unverified: 0,
    no_match: 0,
    errors: 0
  }
  for (const claim of results) {
    if (!claim?.diagnostics) continue
    const lastDiag = claim.diagnostics[claim.diagnostics.length - 1]
    if (!lastDiag) continue

    if (claim.matchTier === 'fact-anchored') pipelineSummary.fact_anchored_matched++
    else if (claim.matchTier === 'verified-extraction' || claim.matchTier === 'partial-extraction') pipelineSummary.extraction_matched++
    else if (claim.matchTier === 'keyword-fallback') pipelineSummary.errors++ // shouldn't happen often
    else if (!claim.matched) {
      // Dig into why it didn't match
      const extractionDiags = claim.diagnostics.filter(d => d.tier === '2-extraction')
      const hasUnverified = extractionDiags.some(d => d.result === 'unverified')
      const hasNotSupported = extractionDiags.some(d => d.result === 'not-supported')
      if (hasUnverified) pipelineSummary.extraction_unverified++
      else if (hasNotSupported) pipelineSummary.extraction_not_supported++
      else pipelineSummary.no_match++
    }
  }
  telemetry.pipeline_summary = pipelineSummary

  return { claims: results, telemetry }
```

**Step 2: Run lint**

Run: `cd app && npm run lint -- --no-warn-ignored 2>&1 | head -20`
Expected: No errors.

**Step 3: Run existing tests**

Run: `cd app && npx vitest run test/utils/quoteVerifier.test.js`
Expected: All 6 tests pass (diagnostics don't affect quoteVerifier).

**Step 4: Commit**

```bash
git add app/src/services/referenceMatching.js
git commit -m "feat: add per-tier diagnostic telemetry to V2 matching pipeline"
```

---

### Task 5: Codex peer review — Phase 1 checkpoint

**Step 1: Run Codex review**

Run: `/codex-review`

Codex should review the diagnostic instrumentation for:
- Are all tier decision points captured?
- Any blind spots (e.g., missing the case where Tier 0.5 skips due to low similarity)?
- Does the diagnostics array add excessive memory pressure?
- Is the pipeline_summary aggregation correct?

**Step 2: Address Codex feedback if any**

Fix any issues found, re-run lint and tests, commit fixes.

---

## Phase 2: Test & Analyze

### Task 6: Run test document and collect diagnostics

**Step 1: Ensure both servers are running**

Run (terminal 1): `cd backend && npm run dev`
Run (terminal 2): `cd app && npm run dev`

**Step 2: Run a test document through /mkg2**

1. Open `http://localhost:5173/mkg2`
2. Select a brand with references loaded
3. Upload a test PDF (use one from `MKG Knowledge Base/`)
4. Run analysis with Gemini
5. Open browser DevTools → Console
6. Look for telemetry output with `pipeline_summary`
7. Look for individual claim `diagnostics` arrays

**Step 3: Export the results**

In the browser console, after analysis completes, copy the telemetry and claim results. Save to a temporary file for analysis.

**Step 4: Analyze failure distribution**

Look at `pipeline_summary`:
- How many claims went through each tier?
- Where did unmatched claims fail?
- What's the dominant failure mode?

Look at individual `diagnostics` for unmatched claims:
- Did Tier 1 find the right reference? (check candidateRefs names)
- Did Tier 2 say "not-supported" or did it find a quote that Tier 2b rejected?
- For "unverified" quotes — what did the quote look like? (check quotePreview)

---

## Phase 3: Targeted Fixes

### Task 7: Fix dominant failure mode (determined by Phase 2 data)

This task is a template — the exact fix depends on what Phase 2 reveals. Here are the pre-planned fixes for each possible failure mode:

**If Tier 0.5 false positives (fact-anchored matches wrong ref):**

Modify `app/src/services/referenceMatching.js:282-284`:
```javascript
const FACT_ANCHOR_MIN_SIMILARITY = 0.93  // was 0.90
```

Or add numeric requirement for statistical claims — in `factAnchoredSearch`, after the keyword/numeric check:
```javascript
    // For claims with numbers, require at least 1 numeric match
    if (claimNumerics.length > 0 && numericMatches.length === 0) {
      return null
    }
```

**If Tier 1 narrowed out (right ref not in top 3):**

Modify `app/src/services/referenceMatching.js:284`:
```javascript
const TIER2_MAX_REFERENCES = 5  // was 3
```

**If Tier 2 too conservative (Flash says "not supported"):**

Modify `app/src/services/gemini.js:809-835` — adjust the extraction prompt:

Change the rules section to:
```
Rules:
- Return supported=true if the reference contains text that substantiates OR partially supports the claim.
- Quotes must be VERBATIM text from the reference document above. Copy-paste, do not rephrase.
- If the reference contains related content that a reviewer should see, return supported=true even if support is indirect.
- Multiple quotes are allowed if multiple sentences together substantiate the claim.
- Err on the side of inclusion — it's better to surface a potentially relevant quote than to miss a real match.
- If no text in this reference is remotely related to the claim, return supported=false with empty quotes array.
```

**If Tier 2b too strict (verification rejects good quotes):**

Modify `app/src/utils/quoteVerifier.js:42`:
```javascript
  if (bestLcsRatio >= 0.70) {  // was 0.80
```

**Step 1: Apply the fix for the dominant failure mode**

One change at a time. Commit after each.

**Step 2: Re-test with same document**

Run the same test document. Compare pipeline_summary before/after.

**Step 3: Commit**

```bash
git add [changed files]
git commit -m "fix: [description of which tier was fixed and how]"
```

---

### Task 8: Codex peer review — Phase 3 checkpoint

**Step 1: Run Codex review**

Run: `/codex-review`

Codex reviews the targeted fix for:
- Does it address the root cause identified in Phase 2?
- Any side effects or regression risk?
- Are the new threshold values reasonable?

**Step 2: Address Codex feedback if any**

Fix issues, re-test, commit.

---

### Task 9: Final integration validation

**Step 1: Run full test pass**

Run: `cd app && npm run test`
Expected: All tests pass.

Run: `cd app && npm run lint`
Expected: No errors.

**Step 2: Run end-to-end test in browser**

Repeat the same test document from Phase 2. Verify:
- Mapping accuracy is >= 91% (matching V1)
- `pipeline_summary` shows improvement in the failure mode that was fixed
- Matched claims include `diagnostics` array and verifiable quotes

**Step 3: Codex final review**

Run: `/codex-review`

Full review of all uncommitted V2 changes vs the committed V1 code. Check for:
- Regression risk
- Edge cases
- Code quality
- Any remaining dead code

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: V2 matching pipeline with diagnostic telemetry and calibrated thresholds"
```

---

## Execution Notes

- **Tasks 1-4** are the telemetry instrumentation — sequential, all in referenceMatching.js
- **Task 5** is Codex review checkpoint #1
- **Task 6** is manual testing + data collection
- **Task 7** is the targeted fix (depends on Task 6 findings)
- **Task 8** is Codex review checkpoint #2
- **Task 9** is final validation + Codex review checkpoint #3
