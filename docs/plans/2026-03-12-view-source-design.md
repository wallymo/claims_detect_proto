# View Source — Claim Card to Library Document

**Date:** March 12, 2026

## Summary

Enable reviewers to click any reference callout on a claim card to open the matched library document in a PDF overlay, scrolled to and highlighting the relevant passage. Two-tier passage location: backend fact lookup first, client-side text search fallback.

## Claim Card Interaction

- Each green ref callout (`1. Author et al...`) becomes clickable — no extra buttons
- Hover state: cursor pointer, background shift to `var(--green-2)`, underline on citation text, `fileSearch` icon appears on right edge
- Unmatched refs (no `ref.id`): no hover effect, slightly dimmed, tooltip "Source document not in library"
- Click on matched ref: opens PDF overlay with the library document scrolled to the relevant passage
- Remove the disabled "View Source" button at the bottom of the ref callouts group

## PDF Overlay — Source Viewer

- Reuses existing PDF viewer overlay component in "source viewing" mode
- **Header bar**: library document name, page indicator ("Page 3 of 12"), close button
- **Highlighted passage**: yellow/amber background box over the matched text span
- **Auto-scroll**: opens at the page containing the match
- **Jump-to-highlight pill**: floats in corner if reviewer scrolls away, snaps back to highlight on click
- **No tabs or multi-document view** — close overlay, click next ref to view another source. Lightweight open → scan → close → repeat cycle.

## Passage Location — Two-Tier Strategy

### Tier 1: Fact Lookup (instant, no cost)

- Query `reference_facts` table for the matched library document (`ref.id`)
- Find a fact whose text matches the claim text or citation text (fuzzy substring)
- If found → open overlay at that fact's page number, highlight the fact text
- Covers the common case where claims map to pre-extracted facts

### Tier 2: Client-Side Text Search (fallback, still free)

- Fires only if Tier 1 misses
- Load source PDF with pdf.js, extract text from each page
- Search for the claim text within the document (normalized — whitespace, case-insensitive)
- Best match → scroll to that page, highlight the span
- Simple text search — we already know the correct document, just finding where the claim text appears

### Failure Graceful

- If neither tier finds a match → open PDF at page 1
- Show subtle toast: "Couldn't locate exact passage — showing full document"
- Never block the action — reviewer always gets the source document

## Data Flow

```
Ref callout click
  → ref.id exists? (matched to library)
    → No: tooltip "Source not in library", no action
    → Yes: fetch library PDF + start passage lookup
      → Tier 1: GET /api/references/:id/facts → fuzzy match claim text → page + highlight text
      → Tier 2 (if T1 miss): pdf.js text extraction → search claim text across pages → page + highlight span
      → Neither: page 1, toast
  → Open PDF overlay at target page with highlight
```

## Existing Infrastructure

- `matchCitationToLibrary()` in MKG3ClaimsDetector.jsx already enriches refs with `{ id, name }` from brand library
- `reference_facts` table has pre-extracted facts with page numbers per library document
- PDFViewer component already supports overlay rendering and text layer highlighting
- pdf.js text extraction is already used by the annotation engine (`extractPageTextLines`)

## What Changes

| Area | Change |
|------|--------|
| MKGClaimCard.jsx | Ref callouts become clickable, remove disabled View Source button, add `onViewRef` callback |
| MKGClaimCard.module.css | Hover states for clickable refs, dimmed state for unmatched |
| MKG3ClaimsDetector.jsx | Handle `onViewRef(ref)` — fetch PDF, locate passage, open overlay |
| PDFViewer.jsx | Accept highlight target (page + text span), render highlight box, jump-to-highlight pill |
| api.js | Add `getReferenceFacts(refId)` if not already present |
