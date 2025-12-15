# MKG Pure Claim Detection - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify MKG Claims Detector to pure claim detection without reference matching.

**Architecture:** Remove Knowledge Base, update filters to status-based, use persona prompt from file, show confidence tiers in results summary.

**Tech Stack:** React, Vite, Gemini API, PDF.js, Framer Motion

---

## Task 1: Remove Knowledge Base Panel

**Files:**
- Modify: `src/pages/MKGClaimsDetector.jsx`

**Step 1: Remove Knowledge Base imports and state**

In `MKGClaimsDetector.jsx`, remove:

```jsx
// DELETE this import
import KnowledgeBasePanel from '@/components/mkg/KnowledgeBasePanel'

// DELETE this state block (around line 42-51)
const [knowledgeBase, setKnowledgeBase] = useState({
  folders: [
    {
      name: 'References',
      expanded: false,
      files: []
    }
  ]
})
```

**Step 2: Remove Knowledge Base AccordionItem from JSX**

Remove the entire AccordionItem block for "Knowledge Base Used" (around lines 228-238):

```jsx
// DELETE this entire block
<AccordionItem
  title="Knowledge Base Used"
  defaultOpen={true}
  size="small"
  content={
    <KnowledgeBasePanel
      knowledgeBase={knowledgeBase}
      onKnowledgeBaseChange={setKnowledgeBase}
    />
  }
/>
```

**Step 3: Verify app still runs**

Run: `npm run dev`
Expected: App loads without Knowledge Base panel in left sidebar

**Step 4: Commit**

```bash
git add src/pages/MKGClaimsDetector.jsx
git commit -m "feat(mkg): remove Knowledge Base panel"
```

---

## Task 2: Update Results Summary with Confidence Tiers

**Files:**
- Modify: `src/pages/MKGClaimsDetector.jsx`
- Modify: `src/pages/MKGClaimsDetector.css`

**Step 1: Add confidence tier calculation**

In `MKGClaimsDetector.jsx`, add after the existing filter logic (around line 156):

```jsx
// Confidence tier counts
const highConfidenceClaims = claims.filter(c => c.confidence >= 0.9)
const mediumConfidenceClaims = claims.filter(c => c.confidence >= 0.7 && c.confidence < 0.9)
const lowConfidenceClaims = claims.filter(c => c.confidence < 0.7)
```

**Step 2: Replace Results Summary content**

Find the Results Summary AccordionItem content (around lines 293-320) and replace:

```jsx
<AccordionItem
  title="Results Summary"
  defaultOpen={true}
  size="small"
  content={
    <div className="resultsSummary">
      <div className="resultRow">
        <span className="resultLabel">Total Claims Found</span>
        <span className="resultValue">{claims.length}</span>
      </div>
      <div className="divider" />
      <div className="resultRow highConf">
        <span className="resultLabel">High Confidence (90-100%)</span>
        <span className="resultValue">{highConfidenceClaims.length}</span>
      </div>
      <div className="resultRow medConf">
        <span className="resultLabel">Medium (70-89%)</span>
        <span className="resultValue">{mediumConfidenceClaims.length}</span>
      </div>
      <div className="resultRow lowConf">
        <span className="resultLabel">Low (&lt;70%)</span>
        <span className="resultValue">{lowConfidenceClaims.length}</span>
      </div>
      <div className="divider" />
      <div className="metaRow">
        <span className="metaItem">
          <Icon name="zap" size={14} />
          {(processingTime / 1000).toFixed(1)}s
        </span>
        <span className="metaDot">•</span>
        <span className="metaItem">
          {MODEL_OPTIONS.find(m => m.id === selectedModel)?.label}
        </span>
      </div>
    </div>
  }
/>
```

**Step 3: Add CSS for confidence tier rows**

In `MKGClaimsDetector.css`, add:

```css
.resultRow.highConf .resultLabel { color: var(--green-7, #388E3C); }
.resultRow.medConf .resultLabel { color: var(--amber-7, #F57C00); }
.resultRow.lowConf .resultLabel { color: var(--red-7, #D32F2F); }
```

**Step 4: Verify confidence breakdown displays**

Run: `npm run dev`
Upload a PDF and analyze. Expected: Results Summary shows confidence tier breakdown.

**Step 5: Commit**

```bash
git add src/pages/MKGClaimsDetector.jsx src/pages/MKGClaimsDetector.css
git commit -m "feat(mkg): add confidence tier breakdown to results summary"
```

---

## Task 3: Update Claims Panel Filters (Status Toggles)

**Files:**
- Modify: `src/pages/MKGClaimsDetector.jsx`
- Modify: `src/pages/MKGClaimsDetector.css`

**Step 1: Add status filter state**

In `MKGClaimsDetector.jsx`, replace the `claimView` state (around line 38):

```jsx
// REPLACE this:
const [claimView, setClaimView] = useState('matched')

// WITH this:
const [statusFilter, setStatusFilter] = useState('all') // all, pending, approved, rejected
```

**Step 2: Update filter logic**

Replace the existing displayedClaims logic (around lines 156-167):

```jsx
// Status counts
const pendingCount = claims.filter(c => c.status === 'pending').length
const approvedCount = claims.filter(c => c.status === 'approved').length
const rejectedCount = claims.filter(c => c.status === 'rejected').length

// Filter and sort claims
const displayedClaims = claims
  .filter(c => {
    // Status filter
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    // Search filter
    if (searchQuery && !c.text.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })
  .sort((a, b) => sortOrder === 'high-low'
    ? b.confidence - a.confidence
    : a.confidence - b.confidence
  )
```

**Step 3: Replace filter bar JSX**

Find the claimsFilterBar div (around lines 351-380) and replace:

```jsx
{analysisComplete && (
  <div className="claimsFilterBar">
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
    <div className="claimsSearchSort">
      <Input
        placeholder="Search claims..."
        size="small"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <button
        className="sortToggle"
        onClick={() => setSortOrder(prev => prev === 'high-low' ? 'low-high' : 'high-low')}
      >
        Confidence {sortOrder === 'high-low' ? '↓' : '↑'}
      </button>
    </div>
  </div>
)}
```

**Step 4: Update CSS for status toggles**

In `MKGClaimsDetector.css`, replace `.claimViewToggle` styles with:

```css
.statusToggleGroup {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.statusToggleBtn {
  padding: 6px 12px;
  border: 1px solid var(--gray-3, #e0e0e0);
  border-radius: 16px;
  background: var(--gray-1, #fafafa);
  color: var(--gray-7, #616161);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.statusToggleBtn:hover {
  background: var(--gray-2, #f5f5f5);
}

.statusToggleBtn.active {
  background: var(--blue-1, #E3F2FD);
  border-color: var(--blue-5, #2196F3);
  color: var(--blue-7, #1976D2);
}

.statusToggleBtn.approved.active {
  background: var(--green-1, #E8F5E9);
  border-color: var(--green-5, #4CAF50);
  color: var(--green-7, #388E3C);
}

.statusToggleBtn.rejected.active {
  background: var(--red-1, #FFEBEE);
  border-color: var(--red-5, #F44336);
  color: var(--red-7, #D32F2F);
}
```

**Step 5: Verify status filters work**

Run: `npm run dev`
Upload and analyze. Approve/reject some claims. Expected: Status toggles filter correctly.

**Step 6: Commit**

```bash
git add src/pages/MKGClaimsDetector.jsx src/pages/MKGClaimsDetector.css
git commit -m "feat(mkg): replace matched/unmatched with status filters"
```

---

## Task 4: Remove Claim Highlighting from PDFViewer

**Files:**
- Modify: `src/components/mkg/PDFViewer.jsx`

**Step 1: Remove highlighting-related props usage**

In `PDFViewer.jsx`, the component already receives `claims`, `activeClaim`, `onClaimClick` but doesn't use them for highlighting (just shows claim count). No changes needed to the viewer itself.

**Step 2: Remove unused props from parent**

In `MKGClaimsDetector.jsx`, simplify the PDFViewer props (around line 326):

```jsx
<PDFViewer
  file={uploadedFile}
  isAnalyzing={isAnalyzing}
  onClose={handleRemoveDocument}
  onScanComplete={() => {}}
/>
```

Remove `claims`, `activeClaim`, `onClaimClick` props since we're not using highlighting.

**Step 3: Update PDFViewer to not show claim count**

In `PDFViewer.jsx`, remove the claim count from footer (around lines 188-191):

```jsx
// DELETE this block
{claims.length > 0 && (
  <span className={styles.claimCount}>
    {claims.length} claims detected
  </span>
)}
```

**Step 4: Clean up PDFViewer props**

Update PDFViewer function signature to remove unused props:

```jsx
export default function PDFViewer({
  file,
  onClose,
  isAnalyzing = false,
  onScanComplete
}) {
```

Remove the `claims = []`, `activeClaim`, `onClaimClick` from destructuring.

**Step 5: Verify PDF viewer still works**

Run: `npm run dev`
Expected: PDF displays without claim-related features.

**Step 6: Commit**

```bash
git add src/components/mkg/PDFViewer.jsx src/pages/MKGClaimsDetector.jsx
git commit -m "feat(mkg): remove claim highlighting from PDF viewer"
```

---

## Task 5: Update Gemini Service to Use Persona Prompt

**Files:**
- Modify: `src/services/gemini.js`

**Step 1: Create persona prompt loader**

Add function to load persona from file. Since we're in browser, we'll embed the prompt directly (the file serves as documentation/source of truth):

```jsx
// Add at top of gemini.js after imports

// Persona prompt - source of truth: docs/workflow/pharma_claims_persona.md
const CLAIM_DETECTION_PROMPT = `You are a high-recall promotional claim detection engine for healthcare marketing materials.

## Objective
Detect whether statements imply promotional claims, with maximum detection sensitivity. Flag liberally; final judgment rests with the user.

## Detection Categories (internal use)
1. Return to Normal Implication - "Be you again," "Get back to what you love"
2. Speed or Magnitude Language - "Fast," "All-day relief," "Powerful"
3. Competitive Framing - "Smarter choice," "Advanced," "Next-gen"
4. Risk Minimization - "Gentle," "Simple to use," "Natural ingredients"
5. Appeal to Authority - "Doctor recommended," "Proven in studies"

## Confidence Scoring
- 90-100%: Direct/obvious claim (e.g., "Clinically proven," numeric efficacy data)
- 70-89%: Strong implication (e.g., "Reclaim life," "Works where others fail")
- 40-69%: Vague but possibly suggestive (e.g., "Support," "New," "Fresh feeling")
- 1-39%: Possibly navigational or tone-dependent

## Processing Rules
- Review ALL text including image descriptions
- Flag any segment that could reasonably imply a health-related benefit
- Use exact language when quoting claims
- Do not exclude edge cases

## Output Format (STRICT - JSON only)
Return a JSON object with this exact structure:
{
  "claims": [
    {
      "claim": "[Exact extracted phrase]",
      "confidence": [0-100 integer]
    }
  ]
}

Analyze the document and return ALL potential promotional claims.`
```

**Step 2: Update analyzeDocument function**

Replace the existing prompt in `analyzeDocument` function:

```jsx
export async function analyzeDocument(pdfFile, options = {}) {
  const client = getGeminiClient()
  const base64Data = await fileToBase64(pdfFile)

  try {
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { text: CLAIM_DETECTION_PROMPT },
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: base64Data
              }
            }
          ]
        }
      ],
      config: {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    })

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
    const result = JSON.parse(text)

    // Transform to frontend format
    const claims = (result.claims || []).map((claim, index) => ({
      id: `claim_${String(index + 1).padStart(3, '0')}`,
      text: claim.claim,
      confidence: claim.confidence / 100, // Convert 0-100 to 0-1
      status: 'pending'
    }))

    return {
      success: true,
      claims
    }
  } catch (error) {
    console.error('Gemini analysis error:', error)
    return {
      success: false,
      error: error.message,
      claims: []
    }
  }
}
```

**Step 3: Remove unused exports**

Remove `matchClaimToReferences` function since we're not doing reference matching.

**Step 4: Verify claim detection works**

Run: `npm run dev`
Upload a PDF and analyze. Expected: Claims detected with confidence scores.

**Step 5: Commit**

```bash
git add src/services/gemini.js
git commit -m "feat(mkg): use persona prompt for claim detection"
```

---

## Task 6: Simplify Claim Cards (Remove Type/Source)

**Files:**
- Modify: `src/pages/MKGClaimsDetector.jsx`

**Step 1: Verify ClaimCard props**

The ClaimCard component already supports `hideType` and `hideSource` props. In MKGClaimsDetector.jsx, they're already set to `true` (line 419-420):

```jsx
<ClaimCard
  claim={claim}
  isActive={activeClaim === claim.id}
  onApprove={handleClaimApprove}
  onReject={handleClaimReject}
  onSelect={() => handleClaimClick(claim.id)}
  hideType={true}
  hideSource={true}
/>
```

**Step 2: Remove activeClaim logic since no highlighting**

Since we removed claim highlighting, simplify the ClaimCard usage:

```jsx
<ClaimCard
  claim={claim}
  onApprove={handleClaimApprove}
  onReject={handleClaimReject}
  hideType={true}
  hideSource={true}
/>
```

Remove `isActive` and `onSelect` props.

**Step 3: Remove activeClaim state and handler**

Remove from state declarations:
```jsx
// DELETE
const [activeClaim, setActiveClaim] = useState(null)
```

Remove handler:
```jsx
// DELETE
const handleClaimClick = (claimId) => {
  setActiveClaim(claimId)
}
```

**Step 4: Verify claim cards display correctly**

Run: `npm run dev`
Expected: Claim cards show text + confidence + approve/reject, no type badge or source.

**Step 5: Commit**

```bash
git add src/pages/MKGClaimsDetector.jsx
git commit -m "feat(mkg): simplify claim cards without selection state"
```

---

## Task 7: Add Real Progress Tracking to Scanner

**Files:**
- Modify: `src/components/claims-detector/ScannerOverlay.jsx`
- Modify: `src/pages/MKGClaimsDetector.jsx`
- Modify: `src/services/gemini.js`

**Step 1: Update ScannerOverlay to accept external progress**

Replace the ScannerOverlay component:

```jsx
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import styles from './ScannerOverlay.module.css'
import ProgressRing from './ProgressRing'
import AIParticles from './AIParticles'

export default function ScannerOverlay({
  isScanning = false,
  progress = 0, // External progress 0-100
  statusText = 'Analyzing document...',
  onComplete
}) {
  const [scanLineY, setScanLineY] = useState(0)
  const [showComplete, setShowComplete] = useState(false)

  useEffect(() => {
    if (progress >= 100 && isScanning) {
      setShowComplete(true)
      const timeout = setTimeout(() => {
        setShowComplete(false)
        onComplete?.()
      }, 600)
      return () => clearTimeout(timeout)
    }
  }, [progress, isScanning, onComplete])

  useEffect(() => {
    if (!isScanning) {
      setShowComplete(false)
    }
  }, [isScanning])

  if (!isScanning && !showComplete) return null

  return (
    <div className={styles.overlay}>
      {!showComplete && (
        <motion.div
          className={styles.scanLine}
          initial={{ top: '0%' }}
          animate={{ top: '100%' }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            ease: 'linear'
          }}
          onUpdate={(latest) => {
            const topValue = parseFloat(latest.top)
            setScanLineY(topValue)
          }}
        />
      )}

      <AIParticles scanLineY={scanLineY} isActive={isScanning && !showComplete} />

      <div className={styles.progressContainer}>
        <ProgressRing
          percentage={progress}
          size={140}
          strokeWidth={10}
          showComplete={showComplete}
        />
        <p className={styles.statusText}>
          {showComplete ? 'Analysis complete' : statusText}
        </p>
      </div>
    </div>
  )
}
```

**Step 2: Add progress state to MKGClaimsDetector**

Add new state:

```jsx
const [analysisProgress, setAnalysisProgress] = useState(0)
const [analysisStatus, setAnalysisStatus] = useState('')
```

**Step 3: Update PDFViewer to pass progress**

```jsx
<PDFViewer
  file={uploadedFile}
  isAnalyzing={isAnalyzing}
  analysisProgress={analysisProgress}
  analysisStatus={analysisStatus}
  onClose={handleRemoveDocument}
  onScanComplete={() => {}}
/>
```

**Step 4: Update PDFViewer to accept and pass progress**

In PDFViewer.jsx:

```jsx
export default function PDFViewer({
  file,
  onClose,
  isAnalyzing = false,
  analysisProgress = 0,
  analysisStatus = '',
  onScanComplete
}) {
  // ... existing code ...

  // Update ScannerOverlay usage:
  <ScannerOverlay
    isScanning={isAnalyzing}
    progress={analysisProgress}
    statusText={analysisStatus}
    onComplete={onScanComplete}
  />
}
```

**Step 5: Update analyzeDocument to report progress**

In gemini.js, add progress callback:

```jsx
export async function analyzeDocument(pdfFile, onProgress) {
  const client = getGeminiClient()

  onProgress?.(10, 'Preparing document...')
  const base64Data = await fileToBase64(pdfFile)

  onProgress?.(30, 'Sending to AI...')

  try {
    const response = await client.models.generateContent({
      // ... existing config
    })

    onProgress?.(80, 'Processing results...')

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
    const result = JSON.parse(text)

    const claims = (result.claims || []).map((claim, index) => ({
      id: `claim_${String(index + 1).padStart(3, '0')}`,
      text: claim.claim,
      confidence: claim.confidence / 100,
      status: 'pending'
    }))

    onProgress?.(100, 'Complete')

    return { success: true, claims }
  } catch (error) {
    console.error('Gemini analysis error:', error)
    return { success: false, error: error.message, claims: [] }
  }
}
```

**Step 6: Update handleAnalyze to use progress**

In MKGClaimsDetector.jsx:

```jsx
const handleAnalyze = async () => {
  if (!uploadedFile) return

  setIsAnalyzing(true)
  setAnalysisComplete(false)
  setAnalysisError(null)
  setAnalysisProgress(0)
  setAnalysisStatus('Starting...')
  const startTime = Date.now()

  try {
    const connectionCheck = await checkGeminiConnection()
    if (!connectionCheck.connected) {
      throw new Error(`Gemini API not connected: ${connectionCheck.error}`)
    }

    const result = await analyzeDocument(uploadedFile, (progress, status) => {
      setAnalysisProgress(progress)
      setAnalysisStatus(status)
    })

    if (!result.success) {
      throw new Error(result.error || 'Analysis failed')
    }

    setClaims(result.claims)
    setProcessingTime(Date.now() - startTime)
    setAnalysisComplete(true)
  } catch (error) {
    console.error('Analysis error:', error)
    setAnalysisError(error.message)
  } finally {
    setIsAnalyzing(false)
  }
}
```

**Step 7: Update import**

Update the import in MKGClaimsDetector.jsx:

```jsx
import { analyzeDocument, checkGeminiConnection } from '@/services/gemini'
```

**Step 8: Verify progress tracking works**

Run: `npm run dev`
Upload and analyze. Expected: Progress updates in real-time during analysis.

**Step 9: Commit**

```bash
git add src/components/claims-detector/ScannerOverlay.jsx src/components/mkg/PDFViewer.jsx src/pages/MKGClaimsDetector.jsx src/services/gemini.js
git commit -m "feat(mkg): add real progress tracking to scanner overlay"
```

---

## Task 8: Final Cleanup and Testing

**Files:**
- Review all modified files

**Step 1: Remove unused imports**

In `MKGClaimsDetector.jsx`, remove any unused imports (KnowledgeBasePanel should already be removed).

**Step 2: Run linter**

```bash
npm run lint
```

Fix any reported issues.

**Step 3: Test full workflow**

1. Load app at `/mkg`
2. Verify no Knowledge Base panel
3. Upload PDF
4. Click Analyze
5. Watch progress percentage update
6. Verify Results Summary shows confidence tiers
7. Test status filters (Pending/Approved/Rejected)
8. Test search
9. Test sort toggle
10. Approve some claims, reject others
11. Verify filter counts update

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(mkg): complete pure claim detection implementation"
```

---

## Future Tasks (Not in Scope)

These are documented but not implemented in this plan:

1. **Multi-format support (DOCX, PPT, PPTX)** - Requires backend service for document conversion
2. **Document-to-image conversion** - Requires server-side rendering
3. **OCR extraction pipeline** - Currently handled by Gemini's native PDF understanding
