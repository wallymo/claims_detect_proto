# Stream-as-Matched Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make reference matching results appear incrementally in the UI as each claim resolves, instead of waiting for all claims to finish.

**Architecture:** Modify `matchAllClaimsToReferences` to pass enriched claim data through the `onProgress` callback. The page component updates individual claims in React state as they resolve. Tier 0 (synchronous) matches appear instantly; Tier 2 (AI) matches trickle in.

**Tech Stack:** React state updates, existing referenceMatching.js pipeline, Vitest for tests.

---

### Task 1: Add tests for streaming callback behavior

**Files:**
- Create: `app/test/services/referenceMatching.test.js`

**Step 1: Write the test file**

Tests verify that `matchAllClaimsToReferences` calls `onProgress` with enriched claim objects (not just the original claim).

```js
import { describe, it, expect, vi } from 'vitest'

// We need to mock the Gemini AI matching since it requires API keys
vi.mock('../../src/services/gemini.js', () => ({
  matchClaimToReferences: vi.fn().mockResolvedValue({
    matched: true,
    referenceIndex: 1,
    confidence: 0.85,
    referenceName: 'Test Reference',
    pageInReference: 1,
    supportingExcerpt: 'Test excerpt',
    reasoning: 'Test reasoning'
  })
}))

import { matchAllClaimsToReferences, getMatchingStats } from '../../src/services/referenceMatching.js'

describe('matchAllClaimsToReferences', () => {
  const mockClaims = [
    { id: 'claim_001', text: 'Reduces cardiovascular events by 47%', confidence: 0.9, type: 'efficacy' },
    { id: 'claim_002', text: 'Well-tolerated safety profile', confidence: 0.8, type: 'safety' }
  ]

  const mockReferences = [
    { id: 1, display_alias: 'Study A', content_text: 'cardiovascular events reduced 47% in trial patients' },
    { id: 2, display_alias: 'Study B', content_text: 'safety profile well tolerated in clinical trials' }
  ]

  it('calls onProgress with enriched claim containing match data', async () => {
    const progressCalls = []
    const onProgress = (current, total, enrichedClaim) => {
      progressCalls.push({ current, total, enrichedClaim })
    }

    await matchAllClaimsToReferences(mockClaims, mockReferences, onProgress)

    expect(progressCalls).toHaveLength(2)

    // Each progress call should include the enriched claim with match fields
    for (const call of progressCalls) {
      expect(call.enrichedClaim).toBeDefined()
      expect(call.enrichedClaim).toHaveProperty('id')
      expect(call.enrichedClaim).toHaveProperty('matched')
      expect(call.enrichedClaim).toHaveProperty('reference')
    }
  })

  it('enriched claims have correct IDs matching original claims', async () => {
    const enrichedResults = []
    const onProgress = (_current, _total, enrichedClaim) => {
      enrichedResults.push(enrichedClaim)
    }

    await matchAllClaimsToReferences(mockClaims, mockReferences, onProgress)

    const ids = enrichedResults.map(c => c.id).sort()
    expect(ids).toEqual(['claim_001', 'claim_002'])
  })

  it('still returns the full results array', async () => {
    const results = await matchAllClaimsToReferences(mockClaims, mockReferences, vi.fn())

    expect(results).toHaveLength(2)
    expect(results[0]).toHaveProperty('matched')
    expect(results[1]).toHaveProperty('matched')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run test/services/referenceMatching.test.js`
Expected: FAIL — `onProgress` currently receives the raw claim, not the enriched one. The test checking for `enrichedClaim.matched` will fail because the current callback passes `claim` (pre-enrichment), not `enriched` (post-enrichment).

**Step 3: Commit failing tests**

```bash
git add app/test/services/referenceMatching.test.js
git commit -m "test: add failing tests for streaming onProgress callback"
```

---

### Task 2: Update `matchAllClaimsToReferences` to pass enriched claims in callback

**Files:**
- Modify: `app/src/services/referenceMatching.js:220-240`

**Step 1: Change the onProgress call to pass enriched claim**

In `matchAllClaimsToReferences`, line 233, change from passing the raw `claim` to passing `enriched`:

```js
// Line 230-234, change:
return matchSingleClaim(claim, references, brandFacts).then(enriched => {
  results[idx] = enriched
  completed++
  onProgress?.(completed, claims.length, enriched)  // was: claim
})
```

This is a one-line change: `claim` → `enriched` on line 233.

**Step 2: Run tests to verify they pass**

Run: `cd app && npx vitest run test/services/referenceMatching.test.js`
Expected: PASS — all 3 tests green.

**Step 3: Commit**

```bash
git add app/src/services/referenceMatching.js
git commit -m "feat: pass enriched claim data through onProgress callback"
```

---

### Task 3: Update `MKG2ClaimsDetector` to render claims incrementally

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx:611-624`

**Step 1: Refactor `runReferenceMatching` for incremental updates**

Replace lines 611-624 with:

```js
      // Show all claims immediately in unmatched state
      setClaims(detectedClaims)

      const enrichedClaims = await matchAllClaimsToReferences(
        detectedClaims,
        validRefs,
        (current, total, enrichedClaim) => {
          setMatchingProgress(`Matching claim ${current} of ${total}...`)
          // Update individual claim in state as it resolves
          setClaims(prev => prev.map(c =>
            c.id === enrichedClaim.id ? enrichedClaim : c
          ))
        },
        brandFacts
      )

      // Final state: use the full results array for stats
      setClaims(enrichedClaims)
      const stats = getMatchingStats(enrichedClaims)
      setMatchingStats(stats)
      setMatchingComplete(true)
      setMatchingProgress('')
```

Key changes:
- Added `setClaims(detectedClaims)` before matching starts — claims appear immediately
- `onProgress` callback now receives 3rd arg `enrichedClaim` and updates that specific claim in state
- Final `setClaims(enrichedClaims)` remains as safety net to ensure consistent end state

**Step 2: Verify manually**

Run both servers:
1. `cd backend && npm run dev`
2. `cd app && npm run dev`

Open `/mkg2`, select a brand, upload a PDF, run detection. After detection completes:
- All claims should appear immediately (without match data)
- Claims should update one-by-one as matches resolve
- Tier 0 matches should appear near-instantly
- Final stats should show after all matching completes

**Step 3: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: render claims incrementally during reference matching"
```

---

### Task 4: Run full test suite and verify no regressions

**Step 1: Run all tests**

Run: `cd app && npm run test`
Expected: All tests pass, no regressions.

**Step 2: Run lint**

Run: `cd app && npm run lint`
Expected: No new errors.

**Step 3: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address test/lint issues from stream-as-matched"
```
