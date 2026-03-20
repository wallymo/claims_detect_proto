# Visual Evidence Lane — Design

**Date:** March 19, 2026
**Branch:** newworkflow
**Depends on:** Evidence suggestion pipeline (already built)
**Goal:** Detect charts, figures, tables, and structured boxes in reference PDFs and surface them as prioritized evidence candidates alongside text-based candidates.

## Problem

Reference PDFs contain critical evidence in visual formats — differential diagnosis tables (Box 2), flowcharts (Figure 1), bar charts showing incidence rates. The current pipeline only scores individual text blocks, so a 12-block structured box gets fragmented into weak individual candidates instead of being treated as one strong piece of evidence.

Additionally, vector-based charts and figures contain no extractable text — they're invisible to the current text-only pipeline.

## Design Decisions

| Decision | Choice | Why |
|---|---|---|
| Rect grouping | Deterministic via PyMuPDF drawings | Cheap, instant, handles structured boxes/tables |
| Chart/figure detection | Gemini Vision on flagged pages only | Only way to "see" vector graphics; selective to control cost |
| Trigger for Vision | drawing_count > 15 AND text_coverage < 40% | Separates chart-heavy pages from text-with-decorations |
| Grouping output | Concatenated text + outer rect bbox | One candidate = one piece of evidence |
| Vision output | Bounding boxes + descriptions per figure | Precise red-box placement + scorable text for reranker |
| Integration | Injected into existing candidate list before rerank | No separate UI — visual candidates appear as regular suggestions with different type labels |

## Architecture

### Phase 1: Rect Grouping (in `evidence_candidates.py`)

For each page:

1. Extract rectangular drawing paths via `page.get_drawings()`
2. Filter: keep rects between 5% and 90% of page area
3. For each rectangle, collect text blocks where bbox is >=80% contained
4. If 3+ blocks inside, OR any block has bullet/numbered lines:
   - Merge into composite candidate with `type: "structured_box"`
   - Concatenate block texts (sorted top-to-bottom, left-to-right)
   - Bounding box = the outer rectangle
   - Remove individual blocks from regular list (avoid duplicates)
5. Otherwise leave blocks as individual candidates

### Phase 2: Vision Flagging (in `evidence_candidates.py`)

For each page:
- Count vector drawings: `len(page.get_drawings())`
- Calculate text coverage: `sum(block areas) / page area`
- If `drawing_count > 15 AND text_coverage < 0.40`:
  - Add page number to `vision_pages` output array

### Phase 3: Vision Analysis (in `evidenceController.js`)

For each flagged vision page:
1. Render page to PNG via new Python helper: `scripts/render_page.py <pdf_path> --page N`
2. Send PNG to Gemini Vision with prompt:
   "Identify all figures, charts, tables, and diagrams on this page. For each, return bounding box coordinates [x0, y0, x1, y1] as percentage of page dimensions, a one-sentence description, and type (figure|chart|table|diagram). Return strict JSON."
3. Each result becomes a candidate: `type: "figure"|"chart"`, `text: description`, `rects: [bbox]`
4. Visual candidates injected into candidate list before reranking

### Phase 4: Reranking (existing, with prompt update)

Gemini 2.5-pro reranker prompt gets addition:
"Candidates with type 'figure', 'chart', or 'structured_box' contain visual evidence. Prefer these when the claim involves quantitative data, comparisons, or clinical classifications."

## Output Shape Change

```json
{
  "candidates": [
    { "candidate_id": "cand_0042", "type": "structured_box", "text": "Box 2 | Differential...", "rects": [...] },
    { "candidate_id": "cand_0089", "type": "text", "text": "GBS occurs worldwide...", "rects": [...] },
    { "candidate_id": "vis_p3_1", "type": "chart", "text": "Flowchart showing 10-step approach to GBS diagnosis", "rects": [...] }
  ],
  "vision_pages": [3, 8],
  "total_extracted": 145,
  "shortlisted": 30
}
```

## Rect Grouping Algorithm Detail

```
For each drawing in page.get_drawings():
  If path.type == "re" (rectangle) OR is_rectangular(path.items):
    rect = path.rect
    area_ratio = rect_area / page_area
    If 0.05 < area_ratio < 0.90:
      → candidate container

For each container rect:
  contained_blocks = [b for b in text_blocks if overlap(b, rect) >= 0.80]
  bullet_count = count lines starting with bullet/number markers

  If len(contained_blocks) >= 3 OR bullet_count >= 2:
    → composite candidate {
        type: "structured_box",
        text: "\n".join(sorted blocks by y then x),
        rects: [container rect],
        pre_score: score_candidate(claim_terms, concatenated_text) * 1.25
      }
    → remove contained_blocks from individual candidate list
```

## Vision Page Detection

```
drawing_count = len(page.get_drawings())
text_blocks = [b for b in blocks if b.type == 0]
text_area = sum((b.x1-b.x0) * (b.y1-b.y0) for b in text_blocks)
text_coverage = text_area / (page.width * page.height)

needs_vision = drawing_count > 15 AND text_coverage < 0.40
```

## File Changes

### Modified
- `scripts/evidence_candidates.py` — rect grouping + vision flagging logic
- `backend/src/controllers/evidenceController.js` — Vision lane between Python and rerank

### New
- `scripts/render_page.py` — renders a single PDF page to PNG via PyMuPDF

### Unchanged
- Frontend (visual candidates render as regular suggestion cards)
- Database schema (no new tables)
- Models, routes, API functions

## Cost Impact

- Rect grouping: zero cost (pure PyMuPDF)
- Vision calls: ~$0.01-0.03 per flagged page (Gemini Vision)
- Typical paper: 1-3 pages flagged out of 10-20
- Worst case: ~$0.10 extra per evidence suggestion run
