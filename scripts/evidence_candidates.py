#!/usr/bin/env python3
"""
Evidence candidate extractor: parse a reference PDF into candidate regions,
score them against a claim, and return the top-k shortlist as JSON.

Usage:
    scripts/.venv/bin/python3 scripts/evidence_candidates.py <pdf_path> --claim "claim text" --top-k 30 --pretty
"""

import argparse
import json
import re
import sys

import pymupdf


def normalize(text):
    return re.sub(r"\s+", " ", text.lower()).strip()


def extract_terms(claim):
    claim_n = normalize(claim)
    tokens = sorted(set(t for t in re.findall(r"[a-zA-Z0-9\-%\.]+", claim_n) if len(t) > 2))
    numeric = sorted(set(re.findall(
        r"\b\d+(?:\.\d+)?%?|hr\s*0?\.\d+|p\s*[<=>]\s*0?\.\d+\b", claim_n
    )))
    return {"tokens": tokens, "numeric": numeric}


def score_candidate(claim_terms, candidate_text):
    text_n = normalize(candidate_text)
    token_hits = sum(1 for t in claim_terms["tokens"] if t in text_n)
    numeric_hits = sum(1 for n in claim_terms["numeric"] if n in text_n)
    token_score = min(token_hits / max(len(claim_terms["tokens"]), 1), 1.0)
    numeric_score = (
        min(numeric_hits / max(len(claim_terms["numeric"]), 1), 1.0)
        if claim_terms["numeric"]
        else 0.0
    )
    return round(0.65 * token_score + 0.35 * numeric_score, 4)


def classify_block(text, rect, page_width, page_height):
    """Heuristic block type classification."""
    x0, y0, x1, y1 = rect
    width_ratio = (x1 - x0) / page_width if page_width else 0
    height_ratio = (y1 - y0) / page_height if page_height else 0
    text_stripped = text.strip()
    lines = text_stripped.split("\n")

    # Caption: short text starting with Figure/Table/Chart/Box
    if len(text_stripped) < 200 and re.match(
        r"^(figure|table|chart|box|fig\.?)\s", text_stripped, re.IGNORECASE
    ):
        return "caption"

    # Structured box: starts with "Box N" header pattern (common in review papers)
    if re.match(r"^box\s+\d", text_stripped, re.IGNORECASE):
        return "table"

    # Table heuristic: multiple lines with tab/pipe alignment
    pipe_lines = sum(1 for l in lines if "|" in l)
    tab_lines = sum(1 for l in lines if "\t" in l)
    if len(lines) >= 3 and (pipe_lines >= len(lines) * 0.5 or tab_lines >= len(lines) * 0.5):
        return "table"

    # Structured content: many bullet points or numbered items (lists, boxes)
    bullet_lines = sum(1 for l in lines if re.match(r"^\s*[•·\-–—]\s", l) or re.match(r"^\s*\d+[.)]\s", l))
    if len(lines) >= 5 and bullet_lines >= len(lines) * 0.3:
        return "table"

    # Wide block with many lines = likely structured content (multi-column boxes, tables)
    if width_ratio > 0.8 and len(lines) >= 8 and height_ratio > 0.15:
        return "table"

    # Heading: short, typically bold
    if len(text_stripped) < 80 and len(lines) <= 2 and width_ratio < 0.7:
        return "heading"

    return "text"


def _block_overlap(block_rect, container_rect):
    """Return fraction of block_rect area that overlaps with container_rect."""
    bx0, by0, bx1, by1 = block_rect
    cx0, cy0, cx1, cy1 = container_rect
    ix0 = max(bx0, cx0)
    iy0 = max(by0, cy0)
    ix1 = min(bx1, cx1)
    iy1 = min(by1, cy1)
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    intersection = (ix1 - ix0) * (iy1 - iy0)
    block_area = max((bx1 - bx0) * (by1 - by0), 1)
    return intersection / block_area


def _count_bullet_lines(text):
    """Count lines starting with bullet or numbered markers."""
    lines = text.strip().split("\n")
    return sum(
        1 for l in lines
        if re.match(r"^\s*[•·\-–—]\s", l) or re.match(r"^\s*\d+[.)]\s", l)
    )


def find_rect_groups(page, text_blocks):
    """Detect rectangular outlines and group text blocks inside them.

    Returns list of { "rect": (x0,y0,x1,y1), "block_indices": [...], "text": str }
    """
    pw, ph = page.rect.width, page.rect.height
    page_area = pw * ph
    if page_area == 0:
        return []

    # Extract rectangular drawing paths
    rects = []
    for d in page.get_drawings():
        r = d.get("rect")
        if r is None:
            continue
        rx0, ry0, rx1, ry1 = r
        rect_area = (rx1 - rx0) * (ry1 - ry0)
        area_ratio = rect_area / page_area
        # Keep rects between 5% and 90% of page area
        if 0.05 < area_ratio < 0.90:
            rects.append((rx0, ry0, rx1, ry1))

    # Deduplicate near-identical rects (within 10pt tolerance — catches inner+outer borders)
    unique_rects = []
    for r in rects:
        is_dup = False
        for u in unique_rects:
            if all(abs(r[i] - u[i]) < 10 for i in range(4)):
                is_dup = True
                break
        if not is_dup:
            unique_rects.append(r)

    groups = []
    for rect in unique_rects:
        contained_indices = []
        contained_texts = []
        total_bullets = 0

        for i, block in enumerate(text_blocks):
            bx0, by0, bx1, by1, text, block_no, block_type = block
            if block_type == 1:  # image block
                continue
            t = (text or "").strip()
            if not t:
                continue
            overlap = _block_overlap((bx0, by0, bx1, by1), rect)
            if overlap >= 0.80:
                contained_indices.append(i)
                contained_texts.append((by0, bx0, t))  # sort key: y then x
                total_bullets += _count_bullet_lines(t)

        # Group if 3+ blocks or 2+ bullet lines
        if len(contained_indices) >= 3 or total_bullets >= 2:
            contained_texts.sort()  # top-to-bottom, left-to-right
            merged_text = "\n".join(t for _, _, t in contained_texts)
            groups.append({
                "rect": rect,
                "block_indices": set(contained_indices),
                "text": merged_text,
            })

    return groups


def should_flag_for_vision(page, text_blocks):
    """Detect pages likely containing charts/figures that need Vision analysis."""
    drawing_count = len(page.get_drawings())
    if drawing_count <= 15:
        return False

    pw, ph = page.rect.width, page.rect.height
    page_area = pw * ph
    if page_area == 0:
        return False

    text_area = 0
    for block in text_blocks:
        x0, y0, x1, y1, text, block_no, block_type = block
        if block_type == 0 and (text or "").strip():
            text_area += (x1 - x0) * (y1 - y0)

    text_coverage = text_area / page_area
    return text_coverage < 0.40


def extract_candidate_regions(pdf_path, claim, top_k=30):
    doc = pymupdf.open(pdf_path)
    candidates = []
    region_index = 1
    claim_terms = extract_terms(claim)
    vision_pages = []

    for page_number in range(len(doc)):
        page = doc[page_number]
        pw, ph = page.rect.width, page.rect.height
        blocks = page.get_text("blocks")

        # Phase 1: Rect grouping — find structured boxes
        groups = find_rect_groups(page, blocks)
        consumed_indices = set()
        for group in groups:
            consumed_indices.update(group["block_indices"])
            pre_score = score_candidate(claim_terms, group["text"])
            # Boost structured content
            if pre_score > 0:
                pre_score = min(pre_score * 1.25, 1.0)
            rx0, ry0, rx1, ry1 = group["rect"]
            candidates.append({
                "candidate_id": f"cand_{region_index:04d}",
                "page_number": page_number + 1,
                "type": "structured_box",
                "rects": [{"x0": round(rx0, 1), "y0": round(ry0, 1),
                           "x1": round(rx1, 1), "y1": round(ry1, 1)}],
                "text": group["text"],
                "pre_score": pre_score,
            })
            region_index += 1

        # Phase 2: Vision flagging
        if should_flag_for_vision(page, blocks):
            vision_pages.append(page_number + 1)

        # Phase 2.5: Caption-anchored figure expansion
        # When a caption ("Fig. N", "Table N") is found, expand its bounding box
        # upward to capture the visual content above it (chart/figure/table).
        caption_consumed = set()
        for i, block in enumerate(blocks):
            if i in consumed_indices:
                continue
            bx0, by0, bx1, by1, btext, bno, btype = block
            if btype != 0:
                continue
            t = (btext or "").strip()
            if not t:
                continue
            # Detect caption patterns
            if not re.match(r"^(fig\.?\s*\d|figure\s*\d|table\s*\d)", t, re.IGNORECASE):
                continue

            # Find the nearest text block above the caption (the ceiling)
            caption_top = by0
            ceiling_y = 0  # default: top of page
            for j, other in enumerate(blocks):
                if j == i or j in consumed_indices:
                    continue
                ox0, oy0, ox1, oy1, otext, ono, otype = other
                if otype != 0:
                    continue
                ot = (otext or "").strip()
                if not ot or len(ot) < 10:
                    continue
                # Is this block above the caption?
                if oy1 < caption_top and oy1 > ceiling_y:
                    # Only consider blocks that aren't themselves captions
                    if not re.match(r"^(fig\.?\s*\d|figure\s*\d|table\s*\d)", ot, re.IGNORECASE):
                        ceiling_y = oy1

            # Expand: use full page width, from ceiling to bottom of caption
            # But limit expansion to at most 50% of page height
            expand_top = max(ceiling_y, caption_top - ph * 0.5)
            fig_rect = {
                "x0": round(max(bx0 - 20, 0), 1),
                "y0": round(expand_top, 1),
                "x1": round(min(bx1 + 20, pw), 1),
                "y1": round(by1, 1),
            }
            fig_text = t  # caption text for scoring
            pre_score = score_candidate(claim_terms, fig_text)
            if pre_score > 0:
                pre_score = min(pre_score * 1.25, 1.0)  # boost visual content

            candidates.append({
                "candidate_id": f"cand_{region_index:04d}",
                "page_number": page_number + 1,
                "type": "figure",
                "rects": [fig_rect],
                "text": fig_text,
                "pre_score": max(pre_score, 0.3),  # floor: figures always have some relevance
            })
            region_index += 1
            caption_consumed.add(i)

        consumed_indices.update(caption_consumed)

        # Phase 3: Individual text blocks (skip consumed ones)
        for i, block in enumerate(blocks):
            if i in consumed_indices:
                continue

            x0, y0, x1, y1, text, block_no, block_type = block
            if block_type == 1:
                candidates.append({
                    "candidate_id": f"cand_{region_index:04d}",
                    "page_number": page_number + 1,
                    "type": "figure",
                    "rects": [{"x0": round(x0, 1), "y0": round(y0, 1),
                               "x1": round(x1, 1), "y1": round(y1, 1)}],
                    "text": None,
                    "pre_score": 0.0,
                })
                region_index += 1
                continue

            text = (text or "").strip()
            if not text or len(text) < 10:
                continue

            block_type_label = classify_block(text, (x0, y0, x1, y1), pw, ph)
            pre_score = score_candidate(claim_terms, text)

            # Boost structured content — tables/boxes concentrate evidence
            if block_type_label == "table" and pre_score > 0:
                pre_score = min(pre_score * 1.25, 1.0)

            candidates.append({
                "candidate_id": f"cand_{region_index:04d}",
                "page_number": page_number + 1,
                "type": block_type_label,
                "rects": [{"x0": round(x0, 1), "y0": round(y0, 1),
                           "x1": round(x1, 1), "y1": round(y1, 1)}],
                "text": text,
                "pre_score": pre_score,
            })
            region_index += 1

    candidates.sort(key=lambda c: c["pre_score"], reverse=True)
    shortlisted = candidates[:top_k]

    return {
        "candidates": shortlisted,
        "total_extracted": region_index - 1,
        "shortlisted": len(shortlisted),
        "vision_pages": vision_pages,
    }


def main():
    parser = argparse.ArgumentParser(description="Extract evidence candidate regions from a PDF")
    parser.add_argument("pdf_path", help="Path to the reference PDF")
    parser.add_argument("--claim", required=True, help="Claim text to score against")
    parser.add_argument("--top-k", type=int, default=30, help="Number of top candidates to return")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output")

    args = parser.parse_args()
    result = extract_candidate_regions(args.pdf_path, args.claim, args.top_k)

    indent = 2 if args.pretty else None
    json.dump(result, sys.stdout, indent=indent)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
