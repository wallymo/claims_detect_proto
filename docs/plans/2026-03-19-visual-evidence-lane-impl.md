# Visual Evidence Lane — Implementation Plan

**Design doc:** `docs/plans/2026-03-19-visual-evidence-lane-design.md`

---

## Task 1: Rect Grouping in evidence_candidates.py

**Files:** Modify `scripts/evidence_candidates.py`

**Step 1: Add rect grouping function**

Add `find_rect_groups(page, text_blocks)` after `classify_block()`:

1. Get all drawings via `page.get_drawings()`
2. Filter for rectangular paths: `path["type"] == "re"` or 4-point closed paths with right angles
3. Filter by area: keep rects between 5% and 90% of page area
4. For each rect, find text blocks where >=80% of the block bbox falls inside
5. If 3+ contained blocks OR 2+ bullet lines across contained blocks → create composite
6. Return list of `{ rect, block_indices, concatenated_text }`

**Step 2: Add vision flagging function**

Add `should_flag_for_vision(page, text_blocks)`:

1. Count drawings: `len(page.get_drawings())`
2. Calculate text coverage: sum of block areas / page area
3. Return `True` if `drawing_count > 15 AND text_coverage < 0.40`

**Step 3: Integrate into extract_candidate_regions()**

After extracting text blocks per page but before scoring:

1. Call `find_rect_groups()` — get composite candidates
2. For each composite: score, add as `type: "structured_box"` with 25% boost, track consumed block indices
3. Skip consumed blocks when processing individual candidates
4. Call `should_flag_for_vision()` — collect flagged page numbers
5. Add `vision_pages` to the output dict

**Step 4: Test**

```bash
scripts/.venv/bin/python3 scripts/evidence_candidates.py \
  "References/References/Leonhard 2019 Nat Rev Neurology.pdf" \
  --claim "Differential diagnosis of Guillain-Barré syndrome" \
  --top-k 10 --pretty
```

Expected: `structured_box` candidates from page 7 (Box 2), `vision_pages: [3]` (Figure 1 page).

---

## Task 2: Page Renderer Script

**Files:** Create `scripts/render_page.py`

**Step 1: Write the script**

Takes `<pdf_path> --page N --output <path.png>` — renders page N to PNG at 150 DPI using `page.get_pixmap(dpi=150)`. Output to stdout as base64 if no `--output` flag.

**Step 2: Test**

```bash
scripts/.venv/bin/python3 scripts/render_page.py \
  "References/References/Leonhard 2019 Nat Rev Neurology.pdf" \
  --page 3 --output /tmp/test_page3.png
```

---

## Task 3: Vision Lane in evidenceController.js

**Files:** Modify `backend/src/controllers/evidenceController.js`

**Step 1: Add renderPageToPng helper**

Call `scripts/render_page.py <pdf_path> --page N` via execFile, capture base64 PNG output.

**Step 2: Add analyzePageWithVision helper**

Send base64 PNG to Gemini Vision (`gemini-2.5-flash`) with prompt:
"Identify all figures, charts, tables, and diagrams on this PDF page. For each, return: type (figure|chart|table|diagram), bbox as [x0, y0, x1, y1] in percentage of page dimensions (0-100), and a one-sentence description. Return strict JSON: { \"visuals\": [{ \"type\": \"...\", \"bbox\": [...], \"description\": \"...\" }] }"

**Step 3: Integrate into generateSuggestions**

After Python script returns, before Gemini reranking:

1. Check `candidateResult.vision_pages`
2. For each vision page: render PNG → send to Vision → parse response
3. Convert each visual to a candidate: `{ candidate_id: "vis_pN_idx", type, text: description, rects: [converted bbox], pre_score: 0.5 }`
4. Append visual candidates to the candidate list
5. Pass full list to reranker

**Step 4: Update reranker prompt**

Add to the reranking prompt: "Candidates with type 'figure', 'chart', or 'structured_box' contain visual evidence. Prefer these when the claim involves quantitative data, comparisons, or clinical classifications."

**Step 5: Test**

```bash
curl -X POST http://localhost:3001/api/evidence/suggestions \
  -H "Content-Type: application/json" \
  -d '{"claim_text": "Differential diagnosis of Guillain-Barré syndrome", "claim_id": "test-vis", "reference_id": 1}'
```

---

## Summary

| Task | Files | Depends On |
|------|-------|------------|
| 1. Rect grouping + vision flagging | `evidence_candidates.py` | — |
| 2. Page renderer | `render_page.py` (new) | — |
| 3. Vision lane in controller | `evidenceController.js` | Tasks 1, 2 |

**Parallelizable:** Tasks 1 and 2 can run in parallel.
