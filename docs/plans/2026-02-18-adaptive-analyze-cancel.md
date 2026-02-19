# Adaptive Analyze Button + Cancel Analysis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the static "Analyze Document" button with one that adapts its label to "Re-analyze Document" when a cached result exists for the current file/settings, and add a Cancel button inside the ScannerOverlay so users can abort mid-analysis.

**Architecture:** Feature 1 adds proactive cache detection via `useEffect` + a local confirmation state to prevent accidental cache-busting. Feature 2 adds a `cancelAnalysisRef` (mutable ref, not state) that the analysis async flow checks at each major `await` checkpoint — chosen over AbortController because the AI SDK methods don't expose abort signals.

**Tech Stack:** React (useState, useEffect, useRef), sessionStorage cache, Framer Motion (ScannerOverlay already uses it), CSS Modules.

---

## Feature 1: Adaptive Analyze Button

### Task 1: Add `hasCachedResult` and `pendingReanalyzeConfirm` state

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx` (near other useState declarations, ~line 158)

**Step 1: Add two new state declarations**

Find the block of `useState` declarations and add after `const [cacheHit, setCacheHit] = useState(null)`:

```js
const [hasCachedResult, setHasCachedResult] = useState(false)
const [pendingReanalyzeConfirm, setPendingReanalyzeConfirm] = useState(false)
```

**Step 2: Verify no lint errors**

```bash
cd /Users/wallymo/claims_detector/app && npm run lint 2>&1 | head -20
```
Expected: no new errors.

**Step 3: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: add hasCachedResult + pendingReanalyzeConfirm state"
```

---

### Task 2: Add useEffect to proactively detect cached results

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx` (add after existing useEffects, before `handleAnalyze`)

**Step 1: Add the effect**

Find `const handleAnalyze = async () => {` (around line 551) and insert this block immediately before it:

```js
// Proactively check if current file+settings combo has a cached result
useEffect(() => {
  if (!uploadedFile) {
    setHasCachedResult(false)
    setPendingReanalyzeConfirm(false)
    return
  }
  const _promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
  const _refIds = referenceDocuments.map(r => r.id)
  const key = makeAnalysisCacheKey(
    uploadedFile, selectedModel, _promptKey, editablePrompt,
    selectedDocType || 'speaker-notes', selectedBrandId, _refIds
  )
  const cached = readAnalysisCache(key)
  setHasCachedResult(!!cached)
  // If file changed while confirm was showing, dismiss it
  setPendingReanalyzeConfirm(false)
}, [uploadedFile, selectedModel, selectedPrompt, editablePrompt, selectedDocType, selectedBrandId, referenceDocuments])
```

**Step 2: Verify lint**

```bash
cd /Users/wallymo/claims_detector/app && npm run lint 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: proactively detect cache hit for current file+settings"
```

---

### Task 3: Add `handleConfirmReanalyze` handler

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx` (after `handleForceRerun`, ~line 756)

**Step 1: Add handler**

After the `handleForceRerun` function, add:

```js
const handleConfirmReanalyze = () => {
  // Compute the key fresh in case currentCacheKeyRef hasn't been set yet
  const _promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
  const _refIds = referenceDocuments.map(r => r.id)
  const key = makeAnalysisCacheKey(
    uploadedFile, selectedModel, _promptKey, editablePrompt,
    selectedDocType || 'speaker-notes', selectedBrandId, _refIds
  )
  deleteAnalysisCache(key)
  if (currentCacheKeyRef.current) deleteAnalysisCache(currentCacheKeyRef.current)
  currentCacheKeyRef.current = null
  setCacheHit(null)
  setHasCachedResult(false)
  setPendingReanalyzeConfirm(false)
  handleAnalyze()
}
```

**Step 2: Verify lint**

```bash
cd /Users/wallymo/claims_detector/app && npm run lint 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: add handleConfirmReanalyze for cache-busting reanalysis"
```

---

### Task 4: Swap the Analyze button and add inline confirm row

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx` (~line 1543)
- Modify: `app/src/pages/MKGClaimsDetector.css` (add `.reanalyzeConfirm` styles)

**Step 1: Replace the existing `<Button>` block**

Find this block (around line 1543):

```jsx
<Button
  variant="primary"
  size="large"
  onClick={handleAnalyze}
  disabled={!canAnalyze}
>
  {isAnalyzing || isMatching ? (
    <>
      <Spinner size="small" />
      {isMatching ? 'Matching...' : 'Analyzing...'}
    </>
  ) : (
    <>
      <Icon name="zap" size={18} />
      Analyze Document
    </>
  )}
</Button>
```

Replace with:

```jsx
{pendingReanalyzeConfirm ? (
  <div className="reanalyzeConfirm">
    <span>Re-analyze from scratch?</span>
    <div className="reanalyzeConfirmActions">
      <Button variant="primary" size="small" onClick={handleConfirmReanalyze}>
        Confirm
      </Button>
      <Button variant="ghost" size="small" onClick={() => setPendingReanalyzeConfirm(false)}>
        Cancel
      </Button>
    </div>
  </div>
) : (
  <Button
    variant="primary"
    size="large"
    onClick={hasCachedResult ? () => setPendingReanalyzeConfirm(true) : handleAnalyze}
    disabled={!canAnalyze}
  >
    {isAnalyzing || isMatching ? (
      <>
        <Spinner size="small" />
        {isMatching ? 'Matching...' : 'Analyzing...'}
      </>
    ) : (
      <>
        <Icon name={hasCachedResult ? 'refreshCw' : 'zap'} size={18} />
        {hasCachedResult ? 'Re-analyze Document' : 'Analyze Document'}
      </>
    )}
  </Button>
)}
```

**Step 2: Remove the ghost Re-analyze button added earlier this session**

Find and remove this block (around line 1562, added earlier in this session):

```jsx
{analysisComplete && (
  <Button
    variant="ghost"
    size="small"
    onClick={handleForceRerun}
    disabled={isAnalyzing || isMatching}
  >
    <Icon name="refreshCw" size={14} />
    Re-analyze
  </Button>
)}
```

**Step 3: Add CSS for the confirm row**

Open `app/src/pages/MKGClaimsDetector.css` and add at the end:

```css
.reanalyzeConfirm {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  text-align: center;
}

.reanalyzeConfirm span {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.reanalyzeConfirmActions {
  display: flex;
  gap: 8px;
}
```

**Step 4: Verify in browser**

- Upload a file and analyze it
- Without changing any settings, upload the same file again (or re-open the page and re-upload the same file)
- Button should now read "Re-analyze Document" with a refreshCw icon
- Clicking it should show the inline confirm row
- "Confirm" should clear cache and run fresh
- "Cancel" should dismiss the row and restore the button

**Step 5: Lint check**

```bash
cd /Users/wallymo/claims_detector/app && npm run lint 2>&1 | head -20
```

**Step 6: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx app/src/pages/MKGClaimsDetector.css
git commit -m "feat: adaptive analyze button with Re-analyze Document + inline confirm"
```

---

## Feature 2: Cancel Analysis

### Task 5: Add `cancelAnalysisRef` and `handleCancelAnalysis`

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx`

**Step 1: Add the ref**

Near the other `useRef` declarations (around line 174), add:

```js
const cancelAnalysisRef = useRef(false)
```

**Step 2: Add reset at the top of `handleAnalyze`**

Inside `handleAnalyze`, immediately after the `if (!uploadedFile) return` guard (line ~552), add:

```js
cancelAnalysisRef.current = false
```

**Step 3: Add `handleCancelAnalysis`**

After `handleConfirmReanalyze`, add:

```js
const handleCancelAnalysis = () => {
  cancelAnalysisRef.current = true
  setIsAnalyzing(false)
  setIsMatching(false)
  setAnalysisComplete(false)
  setMatchingComplete(false)
  setAnalysisProgress(0)
  setAnalysisStatus('Analyzing document...')
  setClaims([])
  setMatchingStats(null)
  setCacheHit(null)
  setMatchingProgress('')
}
```

**Step 4: Lint check**

```bash
cd /Users/wallymo/claims_detector/app && npm run lint 2>&1 | head -20
```

**Step 5: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: add cancelAnalysisRef and handleCancelAnalysis"
```

---

### Task 6: Add cancel checkpoints inside `handleAnalyze`

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx`

Add `if (cancelAnalysisRef.current) return` after each major `await` in `handleAnalyze`. The helper macro to use is a single line — add it immediately after the listed await statements:

**Checkpoint 1** — after `await checkGeminiConnection()` (~line 594):
```js
if (cancelAnalysisRef.current) return
```

**Checkpoint 2** — after `pageImages = await pdfToImages(uploadedFile)` (~line 603):
```js
if (cancelAnalysisRef.current) return
```

**Checkpoint 3** — after `const factsData = await api.fetchFacts(...)` (inside the fact-fetching loop, ~line 627):
```js
if (cancelAnalysisRef.current) return
```

**Checkpoint 4** — after `const result = await analyzeDocument(...)` (~line 682), before `if (!result.success)`:
```js
if (cancelAnalysisRef.current) return
```

**Checkpoint 5** — after `await runReferenceMatching(...)` (~line 738):
```js
if (cancelAnalysisRef.current) return
```

**Step 2: Lint check**

```bash
cd /Users/wallymo/claims_detector/app && npm run lint 2>&1 | head -20
```

**Step 3: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: add cancel checkpoints throughout handleAnalyze"
```

---

### Task 7: Wire `onCancelAnalysis` through PDFViewer

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx` (~line 1664)
- Modify: `app/src/components/mkg/PDFViewer.jsx` (props interface + ScannerOverlay passthrough)

**Step 1: Pass prop in MKG2ClaimsDetector**

Find the `<PDFViewer` usage (~line 1665) and add:

```jsx
onCancelAnalysis={handleCancelAnalysis}
```

**Step 2: Accept and thread the prop in PDFViewer**

In `PDFViewer.jsx`, add `onCancelAnalysis` to the destructured props (line ~17):

```js
onCancelAnalysis,
```

Then find the `<ScannerOverlay` usage (~line 340) and add:

```jsx
onCancel={onCancelAnalysis}
```

**Step 3: Lint check**

```bash
cd /Users/wallymo/claims_detector/app && npm run lint 2>&1 | head -20
```

**Step 4: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx app/src/components/mkg/PDFViewer.jsx
git commit -m "feat: thread onCancelAnalysis from page through PDFViewer"
```

---

### Task 8: Add Cancel button to ScannerOverlay

**Files:**
- Modify: `app/src/components/claims-detector/ScannerOverlay.jsx`
- Modify: `app/src/components/claims-detector/ScannerOverlay.module.css`

**Step 1: Accept `onCancel` prop**

In `ScannerOverlay.jsx`, update the function signature:

```js
export default function ScannerOverlay({
  isScanning = false,
  progress: externalProgress,
  mockDuration = 2500,
  statusText = 'Analyzing document...',
  elapsedSeconds = 0,
  onComplete,
  onCancel,          // ← add this
}) {
```

**Step 2: Add Cancel button in the status display**

Find the `<div className={styles.statusContainer}>` block and update it:

```jsx
<div className={styles.statusContainer}>
  {showComplete ? (
    <span className={styles.checkmark}>✓</span>
  ) : (
    <>
      <p className={styles.statusText}>
        {statusText}
        {elapsedSeconds > 0 && <span className={styles.elapsed}> ({elapsedSeconds}s)</span>}
      </p>
      {onCancel && (
        <button className={styles.cancelBtn} onClick={onCancel}>
          Cancel
        </button>
      )}
    </>
  )}
</div>
```

**Step 3: Add CSS**

In `ScannerOverlay.module.css`, add at the end:

```css
.cancelBtn {
  margin-top: 10px;
  padding: 5px 18px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 6px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.cancelBtn:hover {
  border-color: rgba(255, 255, 255, 0.55);
  color: rgba(255, 255, 255, 0.9);
}
```

**Step 4: Verify in browser**

- Upload a file and click Analyze Document
- The ScannerOverlay should appear with a "Cancel" button below the status text
- Clicking Cancel should immediately dismiss the overlay and reset all state to a clean slate
- The Analyze Document button should be available again (same file, so if previously cached it shows Re-analyze Document)

**Step 5: Lint check**

```bash
cd /Users/wallymo/claims_detector/app && npm run lint 2>&1 | head -20
```

**Step 6: Commit**

```bash
git add app/src/components/claims-detector/ScannerOverlay.jsx app/src/components/claims-detector/ScannerOverlay.module.css
git commit -m "feat: add Cancel button to ScannerOverlay for mid-analysis abort"
```

---

## Final Verification

```bash
cd /Users/wallymo/claims_detector/app && npm run lint && npm run build 2>&1 | tail -20
```

Expected: lint clean, build completes (>500KB chunk warning is expected from pdf.js).
