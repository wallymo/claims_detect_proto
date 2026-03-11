# Annotation Engine Implementation Plan (v2)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up the existing `annotateDocument()` function, fix the schema to support multiple refs per annotation, sharpen the prompt with two-zone pool separation, and update the UI to show green ref callouts.

**Design doc:** `docs/plans/2026-03-10-annotation-engine-design.md`

**Test doc:** `MKG Knowledge Base/Test Doc/pg1.pdf`

**Target page:** `MKG3ClaimsDetector.jsx` (already calls `annotateDocument()` — wiring is done)

**Key insight:** MKG3 already calls `annotateDocument()` correctly. What's broken: (1) schema uses single `refNumber`/`reference` instead of arrays, (2) prompt lacks pool separation + worked examples, (3) claim card shows single ref instead of multi-ref green callouts.

---

### Task 1: Update Schema + Prompt in gemini.js

**Files:** `app/src/services/gemini.js`

**Step 1: Update `ANNOTATION_JSON_SCHEMA` (line 329)**

Change `refNumber` (integer) → `refNumbers` (array of integers).
Change `reference` (string) → `references` (array of strings).
Add `contentType` to required fields.

```javascript
const ANNOTATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    annotations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Exact text of the annotated statement (without superscripts)' },
          region: { type: 'string', enum: ['slide', 'notes'] },
          refNumbers: {
            type: 'array',
            items: { type: 'integer' },
            description: 'All reference numbers from superscripts on this statement'
          },
          references: {
            type: 'array',
            items: { type: 'string' },
            description: 'Full citation text for each refNumber, in matching order'
          },
          source: { type: 'string', enum: ['on-page'] },
          confidence: { type: 'integer', minimum: 0, maximum: 100 },
          page: { type: 'integer', minimum: 1 },
          x: { type: 'number', minimum: 0, maximum: 100 },
          y: { type: 'number', minimum: 0, maximum: 100 },
          contentType: { type: 'string', enum: ['title', 'bullet', 'sub-bullet', 'footnote', 'chart'] }
        },
        required: ['text', 'region', 'refNumbers', 'references', 'source', 'confidence', 'page', 'x', 'y', 'contentType']
      }
    },
    slideFootnotes: { type: 'object', additionalProperties: { type: 'string' } },
    notesReferences: { type: 'object', additionalProperties: { type: 'string' } }
  },
  required: ['annotations']
}
```

**Step 2: Update `ANNOTATION_PROMPT_USER` (line 1009)**

Replace with prompt that has explicit pool separation + worked examples:

```
# Task
Extract on-page references and map them to content. One annotation per statement, multiple refs per annotation.

# Reference Pools — STRICT SEPARATION
- SLIDE content → refs come ONLY from the slide footnotes block (abbreviated citations at bottom of slide)
- NOTES content → refs come ONLY from the "References:" numbered list (full citations)
- NEVER cross-reference between pools

# Slide Region (top ~50% of page)
1. Find numbered footnotes at the bottom of the slide (e.g. "1. Smith et al. J Cardiol 2024;45:123-130")
2. Find superscript numbers in slide content (e.g. "47% reduction¹²")
3. Match ALL superscripts on a statement to their footnotes. Statement with ¹·² → refNumbers [1, 2]
4. If a footnote exists but no content has its superscript, annotate the most relevant slide content.

# Speaker Notes Region (bottom ~50% of page)
1. Find the "References:" section (numbered references list with full citations + DOIs)
2. Match superscript numbers in notes bullets to the "References:" list
3. Statement with ¹·² → refNumbers [1, 2], references from the "References:" list

# Worked Example — Slide
Content: "Most common cause of acute flaccid paralysis worldwide—sporadic and unpredictable¹·²"
Slide footnotes: 1. Leonhard SE et al. Nat Rev Neurol. 2019;15(11):671-683. 2. van den Berg B et al. Nat Rev Neurol. 2014;10(8):469-482.
→ annotation: { text: "Most common cause of acute flaccid paralysis worldwide—sporadic and unpredictable", region: "slide", refNumbers: [1, 2], references: ["1. Leonhard SE et al. Nat Rev Neurol. 2019;15(11):671-683", "2. van den Berg B et al. Nat Rev Neurol. 2014;10(8):469-482"] }

# Worked Example — Notes
Content: "Guillain-Barré syndrome (GBS) is the most common cause of acute flaccid paralysis globally, characterized by its sporadic and unpredictable nature¹·²"
References list: 1. Leonhard SE, Mandarakas MR, Gondim FAA, et al. Diagnosis and management of Guillain–Barré syndrome in ten steps. Nat Rev Neurol. 2019;15(11):671-683. doi:10.1038/s41582-019-0250-9  2. van den Berg B, Walgaard C, Drenthen J, et al...
→ annotation: { text: "Guillain-Barré syndrome (GBS) is the most common cause...", region: "notes", refNumbers: [1, 2], references: ["1. Leonhard SE, Mandarakas MR, Gondim FAA, et al. ...(full citation)", "2. van den Berg B, Walgaard C, Drenthen J, ...(full citation)"] }

# Rules
- ONLY use references that exist ON THIS PAGE — never invent references
- Every footnote/reference on the page MUST be mapped to content
- One annotation per statement — collect ALL superscript refs into refNumbers array
- references array must have same length as refNumbers, in matching order
- Number references with Arabic numerals (1. 2. 3.) — never roman numerals
- Return source as "on-page" for all annotations

# Position
(keep existing position instructions unchanged)

# Content Type
(keep existing contentType instructions unchanged)

Annotate now.
```

**Step 3: Update `annotateDocument()` response mapping (line ~1531)**

Change the annotation mapping to handle arrays:

```javascript
const annotations = (Array.isArray(parsed.annotations) ? parsed.annotations : []).map((ann, idx) => ({
  id: `ann-${idx + 1}`,
  text: String(ann.text || '').trim(),
  claim: String(ann.text || '').trim(),
  region: ann.region || 'slide',
  refNumbers: Array.isArray(ann.refNumbers) ? ann.refNumbers : (ann.refNumber ? [ann.refNumber] : []),
  references: (Array.isArray(ann.references) ? ann.references : (ann.reference ? [String(ann.reference)] : [])).map(r => ({
    number: null,  // will be set below
    text: String(r || '').trim()
  })),
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

// Set reference numbers from refNumbers array
annotations.forEach(ann => {
  ann.references.forEach((ref, i) => {
    ref.number = ann.refNumbers[i] || (i + 1)
  })
})
```

**Step 4: Commit**

---

### Task 2: Update MKG3 Response Mapping — ALREADY PARTIALLY DONE

**Files:** `app/src/pages/MKG3ClaimsDetector.jsx`

MKG3 already calls `annotateDocument()` at line 1005. After Task 1 changes the schema to `refNumbers[]`/`references[]`, update the `matchCitationToLibrary` enrichment (line ~1023) to handle the new array shape instead of single `reference.text`.

**Step 1:** Update enrichment loop to iterate `item.references` array instead of single `item.reference`

**Step 2: Commit**

---

### Task 4: Update MKGClaimCard for Green Ref Callouts

**Files:**
- Modify: `app/src/components/mkg/MKGClaimCard.jsx`
- Modify: `app/src/components/mkg/MKGClaimCard.module.css`

**Step 1: Replace single reference display with multi-ref callouts**

The existing reference block (around line 202: `{claim.matched && claim.reference && ...}`) currently shows one reference. Replace with a loop over `claim.references` array:

```jsx
{claim.references && claim.references.length > 0 && (
  <div className={styles.refCallouts}>
    {claim.references.map((ref, i) => (
      <div key={i} className={styles.refCallout}>
        <span className={styles.refNumber}>{ref.number}.</span>
        <span className={styles.refText}>{ref.text}</span>
      </div>
    ))}
  </div>
)}
```

**Step 2: Style green ref callouts**

```css
.refCallouts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.refCallout {
  display: flex;
  gap: 6px;
  padding: 6px 10px;
  background: var(--green-1);
  border: 1px solid var(--green-6);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--green-11);
}

.refNumber {
  font-weight: 700;
  flex-shrink: 0;
}

.refText {
  word-break: break-word;
}
```

**Step 3: "View Source" button — keep but grey out**

Find the existing "View Source" button. Add `disabled` prop and reduce opacity:
```jsx
<button className={styles.viewSourceBtn} disabled style={{ opacity: 0.4, cursor: 'not-allowed' }}>
```

**Step 4: Source badge (on-page vs ai-find)**

Add badge near the existing match tier area:
- `on-page` → green badge "On-Page Ref"
- `ai-find` → amber badge "AI Find"

**Step 5: Commit**

---

### Task 5: Smoke Test with pg1.pdf

**Test doc:** `MKG Knowledge Base/Test Doc/pg1.pdf`

**Step 1:** Start both servers, navigate to `/mkg2`

**Step 2:** Upload pg1.pdf, click "Annotate Document"

**Step 3:** Verify expected annotations appear. For this 1-page doc, expect at minimum:

**Slide zone annotations:**
- "Most common cause of acute flaccid paralysis worldwide—sporadic and unpredictable" → refs 1, 2 (green callouts)
- "Can strike anyone, anywhere, at any age: potential serious long-term physical and mental health consequences or death" → refs 1, 3, 4
- "≈7,000 cases per year" → ref 5
- "≈150,000 cases per year" → refs 1, 6
- "GBS is a post-infectious autoimmune peripheral nerve disease" + "Infections include Campylobacter enteritis and respiratory infections" → refs 1, 2

**Notes zone annotations:**
- Each bullet should map to its superscripted references from the "References:" list (full citations with DOIs)

**Step 4:** Verify:
- Each card has green ref callout pills with Arabic numbering (1. 2. 3.)
- Pins appear at correct positions (slide pins in top half, notes pins in bottom half)
- No reference crossover between zones
- "View Source" button is present but greyed out

**Step 5:** Fix any issues found, commit
