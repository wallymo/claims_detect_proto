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


def extract_printed_page_number(page, page_index):
    try:
        label = page.get_label()
    except Exception:
        label = None

    if isinstance(label, str) and label.strip():
        return label.strip()

    page_height = page.rect.height
    page_width = page.rect.width
    page_dict = page.get_text("dict")
    numeric_candidates = []

    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            line_text = "".join((span.get("text") or "") for span in spans).strip()
            if not re.fullmatch(r"\d+", line_text):
                continue
            for span in spans:
                span_text = (span.get("text") or "").strip()
                if span_text != line_text:
                    continue
                bbox = span.get("bbox") or line.get("bbox") or block.get("bbox")
                if not bbox or len(bbox) < 4:
                    continue
                sx0, sy0, sx1, sy1 = bbox[:4]
                y_center = (sy0 + sy1) / 2
                if y_center <= page_height * 0.05:
                    region_rank = 1
                elif y_center >= page_height * 0.95:
                    region_rank = 0
                else:
                    continue
                font_size = float(span.get("size") or max(sy1 - sy0, 0))
                if font_size > 18:
                    continue
                center_distance = abs(((sx0 + sx1) / 2) - (page_width / 2))
                numeric_candidates.append((region_rank, font_size, center_distance, line_text))

    if numeric_candidates:
        numeric_candidates.sort()
        return numeric_candidates[0][3]

    return str(page_index + 1)


def detect_column_layout(page_dict_blocks, page_height):
    content_top = page_height * 0.08
    content_bottom = page_height * 0.92
    text_blocks = []

    for block in page_dict_blocks:
        if block.get("type") != 0:
            continue
        bbox = block.get("bbox")
        if not bbox or len(bbox) < 4:
            continue
        x0, y0, x1, y1 = bbox[:4]
        if y0 < content_top or y1 > content_bottom:
            continue
        line_texts = []
        for line in block.get("lines", []):
            span_text = "".join((span.get("text") or "") for span in line.get("spans", []))
            if span_text.strip():
                line_texts.append(span_text)
        block_text = re.sub(r"\s+", " ", " ".join(line_texts)).strip()
        if len(block_text) <= 20:
            continue
        text_blocks.append({"bbox": (x0, y0, x1, y1), "x_center": (x0 + x1) / 2})

    if len(text_blocks) < 6:
        return {"columns": 1, "boundary_x": None}

    x_min = min(block["bbox"][0] for block in text_blocks)
    x_max = max(block["bbox"][2] for block in text_blocks)
    content_width = x_max - x_min
    if content_width <= 0:
        return {"columns": 1, "boundary_x": None}

    midpoint = (x_min + x_max) / 2
    left_blocks = [block for block in text_blocks if block["x_center"] < midpoint]
    right_blocks = [block for block in text_blocks if block["x_center"] >= midpoint]

    if len(left_blocks) >= 3 and len(right_blocks) >= 3:
        left_edge = max(block["bbox"][2] for block in left_blocks)
        right_edge = min(block["bbox"][0] for block in right_blocks)
        if right_edge - left_edge > content_width * 0.10:
            return {"columns": 2, "boundary_x": (left_edge + right_edge) / 2}

    return {"columns": 1, "boundary_x": None}


def determine_column(x0, x1, layout):
    if layout.get("columns") != 2 or layout.get("boundary_x") is None:
        return 1
    if (x0 + x1) / 2 < layout["boundary_x"]:
        return 1
    return 2


def compute_paragraph_and_lines(page_dict, target_rect, col_num, layout, page_height):
    content_top = page_height * 0.08
    content_bottom = page_height * 0.92
    candidate_blocks = []

    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        bbox = block.get("bbox")
        if not bbox or len(bbox) < 4:
            continue
        x0, y0, x1, y1 = bbox[:4]
        if y0 < content_top or y1 > content_bottom:
            continue
        if determine_column(x0, x1, layout) != col_num:
            continue

        line_texts = []
        max_font_size = 0.0
        for line in block.get("lines", []):
            span_text = "".join((span.get("text") or "") for span in line.get("spans", []))
            if span_text.strip():
                line_texts.append(span_text)
            for span in line.get("spans", []):
                max_font_size = max(max_font_size, float(span.get("size") or 0))

        block_text = re.sub(r"\s+", " ", " ".join(line_texts)).strip()
        if len(block_text) <= 10:
            continue

        letters_only = re.sub(r"[^A-Za-z]+", "", block_text)
        is_all_caps = bool(letters_only) and letters_only == letters_only.upper()
        is_heading = (
            is_all_caps
            and len(block_text) <= 60
            and len(block_text.split()) <= 10
            and max_font_size >= 11
        )
        candidate_blocks.append({
            "bbox": (x0, y0, x1, y1),
            "block": block,
            "is_paragraph": not is_heading,
        })

    candidate_blocks.sort(key=lambda block: (block["bbox"][1], block["bbox"][0]))

    para_number = 0
    target_height = max(target_rect["y1"] - target_rect["y0"], 1.0)
    for block in candidate_blocks:
        if not block["is_paragraph"]:
            continue
        para_number += 1

        _, by0, _, by1 = block["bbox"]
        overlap = max(0.0, min(by1, target_rect["y1"]) - max(by0, target_rect["y0"]))
        if overlap <= target_height * 0.5:
            continue

        line_hits = []
        for line_number, line in enumerate(block["block"].get("lines", []), start=1):
            line_bbox = line.get("bbox")
            if not line_bbox or len(line_bbox) < 4:
                continue
            _, ly0, _, ly1 = line_bbox[:4]
            line_overlap = min(ly1, target_rect["y1"] + 2) - max(ly0, target_rect["y0"] - 2)
            if line_overlap > 0:
                line_hits.append(line_number)

        result = {"para": para_number}
        if line_hits:
            result["line_start"] = min(line_hits)
            result["line_end"] = max(line_hits)
        return result

    return None


def extract_figure_table_label(candidate_text):
    if not candidate_text:
        return None
    match = re.match(
        r"^(fig\.?\s*\d+|figure\s*\d+|table\s*\d+|box\s*\d+)",
        candidate_text.strip(),
        re.IGNORECASE,
    )
    if not match:
        return None
    return re.sub(r"\s+", " ", match.group(1).lower().replace(".", "")).strip()


def build_location_annotation(page, page_index, rect_dict, candidate_type, candidate_text, page_dict_cache):
    printed_page = extract_printed_page_number(page, page_index)
    if page_index not in page_dict_cache:
        page_dict_cache[page_index] = page.get_text("dict")

    page_dict = page_dict_cache[page_index]
    layout = detect_column_layout(page_dict.get("blocks", []), page.rect.height)
    col_num = determine_column(rect_dict["x0"], rect_dict["x1"], layout)
    location = f"/p{printed_page}/col{col_num}"
    candidate_kind = (candidate_type or "").lower()
    label = extract_figure_table_label(candidate_text)

    if candidate_kind in {"figure", "chart", "diagram"}:
        return f"{location}/{label}" if label else f"{location}/fig"

    if candidate_kind in {"structured_box", "table"}:
        if label:
            return f"{location}/{label}"
        default_label = "box" if candidate_kind == "structured_box" else "table"
        return f"{location}/{default_label}"

    if candidate_kind in {"text", "heading", "caption"}:
        para_info = compute_paragraph_and_lines(page_dict, rect_dict, col_num, layout, page.rect.height)
        if not para_info:
            return location
        location = f"{location}/para{para_info['para']}"
        if "line_start" in para_info and "line_end" in para_info:
            if para_info["line_start"] == para_info["line_end"]:
                return f"{location}/ln{para_info['line_start']}"
            return f"{location}/ln{para_info['line_start']}-{para_info['line_end']}"
        return location

    return location


def extract_candidate_regions(pdf_path, claim, top_k=30):
    doc = pymupdf.open(pdf_path)
    candidates = []
    region_index = 1
    claim_terms = extract_terms(claim)
    vision_pages = []
    page_dict_cache = {}

    for page_number in range(len(doc)):
        page = doc[page_number]
        pw, ph = page.rect.width, page.rect.height
        blocks = page.get_text("blocks")
        consumed_indices = set()

        # Phase 1: Rect grouping — find structured boxes
        groups = find_rect_groups(page, blocks)
        for group in groups:
            consumed_indices.update(group["block_indices"])
            pre_score = score_candidate(claim_terms, group["text"])
            # Boost structured content
            if pre_score > 0:
                pre_score = min(pre_score * 1.25, 1.0)
            rx0, ry0, rx1, ry1 = group["rect"]
            group_rect = {"x0": round(rx0, 1), "y0": round(ry0, 1),
                          "x1": round(rx1, 1), "y1": round(ry1, 1)}
            candidates.append({
                "candidate_id": f"cand_{region_index:04d}",
                "page_number": page_number + 1,
                "type": "structured_box",
                "rects": [group_rect],
                "text": group["text"],
                "pre_score": pre_score,
                "location_annotation": build_location_annotation(
                    page,
                    page_number,
                    group_rect,
                    "structured_box",
                    group["text"],
                    page_dict_cache,
                ),
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
                "location_annotation": build_location_annotation(
                    page,
                    page_number,
                    fig_rect,
                    "figure",
                    fig_text,
                    page_dict_cache,
                ),
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
                image_rect = {"x0": round(x0, 1), "y0": round(y0, 1),
                              "x1": round(x1, 1), "y1": round(y1, 1)}
                candidates.append({
                    "candidate_id": f"cand_{region_index:04d}",
                    "page_number": page_number + 1,
                    "type": "figure",
                    "rects": [image_rect],
                    "text": None,
                    "pre_score": 0.0,
                    "location_annotation": build_location_annotation(
                        page,
                        page_number,
                        image_rect,
                        "figure",
                        None,
                        page_dict_cache,
                    ),
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

            text_rect = {"x0": round(x0, 1), "y0": round(y0, 1),
                         "x1": round(x1, 1), "y1": round(y1, 1)}
            candidates.append({
                "candidate_id": f"cand_{region_index:04d}",
                "page_number": page_number + 1,
                "type": block_type_label,
                "rects": [text_rect],
                "text": text,
                "pre_score": pre_score,
                "location_annotation": build_location_annotation(
                    page,
                    page_number,
                    text_rect,
                    block_type_label,
                    text,
                    page_dict_cache,
                ),
            })
            region_index += 1

    candidates.sort(key=lambda c: c["pre_score"], reverse=True)
    shortlisted = candidates[:top_k]

    result = {
        "candidates": shortlisted,
        "total_extracted": region_index - 1,
        "shortlisted": len(shortlisted),
        "vision_pages": vision_pages,
    }
    return result


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
