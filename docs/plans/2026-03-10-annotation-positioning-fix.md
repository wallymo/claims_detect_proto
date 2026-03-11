# Annotation Positioning Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix broken annotation pin positioning by adding `contentType` for deterministic x-coordinates, restoring old POC1 y-coordinate guidance, and matching AI-extracted citations to the brand reference library so claim cards show "View Source" links.

**Architecture:** AI returns `contentType` label per annotation (title, bullet, sub-bullet, footnote, chart). Frontend overrides x using a fixed map per contentType+region. After AI pass, citation text is matched against brand reference library (exact name match first, fuzzy fallback). Matched references attach to claim cards enabling "View Source" PDF overlay.

**Tech Stack:** Gemini API (structured JSON schema), React (MKG2ClaimsDetector.jsx, ClaimPinsOverlay.jsx, MKGClaimCard.jsx)

---

### Task 1: Add `contentType` to Gemini JSON schemas

**Files:**
- Modify: `app/src/services/gemini.js:329-360` (ANNOTATION_JSON_SCHEMA)
- Modify: `app/src/services/gemini.js:362-384` (AI_QA_JSON_SCHEMA)

**Step 1: Add contentType to ANNOTATION_JSON_SCHEMA**

In `ANNOTATION_JSON_SCHEMA.properties.annotations.items.properties`, add:

```javascript
contentType: { type: 'string', enum: ['title', 'bullet', 'sub-bullet', 'footnote', 'chart'], description: 'Type of content element for pin positioning' },
```

Add `'contentType'` to the `required` array.

**Step 2: Add contentType to AI_QA_JSON_SCHEMA**

Same field in `AI_QA_JSON_SCHEMA.properties.claims.items.properties`:

```javascript
contentType: { type: 'string', enum: ['title', 'bullet', 'sub-bullet', 'footnote', 'chart'], description: 'Type of content element for pin positioning' },
```

Add `'contentType'` to the `required` array.

**Step 3: Commit**

```bash
git add app/src/services/gemini.js
git commit -m "feat: add contentType to annotation JSON schemas"
```

---

### Task 2: Restore old position guidance in annotation prompts

**Files:**
- Modify: `app/src/services/gemini.js:1007-1027` (ANNOTATION_PROMPT_USER)
- Modify: `app/src/services/gemini.js:1029-1062` (AI_QA_PROMPT_USER)

**Step 1: Update ANNOTATION_PROMPT_USER**

Replace the minimal position line (line 1025: `- x/y positions: percentage from left/top edges (0-100)`) with the full position block from the old POC1 `DOC_TYPE_INSTRUCTIONS['speaker-notes'].position` (lines 724-746). Also add `contentType` instruction. The new prompt should be:

```javascript
export const ANNOTATION_PROMPT_USER = `# Task
Extract on-page references and map them to content.

# Slide Region (top ~50% of page)
1. Find numbered footnotes at the bottom of the slide (e.g. "1. Smith et al. J Cardiol 2024;45:123-130")
2. Find superscript numbers in slide content (e.g. "47% reduction¹²")
3. Match: superscript ¹ → footnote 1. That is the reference. Done.
4. If a footnote exists but no content has its superscript, annotate the most relevant slide content.

# Speaker Notes Region (bottom ~50% of page)
1. Find the "References:" section (numbered references list)
2. If notes content has superscript numbers, match them to the references list the same way.
3. If NO superscripts exist in notes, annotate ALL notes content with the full references block.

# Rules
- ONLY use references that exist ON THIS PAGE — never invent references
- Every footnote/reference on the page MUST be mapped to content
- Return source as "on-page" for all annotations

# Position
- x: Position at the BULLET SYMBOL (• or ○) for bulleted text, NOT at the page margin
- y: vertical CENTER of claim as % (0=top, 100=bottom)
- Slide region elements:
  - Table claims: position at LEFT EDGE of the table cell containing the claim
  - Chart/graph claims: position at the data label or axis label, not the chart center
  - Footnote claims: position at the footnote text (typically y = 45-55%, near slide bottom)
  - Title claims: typically y = 2-10%
- Speaker notes region:
  - y will typically be 55-90% (bottom half of page)
  - Main bullets (•): x should be ~5-8%
  - Sub-bullets (○ or ▪): x should be ~8-12%
  - Sub-sub-bullets (– or -): x should be ~12-16%
  - IMPORTANT: Each nesting level is INDENTED further right

# Content Type
For each annotation, set contentType to one of: "title", "bullet", "sub-bullet", "footnote", "chart"
- "title" for slide titles, subtitles, headers
- "bullet" for main bullets (•) in slide or notes
- "sub-bullet" for sub-bullets (○, ▪, –) at any nesting depth
- "footnote" for slide footnotes, small print, reference text
- "chart" for chart titles, table cells, graph labels

Annotate now.`
```

**Step 2: Add same position block to AI_QA_PROMPT_USER**

Add the `# Position` and `# Content Type` sections (same text as above) between the `# What NOT to flag` section and `# Output Format` section.

**Step 3: Commit**

```bash
git add app/src/services/gemini.js
git commit -m "feat: restore detailed position guidance + contentType in annotation prompts"
```

---

### Task 3: Pass `contentType` through annotateDocument()

**Files:**
- Modify: `app/src/services/gemini.js:1484-1503` (annotation mapping)
- Modify: `app/src/services/gemini.js:1544-1559` (AI QA mapping)

**Step 1: Add contentType to annotation mapping (line ~1484)**

In the `.map()` that builds annotations, add `contentType`:

```javascript
const annotations = (Array.isArray(parsed.annotations) ? parsed.annotations : []).map((ann, idx) => ({
  id: `ann-${idx + 1}`,
  text: String(ann.text || '').trim(),
  claim: String(ann.text || '').trim(),
  region: ann.region || 'slide',
  refNumber: ann.refNumber || null,
  reference: {
    name: String(ann.reference || '').trim(),
    text: String(ann.reference || '').trim()
  },
  source: 'on-page',
  matched: true,
  matchTier: 'on-page',
  contentType: ann.contentType || 'bullet',
  confidence: clamp(Math.round(Number(ann.confidence) || 80), 0, 100),
  page: Math.max(1, Number.parseInt(ann.page, 10) || 1),
  position: {
    x: clamp(Number(ann.x) || 0, 0, 100),
    y: clamp(Number(ann.y) || 0, 0, 100)
  }
}))
```

**Step 2: Add contentType to AI QA mapping (line ~1544)**

Same pattern — add `contentType: c.contentType || 'bullet'` to the aiFinds mapping.

**Step 3: Commit**

```bash
git add app/src/services/gemini.js
git commit -m "feat: pass contentType through annotation and AI QA mappings"
```

---

### Task 4: Deterministic x-positioning in ClaimPinsOverlay

**Files:**
- Modify: `app/src/components/mkg/ClaimPinsOverlay.jsx:40-62` (computeAnchor function)
- Modify: `app/src/components/mkg/ClaimPinsOverlay.jsx:122-148` (data prep section where dots are built)

**Step 1: Add contentType x-position map**

At the top of the file (after the existing constants), add:

```javascript
// Deterministic x-position by content type (percentage of page width)
const CONTENT_TYPE_X_PCT = {
  title: 5,
  bullet: 6,
  'sub-bullet': 10,
  footnote: 5,
  chart: 5
}
```

**Step 2: Override x in dot data prep**

In the section where dots are built from claims (around line 122-148), when `claim.contentType` exists, override `centerXPct` with the map value:

```javascript
// If contentType exists, use deterministic x position
const centerXPct = claim.contentType && CONTENT_TYPE_X_PCT[claim.contentType] != null
  ? CONTENT_TYPE_X_PCT[claim.contentType]
  : (claim.position?.x ?? 50)
```

Keep `centerYPct` from `claim.position.y` as-is.

**Step 3: Commit**

```bash
git add app/src/components/mkg/ClaimPinsOverlay.jsx
git commit -m "feat: deterministic x-positioning using contentType map"
```

---

### Task 5: Match citations to brand reference library

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx:980-988` (post-annotation processing)

**Step 1: Add citation-to-library matching function**

Add a utility function in MKG2ClaimsDetector.jsx (above the annotation handler, near other helper functions):

```javascript
/**
 * Match annotation citation text to brand reference library.
 * Tries exact name match first, then fuzzy (citation contains ref name or vice versa).
 */
function matchCitationToLibrary(citationText, referenceDocuments) {
  if (!citationText || !referenceDocuments.length) return null

  const normalized = citationText.toLowerCase().trim()

  // Exact match on display name or original name
  for (const ref of referenceDocuments) {
    const refName = (ref.name || '').toLowerCase().trim()
    const refOriginal = (ref.originalName || '').toLowerCase().trim()
    if (normalized === refName || normalized === refOriginal) return ref
  }

  // Fuzzy: citation contains ref name or ref name contains citation
  // Use longest match to avoid false positives on short names
  let bestMatch = null
  let bestLength = 0
  for (const ref of referenceDocuments) {
    const refName = (ref.name || '').toLowerCase().trim()
    const refOriginal = (ref.originalName || '').toLowerCase().trim()
    if (refName && (normalized.includes(refName) || refName.includes(normalized)) && refName.length > bestLength) {
      bestMatch = ref
      bestLength = refName.length
    }
    if (refOriginal && (normalized.includes(refOriginal) || refOriginal.includes(normalized)) && refOriginal.length > bestLength) {
      bestMatch = ref
      bestLength = refOriginal.length
    }
  }

  return bestMatch
}
```

**Step 2: Wire it into post-annotation processing**

After annotations are returned from `annotateDocument()` (around line 980-988), enrich each annotation with library match:

```javascript
// Combine annotations + AI finds into unified claims array
const allItems = [
  ...result.annotations,
  ...result.aiFinds
]

// Match citation text to brand reference library
const enrichedItems = allItems.map(item => {
  const citationText = item.reference?.text || item.reference?.name || ''
  const libraryMatch = matchCitationToLibrary(citationText, referenceDocuments)
  if (libraryMatch) {
    return {
      ...item,
      matched: true,
      reference: {
        ...item.reference,
        id: libraryMatch.id,
        name: libraryMatch.name,
        page: 1  // default to page 1; citation doesn't specify page
      }
    }
  }
  return item
})

// Add global indices
const indexedClaims = addGlobalIndices(enrichedItems)
setClaims(indexedClaims)
```

This enables the existing `handleViewSource` (line 1254) which checks `claim.reference?.id` and the existing `MKGClaimCard` reference section + "View Source" button.

**Step 3: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: match annotation citations to brand reference library (exact + fuzzy)"
```

---

### Task 6: Verify end-to-end

**Step 1: Start both servers**

```bash
cd app && npm run dev &
cd backend && npm run dev &
```

**Step 2: Manual test**

1. Go to `/mkg2`
2. Select a brand with uploaded reference PDFs
3. Upload a speaker-notes PDF with superscripted references
4. Run annotation
5. Verify:
   - Pins appear at correct vertical positions (y from AI)
   - Pins appear at deterministic x positions (left edge based on contentType)
   - Claim cards show "Reference:" section with matched library PDF name
   - "View Source" button opens PDF overlay
   - Annotations without library matches show "No reference found" warning

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: annotation positioning fix with contentType + library matching"
```
