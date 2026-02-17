# V2 Matching Pipeline Debug & Calibration Design

**Date:** February 17, 2026
**Status:** Approved
**Goal:** Diagnose and fix the 4-8 point mapping regression in V2 (87% vs V1's 91-95%), with Codex peer review at every step.

## Problem

V2 matching pipeline is fully functional but mapping accuracy dropped from 91-95% (V1) to ~87% (V2). Claim detection is unaffected — the issue is specifically in claim-to-reference mapping.

## Root Cause Hypothesis

The regression is likely calibration, not architecture. V2 introduces 4 tiers with independent thresholds — any of these could silently drop valid matches:

1. **Tier 0.5 false positive** — fact-anchored search matches wrong reference at 0.90 similarity, short-circuits
2. **Tier 1 narrowed out** — `groupByReference` picks top 3 but right reference ranks 4th+
3. **Tier 2 too conservative** — Flash extraction returns `supported: false` on borderline claims
4. **Tier 2b too strict** — quote verification rejects legitimate quotes (LCS < 80% due to minor paraphrasing)

## Approach: Diagnostic Telemetry → Targeted Fixes

### Phase 1: Instrument Telemetry

Add structured logging at each tier boundary in `matchSingleClaim`:

| Tier | Log | Purpose |
|------|-----|---------|
| 0.5 (facts) | similarity, keyword/numeric overlap, match/skip | Detect false-positive fast matches |
| 1 (semantic) | passage count, top 3 scores, ref count after grouping | Check if narrowing is too aggressive |
| 2 (extraction) | per-ref: supported/not, quote count, reasoning | Check if Flash is too conservative |
| 2b (verification) | per-quote: verified/partial/unverified, LCS ratio | Check if verification rejects good quotes |
| Final | which tier produced match or "no match" + last tier | Where do losses concentrate? |

Output: `diagnostics` array on each claim result + pipeline summary in telemetry.

**Codex review checkpoint #1** after this phase.

### Phase 2: Test & Analyze

1. Run known test document through V2 with diagnostics
2. Categorize unmatched claims by failure tier
3. Identify dominant failure mode(s)

No code changes to matching logic — pure observation.

### Phase 3: Targeted Fixes

Fix one tier at a time, re-test after each:

| Failure mode | Fix | Risk |
|---|---|---|
| Tier 0.5 false positive | Raise threshold 0.90 → 0.93, require numeric match for statistical claims | Low |
| Tier 1 narrowed out | Increase TIER2_MAX_REFERENCES 3 → 5 | Low (~$0.005 extra/claim) |
| Tier 2 too conservative | Adjust extraction prompt permissiveness | Medium (false positive risk) |
| Tier 2b too strict | Lower LCS 80% → 70%, widen partial band | Low |

**Codex review checkpoint #2** after each fix.

### Phase 4: Final Integration

Full V2 diff review by Codex before declaring done.

**Codex review checkpoint #3.**

## Codex Review Checkpoints

1. **After telemetry** — Are we measuring the right things? Blind spots?
2. **After each fix** — Does fix address root cause? Side effects? Threshold values?
3. **After integration** — Full V2 vs V1 diff. Regression risk, edge cases, quality.

## Success Criteria

- V2 mapping accuracy >= 91% (matching V1)
- Every match includes a verifiable quote from the reference
- Pipeline is simpler than V1 (fewer env vars, fewer code paths)
- Codex approves at all 3 checkpoints
