# Claims Filter & Sort UX Updates

**Date:** February 17, 2026

## Summary

Two cosmetic UX changes to the claims display in POC2 (`/mkg2`):

1. Add an "All" status pill to the filter bar
2. Replace the confidence sort toggle with a sort dropdown that includes annotation number (document order) sorting

## Design

### 1. "All" Status Pill

**Layout:** `All (N) | Pending (N) | Approved (N) | Rejected (N)`

- "All" is the first pill, selected by default on load
- Count shows total claims across all statuses
- Active state: neutral/blue background
- Clicking any other pill deselects "All"; clicking "All" resets the filter
- Existing color coding stays: green for Approved, red for Rejected, blue for Pending
- No new state needed — `statusFilter` already defaults to `'all'`

### 2. Sort Dropdown (replaces confidence toggle)

**Replaces:** The "Confidence ↓/↑" toggle button

**Options:**
1. **Annotation #** (default) — sorts by `globalIndex` ascending (document order)
2. **Confidence: High → Low** — sorts by `confidence` descending
3. **Confidence: Low → High** — sorts by `confidence` ascending

**Implementation:** Native `<select>` styled to match existing filter bar. `sortOrder` state changes from binary (`'high-low'`/`'low-high'`) to three-value enum (`'annotation'`, `'confidence-desc'`, `'confidence-asc'`).

## Files Changed

| File | Change |
|------|--------|
| `app/src/pages/MKG2ClaimsDetector.jsx` | Add "All" pill, replace sort toggle with `<select>`, update sort/filter logic |
| `app/src/pages/MKGClaimsDetector.css` | Style "All" pill active state, style sort dropdown |

## Scope

- Cosmetic only, no backend changes
- No new components needed
- No new dependencies
