# Medication Prompt Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add editable Medication-specific prompt that triggers when user selects "Medication" from Claim Focus dropdown.

**Architecture:** Frontend stores editable prompt text in state, resets on dropdown change. Backend receives custom prompt and appends position/JSON instructions before sending to Gemini.

**Tech Stack:** React (useState, useEffect), Vite, Gemini API

---

## Task 1: Extract Position Instructions in gemini.js

**Files:**
- Modify: `src/services/gemini.js:75-116`

**Step 1: Add POSITION_INSTRUCTIONS constant**

Find the `CLAIM_DETECTION_PROMPT` constant (line 77) and add a new constant above it:

```javascript
// Backend-only instructions appended to all prompts
const POSITION_INSTRUCTIONS = `

POSITION: Return the x/y coordinates where a marker pin should be placed for each claim:
- x: LEFT EDGE of the claim text as percentage (0 = page left, 100 = page right)
- y: vertical center of the claim text as percentage (0 = page top, 100 = page bottom)
- The pin will appear AT these exact coordinates, so position at the LEFT EDGE of text, not center
- For charts/images: position at the LEFT EDGE of the visual element
- Example: text starting 20% from left at 30% down the page = x:20, y:30

IMPORTANT: Charts, graphs, and infographics that display statistics or make comparative claims MUST be flagged. The visual nature doesn't exempt them from substantiation requirements.

Return ONLY this JSON:
{
  "claims": [
    { "claim": "[Exact phrase from document]", "confidence": 85, "page": 1, "x": 25.0, "y": 14.5 }
  ]
}`
```

**Step 2: Commit**

```bash
git add src/services/gemini.js
git commit -m "refactor: extract POSITION_INSTRUCTIONS constant"
```

---

## Task 2: Add User-Facing Prompt Constants

**Files:**
- Modify: `src/services/gemini.js`

**Step 1: Add ALL_CLAIMS_PROMPT_USER constant**

Add after `POSITION_INSTRUCTIONS`:

```javascript
// User-facing prompt for All Claims (shown in UI, editable)
export const ALL_CLAIMS_PROMPT_USER = `You are a veteran MLR (Medical, Legal, Regulatory) reviewer analyzing pharmaceutical promotional materials. Your job is to surface EVERY statement that could require substantiation - you'd rather flag 20 borderline phrases than let 1 real claim slip through.

Scan this document and identify all claims. A claim is any statement that:
- Makes a verifiable assertion about efficacy, safety, or outcomes
- Uses statistics, percentages, or quantitative data
- Implies superiority or comparison
- References studies, endorsements, or authority
- Promises benefits or quality of life improvements

IMPORTANT - Claim boundaries:
- Combine related sentences that support the SAME assertion into ONE claim (e.g., a statistic followed by its context)
- Only split into separate claims when statements make DISTINCT assertions requiring DIFFERENT substantiation
- A claim should be the complete, self-contained statement - not sentence fragments
- Every statistic requires substantiation - whether it appears as a headline or embedded in text

For each claim, rate your confidence (0-100):
- 90-100: Definite claim - explicit stats, direct efficacy statements, specific numbers that clearly need substantiation
- 70-89: Strong implication - benefit promises, implicit comparisons, authoritative language
- 50-69: Borderline - suggestive phrasing that a cautious reviewer might flag
- 30-49: Weak signal - could be promotional in certain contexts, worth a second look

Trust your judgment. If you're unsure whether something is a claim, include it with a lower confidence score rather than omitting it.

Now analyze the document. Find everything that could require substantiation.`
```

**Step 2: Add MEDICATION_PROMPT_USER constant**

Add after `ALL_CLAIMS_PROMPT_USER`:

```javascript
// User-facing prompt for Medication claims (shown in UI, editable)
export const MEDICATION_PROMPT_USER = `Role: Veteran MLR reviewer. Surface EVERY statement that could require substantiation — better to flag 20 borderline phrases than let 1 slip through.

What is a Medication Claim?

A substantiable statement about a drug, biologic, or medical product, including:

- Efficacy: How well it works, onset, duration, or treatment outcomes
- Safety/Tolerability: Risk profile, side effects, interactions, or absence thereof
- Dosage/Administration: Dosing schedule, ease of use, convenience
- Mechanism of Action: How the product works biologically or chemically
- Formulation Superiority: Novel delivery, once-daily vs. BID, etc.
- Comparative Statements: Better/faster/longer than alternatives or standard of care
- Authority References: Citing clinical trials, regulatory status, endorsements
- Patient Benefit or QOL: Improvements to lifestyle, functioning, satisfaction

Claim Boundaries:
- Combine related statements that support the same assertion into one claim
- Split if different substantiation would be needed
- Claims must be complete, self-contained statements

Confidence Scoring:
- 90-100: Definite claim — "Clinically proven to reduce A1c"
- 70-89: Strong implication — "Starts working in just 3 days"
- 50-69: Suggestive or borderline — "Helps patients feel better faster"
- 30-49: Weak signal, worth second look — "New era in diabetes management"

Now analyze the document. Find everything that could require substantiation.`
```

**Step 3: Commit**

```bash
git add src/services/gemini.js
git commit -m "feat: add user-facing prompt constants for All Claims and Medication"
```

---

## Task 3: Update analyzeDocument to Accept Custom Prompt

**Files:**
- Modify: `src/services/gemini.js:126`

**Step 1: Update function signature**

Change the `analyzeDocument` function signature from:

```javascript
export async function analyzeDocument(pdfFile, onProgress, promptKey = 'all') {
```

To:

```javascript
export async function analyzeDocument(pdfFile, onProgress, promptKey = 'all', customPrompt = null) {
```

**Step 2: Update prompt selection logic**

Replace the TODO comment and console.log (lines 127-128):

```javascript
  // TODO: Use promptKey to select different prompts when they diverge
  console.log(`📋 Using prompt focus: ${promptKey}`)
```

With:

```javascript
  // Build final prompt: custom prompt (if provided) or default, plus position instructions
  let userPrompt
  if (customPrompt) {
    userPrompt = customPrompt
    console.log(`📋 Using custom prompt (${customPrompt.length} chars)`)
  } else {
    userPrompt = promptKey === 'drug' ? MEDICATION_PROMPT_USER : ALL_CLAIMS_PROMPT_USER
    console.log(`📋 Using default prompt for: ${promptKey}`)
  }
  const finalPrompt = userPrompt + POSITION_INSTRUCTIONS
```

**Step 3: Update the API call to use finalPrompt**

Change line 143 from:

```javascript
            { text: CLAIM_DETECTION_PROMPT },
```

To:

```javascript
            { text: finalPrompt },
```

**Step 4: Remove the old CLAIM_DETECTION_PROMPT constant**

Delete the entire `CLAIM_DETECTION_PROMPT` constant (lines 77-116) since it's now replaced by the new constants.

**Step 5: Verify the build passes**

```bash
npm run build
```

Expected: Build succeeds with no errors.

**Step 6: Commit**

```bash
git add src/services/gemini.js
git commit -m "feat: analyzeDocument accepts custom prompt parameter"
```

---

## Task 4: Add Prompt Display Text to Frontend

**Files:**
- Modify: `src/pages/MKGClaimsDetector.jsx:1-46`

**Step 1: Import prompt constants**

Update the gemini import (line 13) from:

```javascript
import { analyzeDocument as analyzeWithGemini, checkGeminiConnection } from '@/services/gemini'
```

To:

```javascript
import { analyzeDocument as analyzeWithGemini, checkGeminiConnection, ALL_CLAIMS_PROMPT_USER, MEDICATION_PROMPT_USER } from '@/services/gemini'
```

**Step 2: Add PROMPT_DISPLAY_TEXT mapping**

Add after `PROMPT_OPTIONS` (around line 46):

```javascript
// Maps promptKey to user-facing prompt text
const PROMPT_DISPLAY_TEXT = {
  'all': ALL_CLAIMS_PROMPT_USER,
  'disease': ALL_CLAIMS_PROMPT_USER, // Uses All Claims for now
  'drug': MEDICATION_PROMPT_USER
}
```

**Step 3: Commit**

```bash
git add src/pages/MKGClaimsDetector.jsx
git commit -m "feat: add prompt display text mapping"
```

---

## Task 5: Add Editable Prompt State

**Files:**
- Modify: `src/pages/MKGClaimsDetector.jsx`

**Step 1: Add editablePrompt state**

Find the analysis state section (around line 54-61) and add after `selectedPrompt`:

```javascript
  const [editablePrompt, setEditablePrompt] = useState('')
```

**Step 2: Add useEffect to sync prompt with dropdown**

Add after the existing useEffect blocks (around line 98):

```javascript
  // Sync editable prompt when Claim Focus changes
  useEffect(() => {
    const promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
    setEditablePrompt(PROMPT_DISPLAY_TEXT[promptKey] || PROMPT_DISPLAY_TEXT['all'])
  }, [selectedPrompt])
```

**Step 3: Commit**

```bash
git add src/pages/MKGClaimsDetector.jsx
git commit -m "feat: add editablePrompt state with dropdown sync"
```

---

## Task 6: Replace Master Prompt Accordion with Textarea

**Files:**
- Modify: `src/pages/MKGClaimsDetector.jsx:403-435`
- Modify: `src/pages/MKGClaimsDetector.css`

**Step 1: Replace Master Prompt accordion content**

Find the Master Prompt AccordionItem (lines 403-435) and replace its `content` prop with:

```javascript
          <AccordionItem
            title="Master Prompt"
            defaultOpen={false}
            size="small"
            content={
              <div className="masterPromptContent">
                <textarea
                  className="promptTextarea"
                  value={editablePrompt}
                  onChange={(e) => setEditablePrompt(e.target.value)}
                  rows={16}
                />
                <p className="promptHint">
                  Edit prompt above. Reverts on dropdown change or refresh.
                </p>
              </div>
            }
          />
```

**Step 2: Add CSS for textarea**

Add to `src/pages/MKGClaimsDetector.css`:

```css
.promptTextarea {
  width: 100%;
  min-height: 300px;
  padding: 12px;
  font-family: var(--font-mono, 'SF Mono', 'Monaco', 'Inconsolata', monospace);
  font-size: 12px;
  line-height: 1.5;
  border: 1px solid var(--gray-3);
  border-radius: 6px;
  background: var(--gray-1);
  color: var(--gray-9);
  resize: vertical;
}

.promptTextarea:focus {
  outline: none;
  border-color: var(--blue-5);
  box-shadow: 0 0 0 2px var(--blue-2);
}

.promptHint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--gray-6);
  font-style: italic;
}
```

**Step 3: Verify dev server shows textarea**

```bash
npm run dev
```

Open http://localhost:5173/mkg, expand Master Prompt accordion — should show editable textarea.

**Step 4: Commit**

```bash
git add src/pages/MKGClaimsDetector.jsx src/pages/MKGClaimsDetector.css
git commit -m "feat: replace Master Prompt with editable textarea"
```

---

## Task 7: Pass Custom Prompt to Analyze Functions

**Files:**
- Modify: `src/pages/MKGClaimsDetector.jsx:186-203`

**Step 1: Update Gemini analyze call**

Find the Gemini analyze call (around line 198-202) and change from:

```javascript
        result = await analyzeWithGemini(uploadedFile, (progress, status) => {
          setAnalysisProgress(progress)
          setAnalysisStatus(status)
        }, promptKey)
```

To:

```javascript
        result = await analyzeWithGemini(uploadedFile, (progress, status) => {
          setAnalysisProgress(progress)
          setAnalysisStatus(status)
        }, promptKey, editablePrompt)
```

**Step 2: Update OpenAI analyze call (for consistency)**

Find the OpenAI analyze call (around line 188-192). For now, OpenAI and Anthropic don't support custom prompts yet, so leave as-is. The architecture is ready when needed.

**Step 3: Verify analyze uses custom prompt**

1. Open http://localhost:5173/mkg
2. Upload a PDF
3. Edit the Master Prompt textarea (change something visible)
4. Click Analyze
5. Check browser console for: `📋 Using custom prompt (X chars)`

**Step 4: Commit**

```bash
git add src/pages/MKGClaimsDetector.jsx
git commit -m "feat: pass editable prompt to Gemini analyzer"
```

---

## Task 8: Update Documentation

**Files:**
- Modify: `docs/workflow/pharma_claims_persona.md`

**Step 1: Update the master prompt doc**

Replace entire file content with:

```markdown
# Promotional Claim Detection Prompt

> **Source of Truth:** This documents the master prompts. User-facing text is in `src/services/gemini.js` as exported constants.

---

## All Claims Prompt (Default)

Used for "All Claims" and "Disease State" focus options.

```
You are a veteran MLR (Medical, Legal, Regulatory) reviewer analyzing pharmaceutical promotional materials. Your job is to surface EVERY statement that could require substantiation - you'd rather flag 20 borderline phrases than let 1 real claim slip through.

Scan this document and identify all claims. A claim is any statement that:
- Makes a verifiable assertion about efficacy, safety, or outcomes
- Uses statistics, percentages, or quantitative data
- Implies superiority or comparison
- References studies, endorsements, or authority
- Promises benefits or quality of life improvements

Confidence Scoring:
- 90-100: Definite claim - explicit stats, direct efficacy statements
- 70-89: Strong implication - benefit promises, implicit comparisons
- 50-69: Borderline - suggestive phrasing that a cautious reviewer might flag
- 30-49: Weak signal - could be promotional in certain contexts
```

---

## Medication Prompt

Used for "Medication" focus option. Optimized for drug/biologic claims.

```
Role: Veteran MLR reviewer. Surface EVERY statement that could require substantiation — better to flag 20 borderline phrases than let 1 slip through.

What is a Medication Claim?

A substantiable statement about a drug, biologic, or medical product, including:
- Efficacy: How well it works, onset, duration, or treatment outcomes
- Safety/Tolerability: Risk profile, side effects, interactions, or absence thereof
- Dosage/Administration: Dosing schedule, ease of use, convenience
- Mechanism of Action: How the product works biologically or chemically
- Formulation Superiority: Novel delivery, once-daily vs. BID, etc.
- Comparative Statements: Better/faster/longer than alternatives or standard of care
- Authority References: Citing clinical trials, regulatory status, endorsements
- Patient Benefit or QOL: Improvements to lifestyle, functioning, satisfaction

Confidence Scoring:
- 90-100: Definite claim — "Clinically proven to reduce A1c"
- 70-89: Strong implication — "Starts working in just 3 days"
- 50-69: Suggestive or borderline — "Helps patients feel better faster"
- 30-49: Weak signal, worth second look — "New era in diabetes management"
```

---

## Backend-Only Instructions

These are appended to all prompts but never shown in the UI:

- Position instructions (x/y coordinates for pin placement)
- JSON output format specification

See `POSITION_INSTRUCTIONS` constant in `src/services/gemini.js`.
```

**Step 2: Commit**

```bash
git add docs/workflow/pharma_claims_persona.md
git commit -m "docs: update pharma_claims_persona with all prompt variants"
```

---

## Task 9: Final Verification

**Step 1: Run lint**

```bash
npm run lint
```

Expected: No errors.

**Step 2: Run build**

```bash
npm run build
```

Expected: Build succeeds.

**Step 3: Manual E2E test**

1. Start dev server: `npm run dev`
2. Go to http://localhost:5173/mkg
3. Select "Medication" from Claim Focus dropdown
4. Verify Master Prompt textarea shows Medication prompt
5. Select "All Claims" — verify prompt changes back
6. Edit the prompt text manually
7. Upload a PDF and click Analyze
8. Verify claims are detected
9. Refresh page — verify prompt reverts to default

**Step 4: Final commit (if any cleanup needed)**

```bash
git status
# If clean, skip. Otherwise:
git add -A
git commit -m "chore: final cleanup for medication prompt feature"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Extract POSITION_INSTRUCTIONS | gemini.js |
| 2 | Add user-facing prompt constants | gemini.js |
| 3 | Update analyzeDocument signature | gemini.js |
| 4 | Add prompt display text mapping | MKGClaimsDetector.jsx |
| 5 | Add editablePrompt state | MKGClaimsDetector.jsx |
| 6 | Replace accordion with textarea | MKGClaimsDetector.jsx, .css |
| 7 | Pass custom prompt to analyzer | MKGClaimsDetector.jsx |
| 8 | Update documentation | pharma_claims_persona.md |
| 9 | Final verification | — |
