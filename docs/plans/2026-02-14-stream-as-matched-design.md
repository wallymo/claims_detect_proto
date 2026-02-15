# Stream-as-Matched Reference Matching

**Date:** 2026-02-14
**Status:** Approved

## Problem

The current pipeline is strictly sequential: detect ALL claims, then match ALL claims. The user sees nothing for 30-90s while both phases complete. This hurts perceived speed, total wait time, and UX feedback.

## Design: Incremental Claim Rendering

Instead of waiting for all matching to complete, push each enriched claim to the UI the moment it resolves.

### Changes

**1. `referenceMatching.js` — `matchAllClaimsToReferences`**

- `onProgress` callback signature changes: `(currentIndex, total, enrichedClaim)` — now includes the full enriched claim object
- Tier 0 (synchronous fact lookup) matches processed first in a tight loop — resolve instantly
- Tier 1+2 (async AI matching) batched at concurrency 5 as before

**2. `MKG2ClaimsDetector.jsx` — `runReferenceMatching`**

- Show all detected claims immediately in unmatched state before matching starts
- `onProgress` callback updates individual claims in state via `setClaims(prev => prev.map(...))`
- Stats computed after all matching completes (unchanged)

**3. Claim card UI**

- No new components needed
- Claims render in unmatched state first, then visually update when match resolves
- Existing `matched`/`reference` fields start as `undefined` and get filled in

### UX Timeline

| Time | What the user sees |
|------|-------------------|
| 0-30s | Detection spinner (unchanged) |
| ~30s | All claims appear at once (unmatched state) |
| ~30.01s | Tier 0 fact matches light up instantly with references |
| 30-60s | Remaining claims update one-by-one as Tier 2 AI matches resolve |
| ~60s | All done, final stats shown |

### Not Changing

- Detection remains one API call for whole PDF
- Batch concurrency stays at 5
- No new components or CSS
- No provisional/preview claims
- No per-page detection splitting
