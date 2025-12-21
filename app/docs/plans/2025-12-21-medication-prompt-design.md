# Medication Claim Prompt Design

> Created: 2025-12-21

## Summary

Add a dedicated Medication prompt for MLR claim detection that triggers when user selects "Medication" from the Claim Focus dropdown. The prompt is fully editable in the UI but reverts on refresh or prompt switch.

## Decisions Made

| Decision | Choice |
|----------|--------|
| Prompt replacement strategy | Complete replacement (self-contained) |
| Category field in output | No — categories are AI guidance only |
| 30-49 confidence tier | Align all prompts with this tier |
| Disease State prompt | Later — only Medication now |
| Position instructions | Use existing, append to prompt |
| Frontend display | Editable textarea, temporary changes |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (MKGClaimsDetector.jsx)                           │
├─────────────────────────────────────────────────────────────┤
│  Claim Focus dropdown                                       │
│       ↓                                                     │
│  selectedPrompt ('all-claims' | 'medication')               │
│       ↓                                                     │
│  Master Prompt accordion (editable textarea)                │
│       ↓                                                     │
│  editablePrompt (user-facing text, can be modified)         │
│       ↓                                                     │
│  handleAnalyze() passes editablePrompt + promptKey          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│  BACKEND (gemini.js)                                        │
├─────────────────────────────────────────────────────────────┤
│  analyzeDocument(file, onProgress, promptKey, customPrompt) │
│       ↓                                                     │
│  Final prompt = customPrompt + POSITION_INSTRUCTIONS        │
│       ↓                                                     │
│  Send to Gemini API                                         │
└─────────────────────────────────────────────────────────────┘
```

## The Medication Prompt

### User-Facing (shown in UI, editable)

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

Claim Boundaries:
- Combine related statements that support the same assertion into one claim
- Split if different substantiation would be needed
- Claims must be complete, self-contained statements

Confidence Scoring:
- 90-100: Definite claim — "Clinically proven to reduce A1c"
- 70-89: Strong implication — "Starts working in just 3 days"
- 50-69: Suggestive or borderline — "Helps patients feel better faster"
- 30-49: Weak signal, worth second look — "New era in diabetes management"

Now analyze the document. Find everything that could require substantiation.
```

### Backend-Only (appended automatically, never shown in UI)

```
POSITION: Return the x/y coordinates where a marker pin should be placed:
- x: LEFT EDGE of the claim text as percentage (0 = page left, 100 = page right)
- y: vertical center of the claim text as percentage (0 = page top, 100 = page bottom)
- For charts/images: position at the LEFT EDGE of the visual element

Return ONLY this JSON:
{
  "claims": [
    { "claim": "[Exact phrase from document]", "confidence": 85, "page": 1, "x": 25.0, "y": 14.5 }
  ]
}
```

## Frontend Behavior

1. **Master Prompt accordion** contains an editable `<textarea>`
2. Pre-populated with selected prompt's user-facing content
3. User can modify freely before clicking Analyze
4. Changes are used for that analysis run
5. Switching Claim Focus → resets to new prompt's default
6. Page refresh → resets to default

## Output Schema (unchanged)

```javascript
{
  id: 'claim_001',
  text: 'Reduces cardiovascular events by 47%...',
  confidence: 0.92,
  status: 'pending',
  page: 1,
  position: { x: 25.0, y: 14.5 }
}
```

## Files to Modify

1. **`src/services/gemini.js`**
   - Add `MEDICATION_PROMPT_USER` constant (user-facing part)
   - Extract `POSITION_INSTRUCTIONS` as separate constant
   - Update `analyzeDocument()` to accept optional `customPrompt` parameter
   - If `customPrompt` provided, use it + `POSITION_INSTRUCTIONS`
   - Update existing prompt with 30-49 confidence tier

2. **`src/pages/MKGClaimsDetector.jsx`**
   - Add `PROMPT_DISPLAY_TEXT` object mapping promptKey to user-facing text
   - Add `editablePrompt` state
   - Add `useEffect` to reset `editablePrompt` when `selectedPrompt` changes
   - Replace hardcoded Master Prompt accordion content with `<textarea>`
   - Pass `editablePrompt` to `analyzeDocument()`

3. **`docs/workflow/pharma_claims_persona.md`**
   - Add 30-49 confidence tier for consistency

## Not In Scope

- Disease State prompt (follow same pattern later)
- Persistence of edited prompts (localStorage)
- Multiple custom prompts / prompt library
