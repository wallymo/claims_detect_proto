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

### Reference Pool Separation (STRICT)

- **Slide content** → refs come from **slide footnotes block** (abbreviated citations at bottom of slide)
- **Notes content** → refs come from **"References:" numbered list** (full citations with DOIs)
- No crossover between pools

### Worked Examples (pg1.pdf)

**Slide zone:**
- Statement: "Most common cause of acute flaccid paralysis worldwide—sporadic and unpredictable¹·²"
- Pin on: "Most"
- refNumbers: [1, 2]
- references: ["1. Leonhard SE et al. Nat Rev Neurol. 2019;15(11):671-683", "2. van den Berg B et al. Nat Rev Neurol. 2014;10(8):469-482"]

**Notes zone:**
- Statement: "Guillain-Barré syndrome (GBS) is the most common cause of acute flaccid paralysis globally, characterized by its sporadic and unpredictable nature¹·²"
- Pin on: "Guillain"
- refNumbers: [1, 2]
- references: ["1. Leonhard SE, Mandarakas MR, Gondim FAA, et al. Diagnosis and management of Guillain–Barré syndrome in ten steps. Nat Rev Neurol. 2019;15(11):671-683. doi:10.1038/s41582-019-0250-9", "2. van den Berg B, Walgaard C, Drenthen J, Fokke C, Jacobs BC, van Doorn PA. Guillain–Barré syndrome: pathogenesis, diagnosis, treatment and prognosis. Nat Rev Neurol. 2014;10(8):469-482. doi:10.1038/nrneurol.2014.121"]

### Response Format

```json
{
  "annotations": [
    {
      "text": "Most common cause of acute flaccid paralysis worldwide—sporadic and unpredictable",
      "region": "slide",
      "refNumbers": [1, 2],
      "references": [
        "1. Leonhard SE et al. Nat Rev Neurol. 2019;15(11):671-683",
        "2. van den Berg B et al. Nat Rev Neurol. 2014;10(8):469-482"
      ],
      "source": "on-page",
      "confidence": 95,
      "page": 1,
      "x": 6,
      "y": 18,
      "contentType": "bullet"
    }
  ],
  "slideFootnotes": { "1": "Leonhard SE et al...", "2": "van den Berg B et al..." },
  "notesReferences": { "1": "Leonhard SE, Mandarakas MR, Gondim FAA, et al. ..." }
}
```

- `refNumbers`: array of reference numbers from the page (Arabic: 1, 2, 3)
- `references`: array of citation strings, one per refNumber
- `source`: `"on-page"` (primary) or `"ai-find"` (QA toggle)
- `position`: x/y as % of page dimensions for pin placement

### UI — Claim Card

- One card per annotated statement
- Multiple reference callouts inside each card, each as a **green badge/pill**
- Numbered with Arabic numerals (1. 2. 3.)
- "View Source" button stays but inactive (greyed out) until next phase

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
