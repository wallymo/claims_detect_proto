#!/usr/bin/env python3
"""
Render a single PDF page to PNG via PyMuPDF.
Outputs base64-encoded PNG to stdout (for piping to Express controller).

Usage:
    scripts/.venv/bin/python3 scripts/render_page.py <pdf_path> --page 3
    scripts/.venv/bin/python3 scripts/render_page.py <pdf_path> --page 3 --output /tmp/page.png
"""

import argparse
import base64
import sys

import pymupdf


def main():
    parser = argparse.ArgumentParser(description="Render a PDF page to PNG")
    parser.add_argument("pdf_path", help="Path to the PDF")
    parser.add_argument("--page", type=int, required=True, help="Page number (1-based)")
    parser.add_argument("--dpi", type=int, default=150, help="Render DPI (default 150)")
    parser.add_argument("--output", help="Output file path (omit for base64 stdout)")

    args = parser.parse_args()
    doc = pymupdf.open(args.pdf_path)

    if args.page < 1 or args.page > len(doc):
        print(f"Error: page {args.page} out of range (1-{len(doc)})", file=sys.stderr)
        sys.exit(1)

    page = doc[args.page - 1]
    pix = page.get_pixmap(dpi=args.dpi)

    if args.output:
        pix.save(args.output)
    else:
        import json
        png_bytes = pix.tobytes("png")
        result = {
            "image": base64.b64encode(png_bytes).decode("ascii"),
            "width": round(page.rect.width, 1),
            "height": round(page.rect.height, 1),
        }
        json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
