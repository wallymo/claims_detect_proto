# PyMuPDF POC: Layout-Aware PDF Annotation Parser

**Date:** March 16, 2026
**Type:** Proof of Concept
**Goal:** Test whether PyMuPDF extracts better text/coordinate/font data from Notes-view PDFs than the current pdf.js pipeline, before committing to any architecture changes.

## Context

A colleague proposed rebuilding the annotation extraction engine using PyMuPDF (Python) instead of pdf.js (JavaScript). The core logic is the same as the existing mkg3 pipeline — split pages into slide/notes regions, detect superscripts, parse reference pools, match them — but PyMuPDF provides richer font metadata (superscript flags, precise span-level coordinates, font names) that could reduce the heuristic guesswork currently needed in pdf.js.

This POC is a standalone Python script. No integration with the existing app. Run it, compare its output against the current pipeline's results, and decide if the extraction quality justifies a deeper investment.

## Deliverable

```
scripts/pymupdf_poc.py
```

Single-file Python script. Takes a PDF path as CLI argument, outputs structured JSON to stdout. One dependency: `pymupdf`.

## Architecture: Three Phases Per Page

### Phase 1: Region Split

- Scan all text spans on the page for "Speaker notes" / "Speaker note" label
- Everything above that label = **slide region**
- Everything at/below = **notes region**
- Fallback: if no label found, use midpoint heuristic (~50% page height)

### Phase 2: Extract Text Spans With Metadata

Use `page.get_text("dict")` which returns blocks → lines → spans, each with:
- `text` — the string content
- `size` — font size (float)
- `origin` — (x, y) coordinates
- `flags` — bitmask including superscript flag
- `font` — font name

This is the key advantage over pdf.js: span-level granularity with native font metadata.

### Phase 3: Detect → Parse → Match

**Superscript detection (two signals):**
1. **Font flags** — PyMuPDF's `flags` field includes a superscript bit. If PowerPoint exported properly, this catches it directly.
2. **Font size + baseline** — When flag isn't set: is this span significantly smaller than neighbors AND is its y-origin higher than the adjacent baseline? Same concept as current JS pipeline but with more precise data.

**Association:**
- For each superscript span, find the nearest non-superscript text to its left on the same visual line
- Parse superscript content: handle `1,2` and `1-3` ranges and single digits
- PyMuPDF's span-level output naturally isolates "floating separate spans" that the colleague warned about

**Scope: numeric superscripts only.** Symbol markers (†, ‡, §) excluded from this POC.

### Reference Pool Parsing — Two Pools Per Page

1. **Slide footnote pool** — Tiny text at bottom of slide region (significantly smaller font, bottom ~15% of slide area). Parse numbered entries. Slide-region superscripts resolve here only.

2. **Notes reference pool** — Text below "References" / "Reference" header in notes region. Parse numbered entries with continuation line accumulation. Notes-region superscripts resolve here only.

**Never cross-resolve between pools.** If a superscript has no match in its region's pool, flag as unresolved.

## Output Format

```json
{
  "file": "example.pdf",
  "pages": [
    {
      "page": 2,
      "slide_claims": [
        {
          "text": "Most common cause of acute flaccid paralysis worldwide—sporadic and unpredictable",
          "superscripts": [1, 2],
          "references": [
            {"number": 1, "text": "Leonhard SE et al. Nat Rev Neurol. 2019;15(11):671-683."},
            {"number": 2, "text": "van den Berg B et al. Nat Rev Neurol. 2014;10(8):469-482."}
          ],
          "position": {"x": 12.3, "y": 18.7}
        }
      ],
      "notes_claims": [
        {
          "text": "GBS is the most common cause of acute flaccid paralysis globally...",
          "superscripts": [1, 2],
          "references": [
            {"number": 1, "text": "Leonhard SE, Mandarakas MR, Gondim FAA, et al..."},
            {"number": 2, "text": "van den Berg B, Walgaard C, Drenthen J..."}
          ],
          "position": {"x": 5.1, "y": 62.4}
        }
      ],
      "slide_footnotes": {"1": "Leonhard SE et al...", "2": "van den Berg B et al..."},
      "notes_references": {"1": "Leonhard SE, Mandarakas MR...", "2": "van den Berg B..."},
      "unresolved_superscripts": []
    }
  ]
}
```

- Separate `slide_claims` / `notes_claims` — region scope is explicit
- Each claim carries resolved references inline
- `position` as % of page dimensions (matches existing pin system)
- `unresolved_superscripts` captures misses
- Pages with no superscripts appear with empty arrays

## What This POC Tests

1. **Does PyMuPDF's superscript flag work** on PowerPoint PDF exports, or do we still need font-size heuristics?
2. **Is span-level coordinate precision** meaningfully better than pdf.js's text item positions?
3. **Does the region split** work reliably with the "Speaker notes" label detection?
4. **Are floating superscript spans** easier to associate with their parent text using PyMuPDF's data model?
5. **Reference pool parsing quality** — does richer font data help distinguish footnotes from body text?

## What This POC Does NOT Do

- No integration with the existing React/Express app
- No OCR fallback (image-based slides deferred to v2 if needed)
- No symbol marker handling (†, ‡, §)
- No Gemini Vision enhancement
- No cross-page reference resolution
- No UI — stdout JSON only

## Test Document

```
MKG Knowledge Base/Test Doc/Marissa_SYN slides for AI testing_V3_no annos.pdf
```

5 pages, Annexon Biosciences GBS deck. Covers: title slide (no refs), rich superscripted content, charts with symbol markers, varying reference counts (0-6 per page).
