# PROCESS.md

## MKG3 Deterministic Annotation Workflow

`/mkg3` is an annotation workflow, not a broad claim-discovery workflow.

### Primary rule

Only annotate content that is backed by on-page references.

- Slide region: annotate only superscripted slide content, matched only to that page's slide footnote bank.
- Speaker notes region: annotate only superscripted notes bullets, matched only to that page's notes `References` list.
- Ignore statements with no superscript.
- Numeric superscripts only for now. Ignore dagger, double-dagger, asterisk, and other symbol markers in `/mkg3`.
- Do not cross-reference between slide and notes pools.

### Deterministic-first pipeline

Use deterministic extraction as the default engine for `/mkg3`.

1. Extract text from each PDF page with positions.
2. Split each page into `slide` and `notes` regions by page coordinates.
3. Parse superscripted statements in each region.
4. Parse that same page's local reference pools:
   - slide footnotes at the bottom of the slide
   - notes references under the speaker notes `References` section
5. Match superscript numbers directly to the local page pool by number.
6. Place annotation pins from extracted text coordinates, not AI-estimated coordinates.

### Global annotations

Create a global annotation for a page/region when:

- a superscripted statement exists but its reference number is missing from that page's local pool
- a page has local references but no clear superscripted target statement

Global annotations should be pinned in the reserved global lane near the top-right of the page. If multiple orphan references share the same first author, they may be grouped into one global annotation.

### AI usage

AI is fallback-only for `/mkg3`.

Do not use AI as the primary engine for:

- text extraction
- superscript detection
- slide vs notes splitting
- annotation placement
- page-local reference matching

AI may be used later only when deterministic extraction is not viable, for example:

- scanned PDFs with no usable text layer
- flattened image-only tables/charts where the superscripted content is not extractable as text
- OCR fallback on non-selectable pages

### Shared library matching

After page-local annotation is built, citation text may be matched to the shared MKG reference library as a secondary enrichment step. This does not change the page-local annotation decision.

### QA toggle

The AI QA toggle must never interfere when it is off.

- Off: show only deterministic, reference-backed annotations plus required global annotations.
- On: allow extra AI-found review items, clearly separated from on-page annotations.
