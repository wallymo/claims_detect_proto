# Page-Local Annotation Engine Design

**Date:** March 10, 2026
**Branch:** newworkflow
**Route:** /mkg2

## Problem

MKG needs to save time on the **annotation step** — connecting on-page references to the content they support. The previous approach (detect claims first, then search a brand library for supporting references) solved a different problem. The references are already on the page. The AI just needs to read them and connect the dots.

## Design

### Core Concept

Single-pass, page-local reference annotation. The AI model (Gemini multimodal) looks at each PDF page and does everything in one shot — no backend matching pipeline.

### Two-Zone Model

Each "notes page" PDF has two regions:

- **Slide region (top ~50%, y < 55%):** Content with superscript numbers (e.g., "47% reduction¹²") and a footnote area at the bottom of the slide with numbered references.
- **Speaker notes region (bottom ~50%, y > 55%):** Bullets with a "References:" section containing numbered references that map to the bullets above.

### Primary Flow (always runs)

1. AI model receives PDF page as image (base64 multimodal)
2. Identifies slide region and notes region
3. Extracts numbered footnotes from the slide's footnote area
4. Extracts numbered references after "References:" header in the notes
5. Maps slide superscripts to slide footnotes (superscript ¹ → footnote 1)
6. Maps notes references to the bullets they support
7. For slide footnotes not already superscripted on any content, annotates where it sees fit
8. Each annotation tagged `"source": "on-page"`

### Secondary Flow — AI QA (toggle in settings, off by default)

- When ON: model does additional pass looking for potential claims with no on-page reference
- Tagged `"source": "ai-find"` — flagged for human review
- When OFF: only reference-backed annotations shown

### Response Format

```json
{
  "pageNumber": 1,
  "annotations": [
    {
      "text": "47% reduction in LDL cholesterol",
      "region": "slide",
      "refNumber": 1,
      "reference": "Smith et al. J Cardiol 2024;45:123-130",
      "source": "on-page",
      "position": { "x": 35, "y": 28 }
    }
  ],
  "slideFootnotes": { "1": "Smith et al...", "2": "Jones et al..." },
  "notesReferences": { "1": "Williams et al..." },
  "unmatchedFootnotes": []
}
```

- `source`: `"on-page"` (primary) or `"ai-find"` (QA toggle)
- `unmatchedFootnotes`: footnotes the model couldn't connect to any content (QA signal)
- `position`: x/y as % of page dimensions for pin placement

### What Changes

**Modified:**
- `app/src/services/gemini.js` — New annotation-first prompt, new response parsing
- `app/src/pages/MKG2ClaimsDetector.jsx` — Remove matching pipeline call, display annotations directly, add AI QA toggle to settings panel
- Claim card components — Show "on-page" vs "ai-find" tags, display reference text inline

**Removed/bypassed (code stays, just unused on this branch):**
- `app/src/services/referenceMatching.js` — No longer called from MKG2 flow
- Backend matching endpoints — Not called
- Fact indexing prompt injection — Not needed

**Untouched:**
- `/mkg` (POC1) — Stays as-is
- Brand library upload UI — Stays, just not in the annotation loop
- PDF viewer, claim pins, feedback controls — Reused as-is

### What Gets Removed from the Flow

The entire backend matching pipeline:
- Tier 0: Citation-scoped matching
- Tier 0.5: Fact-anchored search
- Tier 1: Semantic retrieval
- Tier 2: AI confirmation
- Keyword fallback
- Passage embeddings / cosine similarity
- Fact inventory injection into prompts

All replaced by: "read the page, connect the dots."

## Key Principle

The references are already on the page. Superscripts point to footnotes. Notes have a "References:" section. The model's job is to extract and map — not to search a library for what's already in front of it.
