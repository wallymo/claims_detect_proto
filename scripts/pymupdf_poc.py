#!/usr/bin/env python3
"""
PyMuPDF POC: Layout-aware PDF annotation parser for PowerPoint Notes-view exports.

For each page:
  1. Split into slide region (top) and notes region (bottom)
  2. Extract text spans with coordinates, font size, and superscript flags
  3. Detect numeric superscript citations in each region
  4. Parse reference pools: slide footnotes + notes references
  5. Match superscripts to their region's reference pool
  6. Output structured JSON

Usage:
    python scripts/pymupdf_poc.py <pdf_path>
    python scripts/pymupdf_poc.py <pdf_path> --pretty
    python scripts/pymupdf_poc.py <pdf_path> --debug
"""

import argparse
from collections import Counter
import json
import re
import sys

import pymupdf


# ---------------------------------------------------------------------------
# Phase 1: Region split
# ---------------------------------------------------------------------------

def find_notes_boundary(spans):
    """Find the y-coordinate that separates slide from notes region.

    Primary: look for 'Speaker notes' / 'Speaker note' label.
    Fallback: 50% of page height.
    Returns y as percentage of page height (spans already have y as %).
    """
    for span in spans:
        text = span["text"].strip().lower()
        if re.match(r"^speaker\s+notes?\s*$", text):
            return span["y"]
    return 50.0


# ---------------------------------------------------------------------------
# Phase 2: Extract text spans with metadata
# ---------------------------------------------------------------------------

def extract_spans(page):
    """Extract all text spans from a page with metadata.

    Returns list of dicts with: text, size, x, y (as % of page),
    flags, font, is_superscript.
    """
    data = page.get_text("dict")
    pw, ph = page.rect.width, page.rect.height
    spans = []

    for block_idx, block in enumerate(data["blocks"]):
        if block["type"] != 0:  # skip image blocks
            continue
        for line in block["lines"]:
            for span in line["spans"]:
                text = span["text"]
                if not text.strip():
                    continue
                spans.append({
                    "text": text,
                    "size": span["size"],
                    "x": span["origin"][0] / pw * 100,
                    "y": span["origin"][1] / ph * 100,
                    "x_abs": span["origin"][0],
                    "y_abs": span["origin"][1],
                    "flags": span["flags"],
                    "font": span["font"],
                    "is_superscript": bool(span["flags"] & 1),
                    "block_id": block_idx,
                })

    return spans, pw, ph


# ---------------------------------------------------------------------------
# Phase 3a: Superscript detection
# ---------------------------------------------------------------------------

def is_numeric_superscript(span):
    """Check if a span is a numeric superscript citation.

    Two signals:
    1. PyMuPDF superscript flag (flags & 1)
    2. Font size significantly smaller than typical body text (< 8pt)
       AND content is numeric-like

    Content must match: digits, commas, hyphens, dots (e.g. "1,2" or "1-3")
    """
    text = span["text"].strip()
    if not text:
        return False

    # Must be numeric citation content
    if not re.match(r"^[\d,\-.\s]+$", text):
        return False

    # Use PyMuPDF superscript flag only — it's reliable on PowerPoint exports
    return span["is_superscript"]


def parse_superscript_numbers(text):
    """Parse superscript text into a list of reference numbers.

    Handles: "1", "1,2", "1,3,4", "1-3" (expands to [1,2,3])
    """
    text = text.strip()
    numbers = []

    for part in re.split(r"[,\s]+", text):
        part = part.strip()
        if not part:
            continue
        # Handle ranges like "1-3"
        range_match = re.match(r"^(\d+)\s*[-–—]\s*(\d+)$", part)
        if range_match:
            start, end = int(range_match.group(1)), int(range_match.group(2))
            numbers.extend(range(start, end + 1))
        elif re.match(r"^\d+$", part):
            numbers.append(int(part))

    # Filter to reasonable range (1-50)
    return [n for n in numbers if 1 <= n <= 50]


# ---------------------------------------------------------------------------
# Phase 3b: Reference pool parsing
# ---------------------------------------------------------------------------

def find_slide_footnotes(spans, boundary_y):
    """Extract slide footnote pool — tiny text near the bottom of slide region.

    Slide footnotes are typically:
    - In the bottom portion of the slide region (y > boundary_y - 15%)
    - Very small font (< 6pt typically)
    - Numbered entries like "1. Author et al. Journal. Year;..."
    """
    footnote_zone_top = boundary_y - 15  # bottom 15% of slide region
    footnote_spans = []

    for span in spans:
        if span["y"] >= boundary_y:
            continue  # in notes region
        if span["y"] < footnote_zone_top:
            continue  # too high in slide
        if span["size"] > 6.0:
            continue  # not footnote-sized
        if span["is_superscript"]:
            continue
        text = span["text"].strip()
        # Skip copyright notices
        if "©" in text or "All rights reserved" in text.lower():
            continue
        # Skip standalone page numbers (single digit near boundary)
        if re.match(r"^\d{1,2}$", text) and span["y"] > boundary_y - 8:
            continue
        footnote_spans.append(span)

    # Sort by y then x for reading order
    footnote_spans.sort(key=lambda s: (round(s["y"], 1), s["x"]))

    # Concatenate all footnote text into lines by y-proximity
    lines = _group_spans_into_lines(footnote_spans, y_tolerance=0.5)

    # Filter out abbreviation legend lines (not references)
    lines = [l for l in lines if not _is_abbreviation_line(l)]

    # Parse numbered references from concatenated footnote text
    full_text = " ".join(lines)
    return _parse_numbered_refs_inline(full_text)


def _is_abbreviation_line(text):
    """Detect abbreviation legend lines like 'CMV, cytomegalovirus; EBV, ...'"""
    # Look for actual abbreviation patterns: UPPERCASE, lowercase definition
    # e.g., 'CMV, cytomegalovirus; EBV, Epstein-Barr virus'
    abbrev_pairs = re.findall(r"\b[A-Z]{2,},\s+[a-z]", text)
    if len(abbrev_pairs) >= 2:
        return True
    return False


def find_notes_references(spans, boundary_y):
    """Extract notes reference pool — text below 'References' header.

    Looks for 'References' / 'Reference' header in the notes region,
    then parses numbered entries with continuation line accumulation.
    """
    # Find the References header
    ref_header_y = None
    for span in spans:
        if span["y"] < boundary_y:
            continue
        text = span["text"].strip().lower()
        if re.match(r"^references?\s*[,:;.]?\s*$", text):
            ref_header_y = span["y"]
            break

    if ref_header_y is None:
        return {}

    # Determine the dominant body font size in the notes region
    notes_body_spans = [s for s in spans
                        if s["y"] > boundary_y and not s["is_superscript"]
                        and s["size"] >= 4.0]
    if notes_body_spans:
        # Use the most common font size as the body size
        size_counts = Counter(round(s["size"], 1) for s in notes_body_spans)
        dominant_size = size_counts.most_common(1)[0][0]
        min_ref_size = max(dominant_size - 1.0, 4.0)
    else:
        min_ref_size = 8.0

    # Collect spans below the header, excluding page numbers and tiny text
    ref_spans = [s for s in spans
                 if s["y"] > ref_header_y and not s["is_superscript"]
                 and s["size"] >= min_ref_size
                 and s["y"] < 95.0]  # exclude page numbers at very bottom

    ref_spans.sort(key=lambda s: (round(s["y"], 1), s["x"]))

    # Group into lines
    lines = _group_spans_into_lines(ref_spans, y_tolerance=0.8)

    # Parse numbered references
    return _parse_numbered_refs_block(lines)


def _group_spans_into_lines(spans, y_tolerance=0.8):
    """Group spans into text lines by y-proximity."""
    if not spans:
        return []

    lines = []
    current_line_spans = [spans[0]]

    for span in spans[1:]:
        if abs(span["y"] - current_line_spans[-1]["y"]) <= y_tolerance:
            current_line_spans.append(span)
        else:
            lines.append(_join_line_spans(current_line_spans))
            current_line_spans = [span]

    if current_line_spans:
        lines.append(_join_line_spans(current_line_spans))

    return lines


def _join_line_spans(spans):
    """Join spans on the same line, inserting spaces between non-adjacent spans."""
    spans = sorted(spans, key=lambda s: s["x"])
    parts = []
    for i, span in enumerate(spans):
        text = span["text"]
        if i > 0 and not parts[-1].endswith(" ") and not text.startswith(" "):
            # Insert space if there's a gap between spans
            parts.append(" ")
        parts.append(text)
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def _parse_numbered_refs_inline(text):
    """Parse inline footnotes like '1. Author et al. Journal. 2. Author...'

    Slide footnotes often run together on one or two lines.
    Falls back to treating the whole text as a single unnumbered reference.
    """
    refs = {}
    # Split on numbered patterns: "1. ...", "2. ..."
    parts = re.split(r"(?:^|\s)(\d{1,2})\.\s+", text)

    # parts alternates: [prefix, num, text, num, text, ...]
    i = 1
    while i < len(parts) - 1:
        num = int(parts[i])
        ref_text = parts[i + 1].strip()
        # Truncate at disclaimer/safety boilerplate that isn't part of the citation
        ref_text = re.split(
            r"\s*Please\s+see\s", ref_text, maxsplit=1
        )[0].strip()
        # Skip false positives: ref text must start with an author name, not
        # P-values, symbols, or other non-citation content
        if 1 <= num <= 50 and ref_text and re.match(r"^[A-Za-z]", ref_text):
            refs[num] = ref_text
        i += 2

    # Fallback: if no numbered refs found, look for citation in the text
    if not refs and text.strip():
        # Try to extract just the citation portion (skip disclaimers/legends)
        # Look for author-style pattern: "Name et al." or "Name, Name..."
        citation_match = re.search(
            r"([A-Z][\w'-]+ [A-Z]{1,3}(?:\s+et\s+al)?\.?\s+.+?\.\s*\d{4}[^.]*\.)",
            text
        )
        if citation_match:
            refs[0] = citation_match.group(1).strip()
        elif _looks_like_citation(text) and len(text) < 300:
            refs[0] = text.strip()

    return refs


def _parse_numbered_refs_block(lines):
    """Parse block-style references (one per entry, may span multiple lines).

    Falls back to treating all lines as a single unnumbered reference.
    """
    refs = {}
    current_num = None
    current_text = []

    for line in lines:
        # Check if line starts with a new reference number
        match = re.match(r"^(\d{1,2})[.)]\s+(.*)", line)
        if match:
            # Save previous ref
            if current_num is not None:
                refs[current_num] = " ".join(current_text).strip()
            current_num = int(match.group(1))
            current_text = [match.group(2)]
        elif current_num is not None:
            # Continuation line
            current_text.append(line)
        else:
            # No number yet — accumulate for possible unnumbered fallback
            current_text.append(line)

    # Save last ref
    if current_num is not None:
        refs[current_num] = " ".join(current_text).strip()

    # Fallback: unnumbered reference block
    if not refs and current_text:
        full = " ".join(current_text).strip()
        if full and _looks_like_citation(full):
            refs[0] = full

    return refs


def _looks_like_citation(text):
    """Heuristic: does this text look like an academic citation?"""
    # Author et al. patterns, journal names, DOIs, years
    if re.search(r"et\s+al", text, re.IGNORECASE):
        return True
    if re.search(r"\d{4}[;:]\d+", text):  # year;volume pattern
        return True
    if re.search(r"doi:", text, re.IGNORECASE):
        return True
    if re.search(r"\b(Neurol|Lancet|Brain|JAMA|BMJ|Pharmacol|Med|Sci)\b", text):
        return True
    return False


# ---------------------------------------------------------------------------
# Phase 3c: Associate superscripts with text, resolve against pools
# ---------------------------------------------------------------------------

def associate_superscripts(spans, boundary_y):
    """Find superscript spans and associate each with its parent text.

    For each superscript, find the nearest non-superscript text to its left
    on the same visual line (within y-tolerance).

    Returns list of claim dicts: {text, superscripts, region, position}
    """
    # Separate superscripts from body text
    sup_spans = [s for s in spans if is_numeric_superscript(s)]
    body_spans = [s for s in spans
                  if not s["is_superscript"] and s["size"] >= 6.0]

    claims = []

    for sup in sup_spans:
        ref_nums = parse_superscript_numbers(sup["text"])
        if not ref_nums:
            continue

        region = "slide" if sup["y"] < boundary_y else "notes"

        # Find the nearest body text to the left on the same line
        parent_text = _find_parent_text(sup, body_spans, boundary_y, sup_spans)

        if parent_text:
            # Skip scientific notation superscripts (e.g., '10^6' in '5x10⁶/L')
            # Check if the body span immediately left of the superscript ends with '10'
            y_tol = 0.9
            left_neighbors = [bs for bs in body_spans
                              if abs(bs['y'] - sup['y']) <= y_tol
                              and bs['x'] < sup['x']
                              and bs['x'] > sup['x'] - 15]
            if left_neighbors:
                nearest_left = max(left_neighbors, key=lambda s: s['x'])
                if re.search(r'10\s*$', nearest_left['text']):
                    continue

            claims.append({
                "text": parent_text,
                "superscripts": ref_nums,
                "region": region,
                "position": {
                    "x": round(sup["x"], 1),
                    "y": round(sup["y"], 1),
                },
            })

    # Merge claims with identical text (can happen with multi-line statements)
    return _merge_claims(claims)


def _find_parent_text(sup_span, body_spans, boundary_y, all_sup_spans=None):
    """Find the parent text for a superscript span.

    Strategy: first try spans in the same PyMuPDF block (visual text box).
    Fall back to y-proximity only if same-block yields nothing.
    Then look above within the same block for multi-line statements,
    stopping at the nearest other superscript (to avoid accumulating
    text from a previous annotation in the same block).
    """
    y_tol = 0.9  # same visual line (superscripts sit slightly above baseline)
    sup_region = "slide" if sup_span["y"] < boundary_y else "notes"
    sup_block = sup_span.get("block_id")

    # Find the y of the nearest OTHER superscript above us in the same block.
    # This is the ceiling — don't grab text at or above another superscript's line.
    # Add y_tol to include the baseline offset (superscripts sit above their text).
    above_ceiling = -1.0
    if all_sup_spans and sup_block is not None:
        for other in all_sup_spans:
            if other is sup_span:
                continue
            if other.get("block_id") != sup_block:
                continue
            if other["y"] < sup_span["y"] - 0.5:  # must be meaningfully above
                above_ceiling = max(above_ceiling, other["y"] + y_tol)

    def _candidate(bs):
        """Check if a body span is a valid candidate (right region, not bullet/number)."""
        bs_region = "slide" if bs["y"] < boundary_y else "notes"
        if bs_region != sup_region:
            return False
        if re.match(r"^[•\-–—]\s*$", bs["text"].strip()):
            return False
        if re.match(r"^\d{1,2}\.\s*$", bs["text"].strip()):
            return False
        if re.match(r"^speaker\s+notes?\s*$", bs["text"].strip(), re.IGNORECASE):
            return False
        return True

    # First pass: same block as the superscript (preferred — respects visual grouping)
    same_line = []
    if sup_block is not None:
        for bs in body_spans:
            if bs.get("block_id") != sup_block:
                continue
            if not _candidate(bs):
                continue
            if abs(bs["y"] - sup_span["y"]) <= y_tol and bs["x"] < sup_span["x"] + 2:
                same_line.append(bs)

    # Fallback: any span on the same visual line (original behavior for notes region
    # or when block info is missing)
    if not same_line:
        for bs in body_spans:
            if not _candidate(bs):
                continue
            if abs(bs["y"] - sup_span["y"]) <= y_tol and bs["x"] < sup_span["x"] + 2:
                same_line.append(bs)

    if not same_line:
        return None

    same_line.sort(key=lambda s: s["x"])
    line_text = _join_line_spans(same_line)

    # Look above for continuation (multi-line statements)
    line_y = same_line[0]["y"]
    line_x_min = same_line[0]["x"]
    search_block = same_line[0].get("block_id")
    above_line = []
    for bs in body_spans:
        if not _candidate(bs):
            continue
        y_diff = line_y - bs["y"]
        if y_diff <= 0.8:
            continue  # same line or below
        # Same block: grab lines above, but stop at the previous superscript's line
        if search_block is not None and bs.get("block_id") == search_block:
            if bs["y"] > above_ceiling:  # above the ceiling (below previous superscript)
                above_line.append(bs)
            continue
        # Different/unknown block: tight proximity only (one line up, same column)
        if search_block is None and y_diff < 2.5 and abs(bs["x"] - line_x_min) < 15:
            above_line.append(bs)

    if above_line:
        # Group above spans into visual lines (by y) and join each separately,
        # then concatenate in y-order to preserve multi-line reading order.
        above_lines = _group_spans_into_lines(above_line, y_tolerance=0.8)
        above_text = " ".join(above_lines)
        # Only prepend if it doesn't start with a bullet or heading marker
        if above_text and not re.match(r"^[•\-–—o]\s", above_text):
            line_text = above_text + " " + line_text

    # Clean up
    line_text = re.sub(r"\s+", " ", line_text).strip()

    # Skip if too short
    if len(line_text) < 5:
        return None

    return line_text


def _merge_claims(claims):
    """Merge claims with identical text, combining superscript lists."""
    merged = {}
    for claim in claims:
        key = (claim["text"], claim["region"])
        if key in merged:
            existing = merged[key]
            for num in claim["superscripts"]:
                if num not in existing["superscripts"]:
                    existing["superscripts"].append(num)
        else:
            merged[key] = claim.copy()

    return list(merged.values())


# ---------------------------------------------------------------------------
# Resolve claims against reference pools
# ---------------------------------------------------------------------------

def resolve_claims(claims, slide_footnotes, notes_references):
    """Resolve each claim's superscripts against its region's reference pool."""
    slide_claims = []
    notes_claims = []
    unresolved = []

    for claim in claims:
        pool = slide_footnotes if claim["region"] == "slide" else notes_references
        refs = []
        for num in claim["superscripts"]:
            if num in pool:
                refs.append({"number": num, "text": pool[num]})
            elif len(pool) == 1 and 0 in pool:
                # Single unnumbered reference — resolve any superscript against it
                refs.append({"number": num, "text": pool[0]})
            else:
                unresolved.append({
                    "region": claim["region"],
                    "superscript": num,
                    "claim_text": claim["text"][:60],
                })

        result = {
            "text": claim["text"],
            "superscripts": sorted(claim["superscripts"]),
            "references": refs,
            "position": claim["position"],
        }

        if claim["region"] == "slide":
            slide_claims.append(result)
        else:
            notes_claims.append(result)

    return slide_claims, notes_claims, unresolved


# ---------------------------------------------------------------------------
# Main: process one page
# ---------------------------------------------------------------------------

def detect_slide_content_elements(page, spans, boundary_y, pw, ph, slide_footnotes):
    """Detect text blocks and visual areas in the slide region for global reference fragmentation.

    Returns list of {text, position, content_type} — one entry per meaningful content element.
    Used when a reference is orphan/global: creates one pin per element instead of one generic pin.
    """
    elements = []

    slide_max_y_abs = boundary_y / 100.0 * ph
    footnote_zone_y_abs = slide_max_y_abs * 0.85
    slide_area = pw * slide_max_y_abs
    if slide_area <= 0:
        return elements

    # Step A: Visual areas via page.get_drawings()
    visual_rects = []
    seen = []
    for d in page.get_drawings():
        r = d.get("rect")
        if r is None:
            continue
        rx0, ry0, rx1, ry1 = r
        if ry1 > slide_max_y_abs:
            continue
        if ry0 > footnote_zone_y_abs:
            continue
        rect_area = (rx1 - rx0) * (ry1 - ry0)
        area_ratio = rect_area / slide_area
        if not (0.02 < area_ratio < 0.70):
            continue
        is_dup = False
        for s in seen:
            if all(abs(r[i] - s[i]) < 10 for i in range(4)):
                is_dup = True
                break
        if is_dup:
            continue
        seen.append((rx0, ry0, rx1, ry1))
        visual_rects.append((rx0, ry0, rx1, ry1))

    # Remove container rects (rects that fully enclose 2+ other rects — e.g. the outer slide border)
    def _is_container(r, all_r):
        count = sum(
            1 for o in all_r
            if o is not r and r[0] <= o[0] and r[1] <= o[1] and r[2] >= o[2] and r[3] >= o[3]
        )
        return count >= 2

    visual_rects = [r for r in visual_rects if not _is_container(r, visual_rects)]

    def _label_for_rect(rect, spans):
        rx0, ry0, rx1, ry1 = rect
        best_text = "Visual area"
        best_dist = float('inf')
        for span in spans:
            if span['y_abs'] >= ry0:
                continue
            dist = ry0 - span['y_abs']
            if dist > 30:
                continue
            if not (rx0 <= span['x_abs'] <= rx1):
                continue
            t = span['text'].strip()
            if len(t) < 5 or span['is_superscript'] or span['size'] < 6.0:
                continue
            if dist < best_dist:
                best_dist = dist
                best_text = t[:80]
        return best_text

    for rx0, ry0, rx1, ry1 in visual_rects:
        cx = (rx0 + rx1) / 2.0 / pw * 100.0
        cy = (ry0 + ry1) / 2.0 / ph * 100.0
        elements.append({
            "text": _label_for_rect((rx0, ry0, rx1, ry1), spans),
            "position": {"x": cx, "y": cy},
            "content_type": "visual_area",
        })

    # Step B: Text blocks grouped by block_id
    footnote_values = set(slide_footnotes.values())
    blocks = {}
    for span in spans:
        if span["y"] >= boundary_y:
            continue
        if span["is_superscript"]:
            continue
        if span["size"] < 6.0:
            continue
        if span["y"] >= boundary_y * 0.85:
            continue
        if span["text"].strip() in footnote_values:
            continue
        bid = span["block_id"]
        if bid not in blocks:
            blocks[bid] = {"spans": [], "min_x": span["x_abs"], "max_x": span["x_abs"],
                           "min_y": span["y_abs"], "max_y": span["y_abs"]}
        blocks[bid]["spans"].append(span)
        blocks[bid]["min_x"] = min(blocks[bid]["min_x"], span["x_abs"])
        blocks[bid]["max_x"] = max(blocks[bid]["max_x"], span["x_abs"])
        blocks[bid]["min_y"] = min(blocks[bid]["min_y"], span["y_abs"])
        blocks[bid]["max_y"] = max(blocks[bid]["max_y"], span["y_abs"])

    for bid, bdata in blocks.items():
        combined = " ".join(s["text"].strip() for s in bdata["spans"])
        if len(combined) < 10:
            continue
        cx_abs = (bdata["min_x"] + bdata["max_x"]) / 2.0
        cy_abs = (bdata["min_y"] + bdata["max_y"]) / 2.0
        inside_visual = any(
            rx0 <= cx_abs <= rx1 and ry0 <= cy_abs <= ry1
            for (rx0, ry0, rx1, ry1) in visual_rects
        )
        if inside_visual:
            continue
        cx = cx_abs / pw * 100.0
        cy = cy_abs / ph * 100.0
        elements.append({
            "text": combined[:80],
            "position": {"x": cx, "y": cy},
            "content_type": "text_block",
        })

    return elements


def process_page(page, page_num, debug=False):
    """Process a single page and return structured result."""
    spans, pw, ph = extract_spans(page)

    if debug:
        print(f"\n--- Page {page_num} ({len(spans)} spans) ---", file=sys.stderr)

    # Phase 1: Region split
    boundary_y = find_notes_boundary(spans)

    if debug:
        print(f"  Notes boundary: {boundary_y:.1f}%", file=sys.stderr)

    # Phase 3a: Detect superscripts and associate with text
    claims = associate_superscripts(spans, boundary_y)

    if debug:
        for c in claims:
            print(f"  Claim [{c['region']}]: {c['text'][:60]}... refs={c['superscripts']}", file=sys.stderr)

    # Phase 3b: Parse reference pools
    slide_footnotes = find_slide_footnotes(spans, boundary_y)
    notes_references = find_notes_references(spans, boundary_y)

    if debug:
        print(f"  Slide footnotes: {list(slide_footnotes.keys())}", file=sys.stderr)
        print(f"  Notes references: {list(notes_references.keys())}", file=sys.stderr)

    # Phase 3c: Resolve
    slide_claims, notes_claims, unresolved = resolve_claims(
        claims, slide_footnotes, notes_references
    )

    # Phase 4: Orphan references → global annotations
    # References that exist in a pool but no superscript claimed them
    used_slide_refs = set()
    for c in slide_claims:
        for r in c["references"]:
            used_slide_refs.add(r["number"])

    used_notes_refs = set()
    for c in notes_claims:
        for r in c["references"]:
            used_notes_refs.add(r["number"])

    global_annotations = []
    orphan_slide = {k: v for k, v in slide_footnotes.items() if k not in used_slide_refs}
    orphan_notes = {k: v for k, v in notes_references.items() if k not in used_notes_refs}

    if orphan_slide:
        slide_elements = detect_slide_content_elements(
            page, spans, boundary_y, pw, ph, slide_footnotes
        )
        refs_payload = [{"number": k, "text": v} for k, v in sorted(orphan_slide.items())]
        sups_payload = sorted(orphan_slide.keys())
        if slide_elements:
            for elem in slide_elements:
                global_annotations.append({
                    "text": elem["text"],
                    "superscripts": sups_payload,
                    "references": refs_payload,
                    "position": elem["position"],
                    "global": True,
                    "global_reason": "orphan-slide-reference",
                    "content_type": elem["content_type"],
                })
        else:
            global_annotations.append({
                "text": "Global slide annotation",
                "superscripts": sups_payload,
                "references": refs_payload,
                "position": {"x": 14.0, "y": 15.0},
                "global": True,
                "global_reason": "orphan-slide-reference",
            })

    if orphan_notes:
        global_annotations.append({
            "text": "Global notes annotation",
            "superscripts": sorted(orphan_notes.keys()),
            "references": [{"number": k, "text": v} for k, v in sorted(orphan_notes.items())],
            "position": {"x": 14.0, "y": boundary_y + 1},  # tucked next to "Speaker notes" title
            "global": True,
            "global_reason": "orphan-notes-reference",
        })

    if debug and global_annotations:
        for g in global_annotations:
            print(f"  Global [{g['global_reason']}]: refs={g['superscripts']}", file=sys.stderr)

    return {
        "page": page_num,
        "slide_claims": slide_claims,
        "notes_claims": notes_claims,
        "global_annotations": global_annotations,
        "slide_footnotes": {str(k): v for k, v in slide_footnotes.items()},
        "notes_references": {str(k): v for k, v in notes_references.items()},
        "unresolved_superscripts": unresolved,
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="PyMuPDF POC: Parse Notes-view PDF annotations"
    )
    parser.add_argument("pdf_path", help="Path to the Notes-view PDF")
    parser.add_argument("--pretty", action="store_true",
                        help="Pretty-print JSON output")
    parser.add_argument("--debug", action="store_true",
                        help="Print debug info to stderr")
    parser.add_argument("--page", type=int, default=None,
                        help="Process only this page number (1-based)")
    args = parser.parse_args()

    doc = pymupdf.open(args.pdf_path)

    pages = []
    for i in range(len(doc)):
        page_num = i + 1
        if args.page and page_num != args.page:
            continue
        result = process_page(doc[i], page_num, debug=args.debug)
        pages.append(result)

    output = {
        "file": args.pdf_path.split("/")[-1],
        "total_pages": len(doc),
        "pages": pages,
    }

    indent = 2 if args.pretty else None
    print(json.dumps(output, indent=indent, ensure_ascii=False))


if __name__ == "__main__":
    main()
