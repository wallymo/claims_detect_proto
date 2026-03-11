# Annotation Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the multi-tier backend matching pipeline with a single-pass, page-local annotation engine that connects on-page references to content.

**Architecture:** Gemini multimodal reads each PDF page, extracts slide footnotes and notes references, maps them to content via superscripts/context, and returns pre-annotated claims. No backend matching pipeline. Optional AI QA toggle for reference-less claim detection.

**Tech Stack:** Gemini 2.5 Pro / 3 Pro (multimodal), React, existing PDF viewer + claim card components.

---

### Task 1: New Annotation Prompt in gemini.js

**Files:**
- Modify: `app/src/services/gemini.js`

**Step 1: Add the annotation system instruction**

After the existing `SYSTEM_INSTRUCTION` constant (line 246), add a new constant:

```javascript
const ANNOTATION_SYSTEM_INSTRUCTION = `You are a pharmaceutical document annotation specialist. Your job: read each page, extract the on-page references (footnotes, citations), and map them to the content they support. You are NOT detecting claims — you are connecting dots that are already on the page.

Pay close attention to the DOCUMENT FORMAT section in the prompt — it tells you the layout of this specific document and how to scan it.`
```

**Step 2: Add the annotation user prompt**

After the existing `MEDICATION_PROMPT_USER` (around line 943), add:

```javascript
export const ANNOTATION_PROMPT_USER = `# Task
Annotate this pharmaceutical document by connecting on-page references to the content they support.

# Two-Zone Reference Model

**ZONE A — SLIDE REGION (top ~50% of page):**
1. Find ALL numbered footnotes at the bottom of the slide (e.g., "1. Smith et al. J Cardiol 2024;45:123-130")
2. Find ALL superscript numbers on slide content (e.g., "47% reduction¹²")
3. Map each superscript to its corresponding footnote — superscript ¹ → footnote 1, superscript ² → footnote 2
4. If a footnote exists but NO content has its superscript, annotate the most relevant slide content with that footnote
5. Look for annotation markers (†, ‡, §, *) that link to footnote text — map those too

**ZONE B — SPEAKER NOTES REGION (bottom ~50% of page):**
1. Find the "References:" section (if present) — it contains numbered references
2. Map each numbered reference to the bullet it supports
3. If bullets have inline citations (e.g., "Smith et al., 2023"), extract those as the reference

# Rules
- ONLY use references that exist ON THIS PAGE — never invent references
- Every footnote/reference on the page MUST be mapped to content — if it exists, it was put there for a reason
- Superscript numbers are the strongest signal — if content has superscript ¹, footnote 1 is its reference, period
- Each annotation is a separate item in the output
- Include the FULL reference text as written on the page

# Output Format
Return JSON with this structure:
{
  "annotations": [
    {
      "text": "exact text being annotated",
      "region": "slide" or "notes",
      "refNumber": 1,
      "reference": "Full reference citation text from the page",
      "source": "on-page",
      "confidence": 95,
      "rationale": "Brief explanation of why this reference maps to this text",
      "page": 1,
      "x": 35,
      "y": 28
    }
  ],
  "slideFootnotes": { "1": "Full citation...", "2": "Full citation..." },
  "notesReferences": { "1": "Full citation..." },
  "unmatchedFootnotes": ["any footnotes that couldn't be connected to content"]
}

# Position
- x: horizontal position as % from left (0-100)
- y: vertical center of annotated text as % from top (0-100)
- Slide region: y typically 5-50%
- Notes region: y typically 55-90%

# Confidence
95-100: Superscript directly matches footnote number — no ambiguity
85-94: Footnote mapped to content by context (no explicit superscript, but clearly relevant)
70-84: Notes reference mapped to bullet by proximity/topic

Annotate now. Connect every on-page reference to its content.`
```

**Step 3: Add the AI QA prompt**

```javascript
export const AI_QA_PROMPT_USER = `# Task
Quality check: scan this page for potential claims that have NO on-page reference supporting them.

These are statements that might need substantiation but were NOT annotated with a superscript or linked to any footnote/reference on the page. They may represent human oversight or intentionally unsubstantiated content.

# What to flag
- Efficacy claims without a reference number (e.g., "significant improvement" with no superscript)
- Statistical claims without citation (e.g., "47% of patients" with no footnote)
- Comparative claims (e.g., "superior to", "better than") without substantiation
- Safety/tolerability assertions without reference

# What NOT to flag
- Content that IS already annotated with a superscript/footnote — skip these
- Generic descriptions (mechanism of action, dosing instructions)
- Section headers, titles, or labels

# Output Format
Return JSON:
{
  "claims": [
    {
      "text": "exact text of potential unsubstantiated claim",
      "region": "slide" or "notes",
      "confidence": 70,
      "rationale": "Why this might need a reference",
      "source": "ai-find",
      "page": 1,
      "x": 35,
      "y": 28
    }
  ]
}

Flag potential unreferenced claims now.`
```

**Step 4: Add the annotation JSON schema**

After `CLAIMS_JSON_SCHEMA` (line ~322), add:

```javascript
const ANNOTATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    annotations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Exact text being annotated' },
          region: { type: 'string', enum: ['slide', 'notes'] },
          refNumber: { type: 'integer', description: 'Reference number from the page' },
          reference: { type: 'string', description: 'Full reference citation text' },
          source: { type: 'string', enum: ['on-page', 'ai-find'] },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          rationale: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          x: { type: 'number', minimum: 0, maximum: 100 },
          y: { type: 'number', minimum: 0, maximum: 100 }
        },
        required: ['text', 'region', 'reference', 'source', 'confidence', 'page', 'x', 'y']
      }
    },
    slideFootnotes: {
      type: 'object',
      additionalProperties: { type: 'string' }
    },
    notesReferences: {
      type: 'object',
      additionalProperties: { type: 'string' }
    },
    unmatchedFootnotes: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['annotations']
}

const AI_QA_JSON_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          region: { type: 'string', enum: ['slide', 'notes'] },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          rationale: { type: 'string' },
          source: { type: 'string', enum: ['ai-find'] },
          page: { type: 'integer', minimum: 1 },
          x: { type: 'number', minimum: 0, maximum: 100 },
          y: { type: 'number', minimum: 0, maximum: 100 }
        },
        required: ['text', 'region', 'confidence', 'source', 'page', 'x', 'y']
      }
    }
  },
  required: ['claims']
}
```

**Step 5: Add the `annotateDocument` export function**

After the existing `analyzeDocument` function, add a new exported function:

```javascript
/**
 * Annotate a PDF document by mapping on-page references to content.
 * Optionally runs AI QA pass to detect unreferenced claims.
 *
 * @param {File} pdfFile - The PDF file to annotate
 * @param {Function} onProgress - Progress callback
 * @param {boolean} enableAiQa - Whether to run the AI QA pass
 * @param {string} docType - Document type
 * @param {object} options - { modelOverride }
 * @returns {Promise<Object>} - { success, annotations, slideFootnotes, notesReferences, unmatchedFootnotes, aiFinds, usage }
 */
export async function annotateDocument(pdfFile, onProgress, enableAiQa = false, docType = 'speaker-notes', { modelOverride } = {}) {
  const activeModel = modelOverride || GEMINI_MODEL
  const client = getGeminiClient()

  const { structure, position } = getDocTypeInstructions(docType)
  // Use structure block for context but swap in annotation-specific position/instructions
  const annotationPrompt = `${structure}${ANNOTATION_PROMPT_USER}`

  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const finalPrompt = `${annotationPrompt}\n\n<!-- run:${runId} -->`

  onProgress?.(10, 'Reading document...')
  const base64Data = await fileToBase64(pdfFile)
  onProgress?.(25, 'Extracting references...')

  try {
    const { response, model: usedModel } = await generateContentWithModelFallback(client, {
      preferredModel: activeModel,
      purpose: 'annotation',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: base64Data } },
            { text: finalPrompt }
          ]
        }
      ],
      config: {
        systemInstruction: ANNOTATION_SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseSchema: ANNOTATION_JSON_SCHEMA,
        temperature: 0
      }
    })

    onProgress?.(70, 'Processing annotations...')

    const rawText = response.text || ''
    const parsed = parseJsonResponse(rawText, 'Annotation response')
    const { inputTokens, outputTokens } = extractUsageMetadata(response)
    const cost = calculateCost(usedModel, inputTokens, outputTokens)

    // Sanitize annotations
    const annotations = (Array.isArray(parsed.annotations) ? parsed.annotations : []).map((ann, idx) => ({
      id: `ann-${idx + 1}`,
      text: String(ann.text || '').trim(),
      claim: String(ann.text || '').trim(), // Alias for claim card compatibility
      region: ann.region || 'slide',
      refNumber: ann.refNumber || null,
      reference: {
        name: String(ann.reference || '').trim(),
        text: String(ann.reference || '').trim()
      },
      source: 'on-page',
      matched: true,
      matchTier: 'on-page',
      confidence: clamp(Math.round(Number(ann.confidence) || 80), 0, 100),
      rationale: ann.rationale || '',
      page: Math.max(1, Number.parseInt(ann.page, 10) || 1),
      position: {
        x: clamp(Number(ann.x) || 0, 0, 100),
        y: clamp(Number(ann.y) || 0, 0, 100)
      }
    }))

    let usage = {
      inputTokens,
      outputTokens,
      cost,
      model: usedModel
    }

    // Optional AI QA pass
    let aiFinds = []
    if (enableAiQa) {
      onProgress?.(75, 'Running AI QA...')
      try {
        const qaRunId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const qaPrompt = `${structure}${AI_QA_PROMPT_USER}\n\n<!-- run:${qaRunId} -->`

        const { response: qaResponse, model: qaModel } = await generateContentWithModelFallback(client, {
          preferredModel: activeModel,
          purpose: 'ai-qa',
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: 'application/pdf', data: base64Data } },
                { text: qaPrompt }
              ]
            }
          ],
          config: {
            systemInstruction: ANNOTATION_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: AI_QA_JSON_SCHEMA,
            temperature: 0
          }
        })

        const qaRaw = qaResponse.text || ''
        const qaParsed = parseJsonResponse(qaRaw, 'AI QA response')
        const { inputTokens: qaIn, outputTokens: qaOut } = extractUsageMetadata(qaResponse)
        const qaCost = calculateCost(qaModel, qaIn, qaOut)

        aiFinds = (Array.isArray(qaParsed.claims) ? qaParsed.claims : []).map((c, idx) => ({
          id: `ai-find-${idx + 1}`,
          text: String(c.text || '').trim(),
          claim: String(c.text || '').trim(),
          region: c.region || 'slide',
          source: 'ai-find',
          matched: false,
          matchTier: 'ai-find',
          confidence: clamp(Math.round(Number(c.confidence) || 60), 0, 100),
          rationale: c.rationale || '',
          page: Math.max(1, Number.parseInt(c.page, 10) || 1),
          position: {
            x: clamp(Number(c.x) || 0, 0, 100),
            y: clamp(Number(c.y) || 0, 0, 100)
          }
        }))

        usage = {
          inputTokens: usage.inputTokens + qaIn,
          outputTokens: usage.outputTokens + qaOut,
          cost: usage.cost + qaCost,
          model: usedModel
        }
      } catch (qaErr) {
        logger.warn('AI QA pass failed (non-fatal):', qaErr.message)
      }
    }

    onProgress?.(100, 'Annotations complete')

    return {
      success: true,
      annotations,
      aiFinds,
      slideFootnotes: parsed.slideFootnotes || {},
      notesReferences: parsed.notesReferences || {},
      unmatchedFootnotes: parsed.unmatchedFootnotes || [],
      usage
    }
  } catch (error) {
    logger.error('Annotation error:', error)
    return {
      success: false,
      error: toUserFacingGeminiError(error),
      annotations: [],
      aiFinds: []
    }
  }
}
```

**Step 6: Export the new prompts**

Add `ANNOTATION_PROMPT_USER` and `AI_QA_PROMPT_USER` to the module exports (they're already exported via `export const`).

**Step 7: Commit**

```bash
git add app/src/services/gemini.js
git commit -m "feat: add annotateDocument function with page-local reference mapping"
```

---

### Task 2: Add AI QA Toggle to MKG2 Settings Panel

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx`

**Step 1: Add AI QA state**

Near the other state declarations (around line 150-200 area), add:

```javascript
const [enableAiQa, setEnableAiQa] = useState(false)
```

**Step 2: Add toggle to Settings accordion**

In the Settings `AccordionItem` content (around line 2418), after the Document Type selector, add:

```jsx
{/* AI QA Toggle */}
<div className="settingItem">
  <label className="settingLabel">AI QA</label>
  <div className="settingControl">
    <label className="toggleLabel">
      <input
        type="checkbox"
        checked={enableAiQa}
        onChange={(e) => setEnableAiQa(e.target.checked)}
      />
      <span>Flag unreferenced claims</span>
    </label>
  </div>
</div>
```

**Step 3: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: add AI QA toggle to MKG2 settings panel"
```

---

### Task 3: Replace handleAnalyze with Annotation Flow

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx`

**Step 1: Update imports**

Change the gemini import (line 27) from:

```javascript
import { analyzeDocument as analyzeWithGemini, checkGeminiConnection, ALL_CLAIMS_PROMPT_USER, MEDICATION_PROMPT_USER, getDocTypeInstructions, GEMINI_MODEL } from '@/services/gemini'
```

to:

```javascript
import { analyzeDocument as analyzeWithGemini, annotateDocument, checkGeminiConnection, ALL_CLAIMS_PROMPT_USER, MEDICATION_PROMPT_USER, ANNOTATION_PROMPT_USER, getDocTypeInstructions, GEMINI_MODEL } from '@/services/gemini'
```

**Step 2: Rewrite handleAnalyze**

Replace the `handleAnalyze` function (lines ~1034-1287) with a new version that:
1. Calls `annotateDocument()` instead of `analyzeWithGemini()`
2. Skips the entire fact inventory fetch
3. Skips `runReferenceMatching()` — annotations come back pre-matched
4. Merges `annotations` + `aiFinds` into the claims array
5. Sets `matchingComplete` to `true` immediately (no Step 2 needed)

The key shape transformation: `annotateDocument` returns `{ annotations, aiFinds }` → combine them into a single `claims` array that the existing claim cards can render. Each annotation already has `matched: true`, `reference: { name, text }`, `matchTier: 'on-page'`, and `position: { x, y }` — so the existing `MKGClaimCard` and `ClaimPinsOverlay` should work without changes.

```javascript
const handleAnalyze = async () => {
  if (!uploadedFile) return
  cancelAnalysisRef.current = false

  setIsAnalyzing(true)
  setAnalysisComplete(false)
  setMatchingComplete(false)
  setAnalysisError(null)
  setAnalysisProgress(0)
  setAnalysisStatus('Reading document...')
  setMatchingStats(null)
  setCacheHit(null)
  const analysisStartedAt = Date.now()

  try {
    const connectionCheck = await checkGeminiConnection(selectedModelOption.modelId)
    if (!connectionCheck.connected) {
      throw new Error(`Gemini API not connected: ${connectionCheck.error}`)
    }
    if (cancelAnalysisRef.current) return

    const progressCb = (progress, status) => {
      setAnalysisProgress(progress)
      setAnalysisStatus(status)
    }

    const result = await annotateDocument(
      uploadedFile,
      progressCb,
      enableAiQa,
      selectedDocType || 'speaker-notes',
      { modelOverride: selectedModelOption.modelId }
    )

    if (cancelAnalysisRef.current) return
    if (!result.success) throw new Error(result.error || 'Annotation failed')

    // Combine annotations + AI finds into unified claims array
    const allItems = [
      ...result.annotations,
      ...result.aiFinds
    ]

    // Add global indices
    const indexedClaims = addGlobalIndices(allItems)
    setClaims(indexedClaims)

    const analysisTotalMs = Date.now() - analysisStartedAt
    setProcessingTime(analysisTotalMs)

    // Track cost
    if (result.usage) {
      setLastUsage(result.usage)
      const runCost = result.usage.cost
      setSessionCost(prev => prev + runCost)
      const newTotal = totalCost + runCost
      setTotalCost(newTotal)
      localStorage.setItem('gemini_total_cost', newTotal.toString())
    }

    // Build annotation stats
    const onPageCount = result.annotations.length
    const aiQaCount = result.aiFinds.length
    const unmatchedFootnotes = result.unmatchedFootnotes?.length || 0
    setMatchingStats({
      total: indexedClaims.length,
      matched: onPageCount,
      unmatched: aiQaCount,
      on_page_count: onPageCount,
      ai_find_count: aiQaCount,
      unmatched_footnotes: unmatchedFootnotes,
      matching_total_ms: analysisTotalMs
    })

    setAnalysisProgress(100)
    setAnalysisStatus('Annotations complete')
    setAnalysisComplete(true)
    setMatchingComplete(true)
    setIsAnalyzing(false)

    logger.info({
      event: 'mkg2_annotation_summary',
      total_ms: analysisTotalMs,
      on_page_annotations: onPageCount,
      ai_finds: aiQaCount,
      unmatched_footnotes: unmatchedFootnotes,
      model: selectedModelOption.modelId
    })
  } catch (error) {
    logger.error('Annotation error:', error)
    setAnalysisError(error.message)
    setIsAnalyzing(false)
  }
}
```

**Step 3: Remove the "Select a brand" warning**

Remove or comment out the warning that says "Select a brand to enable reference matching" (around line 2534-2539) — brand is no longer required for the annotation flow.

**Step 4: Update the analyze button text**

Change "Analyze Document" to "Annotate Document" and "Analyzing..." to "Annotating..." (around line 2503-2520).

**Step 5: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: replace claim detection with page-local annotation flow in MKG2"
```

---

### Task 4: Update MKGClaimCard for Annotation Display

**Files:**
- Modify: `app/src/components/mkg/MKGClaimCard.jsx`
- Modify: `app/src/components/mkg/MKGClaimCard.module.css`

**Step 1: Add source badge**

In `MKGClaimCard.jsx`, where the match tier badge is displayed (near `claim.matchTier`), add a badge showing the source:

- `on-page` → green badge "On-Page Ref"
- `ai-find` → amber badge "AI Find"

**Step 2: Show reference text for on-page annotations**

The existing reference display block (around line 202: `{claim.matched && claim.reference && ...}`) should already work since we're setting `claim.matched = true` and `claim.reference = { name, text }` in the annotation output. Verify this renders the reference name and text correctly.

**Step 3: Style the source badges**

In `MKGClaimCard.module.css`, add styles for the source badges:

```css
.sourceBadge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.sourceBadgeOnPage {
  composes: sourceBadge;
  background: var(--green-1);
  color: var(--green-11);
}

.sourceBadgeAiFind {
  composes: sourceBadge;
  background: var(--amber-1);
  color: var(--amber-11);
}
```

**Step 4: Commit**

```bash
git add app/src/components/mkg/MKGClaimCard.jsx app/src/components/mkg/MKGClaimCard.module.css
git commit -m "feat: add on-page/ai-find source badges to claim cards"
```

---

### Task 5: Update Results Summary for Annotations

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx`

**Step 1: Update Results Summary accordion**

Find the Results Summary section (around line 2543) and update it to show annotation-specific stats:
- "X on-page annotations" (green)
- "X AI finds" (amber, only if AI QA was enabled)
- "X unmatched footnotes" (if any — signals footnotes the model couldn't map)

Instead of the old matching stats (tiers, semantic scores, etc.).

**Step 2: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: update results summary for annotation stats"
```

---

### Task 6: Clean Up Unused Matching Code in MKG2

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx`

**Step 1: Remove or comment out `runReferenceMatching`**

The entire `runReferenceMatching` function (lines ~1348-1729) is no longer called. Remove it or wrap it in a `/* DEPRECATED — kept for reference */` comment.

**Step 2: Remove unused matching imports**

Remove `getMatchingStats` import from `referenceMatching.js` (line 28) if no longer used.

**Step 3: Remove matching-related state**

Remove state variables that are no longer used: `isMatching`, `matchingProgress`, `matchingJobIdRef`, `matchingEventSourceRef`, `matchingCancelRequestedRef`, etc. — but only if they're not referenced elsewhere in the JSX.

**Step 4: Remove `handleResetMatching`**

This function (line ~1329-1344) is no longer needed.

**Step 5: Update the editable prompt display**

The Master Prompt accordion (line ~2464) currently shows the detection prompt. Update `PROMPT_DISPLAY_TEXT` and the `editablePrompt` default to show `ANNOTATION_PROMPT_USER` instead.

**Step 6: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "refactor: remove deprecated matching pipeline from MKG2"
```

---

### Task 7: End-to-End Smoke Test

**Step 1: Start both servers**

```bash
cd app && npm run dev &
cd backend && npm run dev &
```

**Step 2: Test annotation flow**

1. Navigate to `/mkg2`
2. Upload a pharma PDF with slide footnotes and speaker notes references
3. Click "Annotate Document"
4. Verify:
   - Annotations appear with "On-Page Ref" badges
   - Reference text displays on each annotation card
   - PDF pins render at correct positions
   - No errors in console

**Step 3: Test AI QA toggle**

1. Enable "AI QA" toggle in settings
2. Re-annotate
3. Verify "AI Find" badges appear for unreferenced claims

**Step 4: Test edge case — PDF with no references**

1. Upload a PDF that has no footnotes/references
2. With AI QA OFF: should show no annotations (empty state)
3. With AI QA ON: should show AI Find items

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: smoke test fixes for annotation engine"
```
