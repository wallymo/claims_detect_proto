# Claims Filter & Sort UX Updates — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an "All" status pill and replace the confidence sort toggle with a sort dropdown (annotation #, confidence high/low).

**Architecture:** Two cosmetic changes in the existing filter bar JSX and CSS. No new components, no backend changes. State variable `sortOrder` changes from binary to three-value enum; `statusFilter` already supports `'all'`.

**Tech Stack:** React, CSS (no modules — these styles are in `App.css` and `MKGClaimsDetector.css`)

---

### Task 1: Add "All" status pill

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx:1469-1488`

**Step 1: Add the "All" pill as the first button in the statusToggleGroup**

Find this block (lines 1469-1488):

```jsx
                      <div className="statusToggleGroup">
                        <button
                          className={`statusToggleBtn ${statusFilter === 'pending' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
                        >
                          Pending ({pendingCount})
                        </button>
                        <button
                          className={`statusToggleBtn approved ${statusFilter === 'approved' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'approved' ? 'all' : 'approved')}
                        >
                          Approved ({approvedCount})
                        </button>
                        <button
                          className={`statusToggleBtn rejected ${statusFilter === 'rejected' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'rejected' ? 'all' : 'rejected')}
                        >
                          Rejected ({rejectedCount})
                        </button>
                      </div>
```

Replace with:

```jsx
                      <div className="statusToggleGroup">
                        <button
                          className={`statusToggleBtn ${statusFilter === 'all' ? 'active' : ''}`}
                          onClick={() => setStatusFilter('all')}
                        >
                          All ({claims.length})
                        </button>
                        <button
                          className={`statusToggleBtn ${statusFilter === 'pending' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
                        >
                          Pending ({pendingCount})
                        </button>
                        <button
                          className={`statusToggleBtn approved ${statusFilter === 'approved' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'approved' ? 'all' : 'approved')}
                        >
                          Approved ({approvedCount})
                        </button>
                        <button
                          className={`statusToggleBtn rejected ${statusFilter === 'rejected' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'rejected' ? 'all' : 'rejected')}
                        >
                          Rejected ({rejectedCount})
                        </button>
                      </div>
```

**Step 2: Verify in browser**

Run: Open `http://localhost:5173/mkg2`, upload a document, run analysis. Confirm:
- "All (N)" pill appears first, is active by default (blue highlight)
- Clicking Pending/Approved/Rejected deselects "All"
- Clicking "All" resets to showing all claims

**Step 3: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: add All status pill to claims filter bar"
```

---

### Task 2: Replace sort toggle with sort dropdown

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx:138` (state init)
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx:1115-1124` (sort logic)
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx:1496-1501` (sort UI)
- Modify: `app/src/App.css:238-251` (sort toggle → select styles)

**Step 1: Update `sortOrder` state default**

Find (line 138):

```jsx
  const [sortOrder, setSortOrder] = useState('high-low')
```

Replace with:

```jsx
  const [sortOrder, setSortOrder] = useState('annotation')
```

**Step 2: Update sort logic in `displayedClaims`**

Find (lines 1115-1124):

```jsx
  const displayedClaims = claims
    .filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (searchQuery && !c.text.toLowerCase().includes(searchQuery.toLowerCase())) return false
      return true
    })
    .sort((a, b) => sortOrder === 'high-low'
      ? b.confidence - a.confidence
      : a.confidence - b.confidence
    )
```

Replace with:

```jsx
  const displayedClaims = claims
    .filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (searchQuery && !c.text.toLowerCase().includes(searchQuery.toLowerCase())) return false
      return true
    })
    .sort((a, b) => {
      if (sortOrder === 'annotation') return (a.globalIndex ?? 0) - (b.globalIndex ?? 0)
      if (sortOrder === 'confidence-desc') return b.confidence - a.confidence
      return a.confidence - b.confidence
    })
```

**Step 3: Replace sort toggle button with `<select>`**

Find (lines 1496-1501):

```jsx
                        <button
                          className="sortToggle"
                          onClick={() => setSortOrder(prev => prev === 'high-low' ? 'low-high' : 'high-low')}
                        >
                          Confidence {sortOrder === 'high-low' ? '↓' : '↑'}
                        </button>
```

Replace with:

```jsx
                        <select
                          className="sortSelect"
                          value={sortOrder}
                          onChange={(e) => setSortOrder(e.target.value)}
                        >
                          <option value="annotation">Annotation #</option>
                          <option value="confidence-desc">Confidence ↓</option>
                          <option value="confidence-asc">Confidence ↑</option>
                        </select>
```

**Step 4: Update CSS — replace `.sortToggle` with `.sortSelect`**

In `app/src/App.css`, find (lines 238-251):

```css
.sortToggle {
  padding: var(--spacing-2) var(--spacing-3);
  border: none;
  background: transparent;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  transition: color 0.15s ease;
}

.sortToggle:hover {
  color: var(--color-text-primary);
}
```

Replace with:

```css
.sortSelect {
  padding: var(--spacing-2) var(--spacing-3);
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background: var(--color-background-primary);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  white-space: nowrap;
}

.sortSelect:focus {
  outline: none;
  border-color: var(--blue-5, #2196F3);
}
```

**Step 5: Check if `.sortToggle` is used elsewhere**

Run: `grep -r "sortToggle" app/src/` — if `Home.jsx` or `MKGClaimsDetector.jsx` reference it, update those too. If they do, keep the old `.sortToggle` class AND add the new `.sortSelect`.

**Step 6: Verify in browser**

Run: Open `http://localhost:5173/mkg2`, upload a document, run analysis. Confirm:
- Sort dropdown shows three options: "Annotation #", "Confidence ↓", "Confidence ↑"
- Default is "Annotation #" — claims show in document order (1, 2, 3...)
- Switching to "Confidence ↓" sorts highest confidence first
- Switching to "Confidence ↑" sorts lowest first

**Step 7: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx app/src/App.css
git commit -m "feat: replace sort toggle with dropdown (annotation #, confidence)"
```

---

### Task 3: Handle `.sortToggle` usage in other pages

**Files:**
- Check: `app/src/pages/Home.jsx`
- Check: `app/src/pages/MKGClaimsDetector.jsx`

**Step 1: Search for `.sortToggle` usage in other pages**

If `Home.jsx` or `MKGClaimsDetector.jsx` use `sortToggle`, either:
- (a) Keep the old `.sortToggle` CSS alongside `.sortSelect` in `App.css`, OR
- (b) Update those pages to use the new dropdown too (if desired)

Recommended: Keep `.sortToggle` CSS if other pages reference it (minimal blast radius).

**Step 2: Commit if any changes**

```bash
git add -A && git commit -m "fix: preserve sortToggle styles for other pages"
```

---

### Task 4: Final verification & cleanup

**Step 1: Run linter**

```bash
cd app && npm run lint
```

Fix any issues.

**Step 2: Run tests**

```bash
cd app && npm run test
```

Fix any failures.

**Step 3: Manual smoke test**

- Load `/mkg2`, upload a PDF, run analysis
- Confirm "All" pill works, sort dropdown works
- Confirm `/mkg` still works (no regressions)
- Confirm `/` (Home) still works

**Step 4: Final commit if needed**

```bash
git add -A && git commit -m "chore: lint and test fixes for filter/sort updates"
```
