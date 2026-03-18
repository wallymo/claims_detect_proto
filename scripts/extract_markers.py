#!/usr/bin/env python3
"""
Extract PDF highlight annotations as structured JSON marker objects.

Uses PyMuPDF to find highlight annotations (type 8), extract the text
underneath each highlight rect, and output a flat list of marker objects
suitable for frontend overlay rendering.

Usage:
    python scripts/extract_markers.py <pdf_path>
    python scripts/extract_markers.py <pdf_path> --pretty
    python scripts/extract_markers.py <pdf_path> --source-id "ref-123"
"""

import argparse
import json
import os
import sys

import pymupdf


def extract_highlight_markers(pdf_path, source_id=None):
    """Extract highlight annotation markers from a PDF.

    Args:
        pdf_path: Path to the PDF file.
        source_id: Optional identifier for the source PDF. Defaults to filename.

    Returns:
        dict with "markers" list.
    """
    doc = pymupdf.open(pdf_path)
    source = source_id or os.path.basename(pdf_path)

    all_markers = []

    for page_idx in range(len(doc)):
        page = doc[page_idx]
        page_number = page_idx + 1
        page_height = page.rect.height

        annots = page.annots()
        if annots is None:
            continue

        for annot in annots:
            # Filter for highlight annotations only (type 8)
            if annot.type[0] != 8:
                continue

            # Extract highlight rects from quads
            rects = []
            vertices = annot.vertices
            if vertices and len(vertices) >= 4:
                # Chunk vertices into groups of 4 points
                for i in range(0, len(vertices) - 3, 4):
                    pts = vertices[i : i + 4]
                    quad = pymupdf.Quad(pts)
                    r = quad.rect
                    rects.append(
                        {"x0": round(r.x0, 2), "y0": round(r.y0, 2),
                         "x1": round(r.x1, 2), "y1": round(r.y1, 2)}
                    )
            else:
                # Fallback to annot.rect
                r = annot.rect
                rects.append(
                    {"x0": round(r.x0, 2), "y0": round(r.y0, 2),
                     "x1": round(r.x1, 2), "y1": round(r.y1, 2)}
                )

            # Extract text under each highlight rect
            text_chunks = []
            for rd in rects:
                rect = pymupdf.Rect(rd["x0"], rd["y0"], rd["x1"], rd["y1"])
                txt = page.get_textbox(rect).strip()
                if txt:
                    text_chunks.append(txt)
            text = " ".join(text_chunks)

            # Get annotation color
            colors = annot.colors
            color = colors.get("stroke") or colors.get("fill")
            if color:
                color = [round(c, 4) for c in color]
            else:
                color = None

            # Topmost rect y0 for sorting (smallest y0 = highest on page)
            top_y0 = min(rd["y0"] for rd in rects) if rects else 0.0

            all_markers.append({
                "page_number": page_number,
                "page_height": round(page_height, 2),
                "source": source,
                "text": text,
                "color": color,
                "rects": rects,
                "_sort_y": top_y0,
            })

    doc.close()

    # Sort by page_number ascending, then top y0 ascending (top-to-bottom)
    all_markers.sort(key=lambda m: (m["page_number"], m["_sort_y"]))

    # Assign per-page index and build final marker objects
    markers = []
    page_counters = {}
    for m in all_markers:
        pn = m["page_number"]
        page_counters[pn] = page_counters.get(pn, 0) + 1
        idx = page_counters[pn]

        markers.append({
            "marker_id": f"m-{pn}-{idx}",
            "source_pdf_id": m["source"],
            "page_number": pn,
            "page_height": m["page_height"],
            "index": idx,
            "label": str(idx),
            "origin": "annotation",
            "text": m["text"],
            "confidence": None,
            "color": m["color"],
            "rects": m["rects"],
        })

    return {"markers": markers}


def main():
    parser = argparse.ArgumentParser(
        description="Extract PDF highlight annotations as structured JSON markers."
    )
    parser.add_argument("pdf_path", help="Path to the PDF file")
    parser.add_argument(
        "--pretty", action="store_true", help="Pretty-print JSON output"
    )
    parser.add_argument(
        "--source-id",
        default=None,
        help="Override source PDF identifier (default: filename)",
    )
    args = parser.parse_args()

    if not os.path.isfile(args.pdf_path):
        print(f"Error: file not found: {args.pdf_path}", file=sys.stderr)
        sys.exit(1)

    result = extract_highlight_markers(args.pdf_path, source_id=args.source_id)

    indent = 2 if args.pretty else None
    json.dump(result, sys.stdout, indent=indent)
    if args.pretty:
        print()  # trailing newline for pretty output


if __name__ == "__main__":
    main()
