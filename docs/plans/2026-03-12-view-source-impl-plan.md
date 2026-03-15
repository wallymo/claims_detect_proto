# View Source Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make ref callouts on claim cards clickable to open the matched library document in a PDF overlay, scrolled to and highlighting the relevant passage.

**Architecture:** Each ref callout becomes a clickable row. Click fires `onViewRef(ref, claimText)` callback → MKG3 page handler does Tier 1 fact lookup (API call to get facts for that reference, fuzzy match claim text to find page), falls back to Tier 2 (pass claim text as excerpt to existing ReferenceViewerContent which already does client-side text search). Opens existing overlay modal with `referenceViewerData`.

**Tech Stack:** React, pdf.js (existing), backend facts API (existing), CSS Modules

---

### Task 1: Make ref callouts clickable in MKGClaimCard

**Files:**
- Modify: `app/src/components/mkg/MKGClaimCard.jsx`
- Modify: `app/src/components/mkg/MKGClaimCard.module.css`

**Step 1: Update MKGClaimCard props and handler**

Add `onViewRef` prop. Replace the static ref callout divs with clickable ones. Remove the disabled "View Source" button.

In `MKGClaimCard.jsx`, update the component signature to accept `onViewRef`:

```jsx
export default function MKGClaimCard({
  claim,
  isActive = false,
  onApprove,
  onReject,
  onRemove,
  onSelect,
  onViewSource,
  onViewRef,
  brandReferences = [],
  trainingExamples = []
}) {
```

Replace the ref callouts section (lines ~197-218) with:

```jsx
{/* Reference callouts */}
{Array.isArray(claim.references) && claim.references.length > 0 && (
  <div className={styles.refCallouts}>
    {claim.references.map((ref, i) => {
      const isLinked = !!ref.id
      return (
        <div
          key={i}
          className={`${styles.refCallout} ${isLinked ? styles.refCalloutClickable : styles.refCalloutDimmed}`}
          onClick={isLinked ? (e) => { e.stopPropagation(); onViewRef?.(ref, claim.text) } : undefined}
          title={isLinked ? 'View source document' : 'Source document not in library'}
        >
          <span className={styles.refNumber}>{ref.number}.</span>
          <span className={styles.refText}>{ref.text}</span>
          {isLinked && <Icon name="fileSearch" size={12} className={styles.refViewIcon} />}
        </div>
      )
    })}
  </div>
)}
```

**Step 2: Add CSS for clickable and dimmed ref callouts**

In `MKGClaimCard.module.css`, add after the existing `.refCallout` block:

```css
.refCalloutClickable {
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.refCalloutClickable:hover {
  background: var(--green-2);
  border-color: var(--green-7);
}

.refCalloutClickable:hover .refText {
  text-decoration: underline;
}

.refCalloutDimmed {
  opacity: 0.55;
  cursor: default;
}

.refViewIcon {
  margin-left: auto;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.refCalloutClickable:hover .refViewIcon {
  opacity: 1;
}
```

**Step 3: Remove the disabled View Source button**

Delete the `{onViewSource && ( ... )}` block from MKGClaimCard.jsx (the disabled button at lines ~206-216).

**Step 4: Run lint to verify**

Run: `cd app && npx eslint src/components/mkg/MKGClaimCard.jsx --no-error-on-unmatched-pattern`
Expected: No errors

**Step 5: Commit**

```bash
git add app/src/components/mkg/MKGClaimCard.jsx app/src/components/mkg/MKGClaimCard.module.css
git commit -m "feat: make ref callouts clickable with hover states, remove disabled View Source button"
```

---

### Task 2: Wire onViewRef in MKG3ClaimsDetector with Tier 1 fact lookup

**Files:**
- Modify: `app/src/pages/MKG3ClaimsDetector.jsx`

**Step 1: Add handleViewRef handler with Tier 1 fact lookup**

Replace the existing `handleViewSource` function (~line 1329) with a new `handleViewRef` that does Tier 1 fact lookup before opening the overlay:

```jsx
const handleViewRef = async (ref, claimText) => {
  if (!ref.id) return

  // Tier 1: Try fact lookup to find the best page
  let targetPage = 1
  let excerpt = claimText // fallback: use claim text for Tier 2 text search in ReferenceViewerContent

  if (selectedBrand) {
    try {
      const factData = await api.fetchFacts(selectedBrand, ref.id)
      if (factData?.facts?.length > 0) {
        // Fuzzy match: find the fact whose text best matches the claim text
        const normalize = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
        const normalizedClaim = normalize(claimText)
        let bestFact = null
        let bestScore = 0

        for (const fact of factData.facts) {
          const normalizedFact = normalize(fact.text)
          // Score: substring containment check (either direction)
          let score = 0
          if (normalizedFact.includes(normalizedClaim) || normalizedClaim.includes(normalizedFact)) {
            score = Math.min(normalizedFact.length, normalizedClaim.length) / Math.max(normalizedFact.length, normalizedClaim.length)
          } else {
            // Check keyword overlap
            const claimWords = new Set(normalizedClaim.split(/\s+/).filter(w => w.length > 3))
            const factWords = normalizedFact.split(/\s+/).filter(w => w.length > 3)
            const overlap = factWords.filter(w => claimWords.has(w)).length
            score = claimWords.size > 0 ? overlap / claimWords.size : 0
          }
          if (score > bestScore) {
            bestScore = score
            bestFact = fact
          }
        }

        if (bestFact && bestScore > 0.3 && bestFact.page) {
          targetPage = bestFact.page
          excerpt = bestFact.text // use the exact fact text for precise highlighting
        }
      }
    } catch (err) {
      logger.warn('[ViewRef] Tier 1 fact lookup failed, falling back to text search:', err.message)
    }
  }

  // Open the overlay — ReferenceViewerContent handles Tier 2 (text search) via its existing excerpt highlighting
  setReferenceViewerData({
    referenceId: ref.id,
    page: targetPage,
    excerpt
  })
}
```

**Step 2: Pass onViewRef to all MKGClaimCard instances**

Find all `<MKGClaimCard` instances in MKG3ClaimsDetector.jsx and add `onViewRef={handleViewRef}` prop. There are 3 instances (search for `onViewSource={() => handleViewSource`):

Replace each `onViewSource={() => handleViewSource(claim)}` with `onViewRef={handleViewRef}`.

Note: The `onViewSource` prop can remain on MKGClaimCard for backward compatibility with MKG/MKG2, but in MKG3 we only use `onViewRef`.

**Step 3: Run lint to verify**

Run: `cd app && npx eslint src/pages/MKG3ClaimsDetector.jsx --no-error-on-unmatched-pattern`
Expected: No errors

**Step 4: Commit**

```bash
git add app/src/pages/MKG3ClaimsDetector.jsx
git commit -m "feat: wire onViewRef with Tier 1 fact lookup + Tier 2 text search fallback"
```

---

### Task 3: Clean up unused sourceBadgeOnPage CSS

**Files:**
- Modify: `app/src/components/mkg/MKGClaimCard.module.css`

**Step 1: Remove dead CSS**

The `sourceBadgeOnPage` class is no longer referenced in JSX (removed in earlier session). Delete it:

```css
/* DELETE this block */
.sourceBadgeOnPage {
  composes: sourceBadge;
  background: var(--green-1);
  color: var(--green-11);
}
```

**Step 2: Commit**

```bash
git add app/src/components/mkg/MKGClaimCard.module.css
git commit -m "chore: remove unused sourceBadgeOnPage CSS class"
```

---

### Task 4: Manual integration test

**No files changed — verification only.**

**Step 1: Start dev servers**

Run: `cd app && npm run dev` (in one terminal)
Run: `cd backend && npm run dev` (in another terminal)

**Step 2: Test the flow**

1. Navigate to `/mkg3`
2. Select a brand that has library references with indexed facts
3. Upload a test PDF and run annotation
4. In the claims panel, find a claim card with green ref callouts
5. Verify: matched refs (with `ref.id`) show hover effect — background shift, underline, fileSearch icon appears
6. Verify: unmatched refs (no `ref.id`) appear dimmed, no hover, tooltip "Source document not in library"
7. Click a matched ref → overlay opens showing the library PDF
8. Verify: PDF scrolls to the correct page and highlights the relevant passage
9. Close overlay, click a different ref on the same card → different document/page opens
10. Verify: no "View Source" button appears at the bottom of the ref callouts group

**Step 3: Test edge cases**

- Claim card with 0 references → no ref callouts section shown (unchanged behavior)
- Claim card where Tier 1 has no facts → overlay opens at page 1 with claim text as search term
- Claim card where no text match found → PDF opens at page 1, no highlight (graceful degradation)

**Step 4: Commit any fixes if needed**

---

## Summary of changes

| File | What changes |
|------|-------------|
| `MKGClaimCard.jsx` | Add `onViewRef` prop, make ref callouts clickable (linked) or dimmed (unlinked), remove disabled View Source button |
| `MKGClaimCard.module.css` | Add `.refCalloutClickable`, `.refCalloutDimmed`, `.refViewIcon` hover states. Remove `.sourceBadgeOnPage` |
| `MKG3ClaimsDetector.jsx` | Replace `handleViewSource` with `handleViewRef` (Tier 1 fact lookup + fallback). Pass `onViewRef` to all MKGClaimCard instances |

**No new files. No backend changes.** All existing infrastructure (facts API, ReferenceViewerContent, overlay modal) is reused.
