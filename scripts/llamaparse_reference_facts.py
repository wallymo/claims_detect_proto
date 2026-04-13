#!/usr/bin/env python3
"""
Parse a reference document with LlamaParse and return per-page text/markdown.

Usage:
    scripts/.venv/bin/python3 scripts/llamaparse_reference_facts.py <document_path>
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from llama_cloud import LlamaCloud


def _read_field(value, field_name, default=None):
    if value is None:
        return default
    if isinstance(value, dict):
        return value.get(field_name, default)
    return getattr(value, field_name, default)


def _pages_by_number(payload, text_field):
    pages = _read_field(payload, "pages", []) or []
    mapped = {}
    for page in pages:
        page_number = _read_field(page, "page_number")
        if page_number is None:
            continue
        mapped[int(page_number)] = _read_field(page, text_field, "") or ""
    return mapped


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Parse a reference file with LlamaParse and emit per-page text/markdown JSON."
    )
    parser.add_argument("document_path", help="Path to the reference document")
    parser.add_argument("--tier", default=os.environ.get("LLAMA_PARSE_TIER", "agentic"))
    parser.add_argument("--version", default=os.environ.get("LLAMA_PARSE_VERSION", "latest"))
    args = parser.parse_args()

    api_key = os.environ.get("LLAMA_CLOUD_API_KEY")
    if not api_key:
        print("LLAMA_CLOUD_API_KEY not set", file=sys.stderr)
        return 1

    client = LlamaCloud(api_key=api_key, timeout=180.0)
    result = client.parsing.parse(
        upload_file=args.document_path,
        tier=args.tier,
        version=args.version,
        output_options={
            "spatial_text": {
                "preserve_very_small_text": True,
            }
        },
        expand=["text", "markdown"],
    )

    text_pages = _pages_by_number(_read_field(result, "text"), "text")
    markdown_pages = _pages_by_number(_read_field(result, "markdown"), "markdown")
    page_numbers = sorted(set(text_pages.keys()) | set(markdown_pages.keys()))

    payload = {
        "job_id": _read_field(_read_field(result, "job"), "id"),
        "page_count": len(page_numbers),
        "pages": [
            {
                "page": page_number,
                "text": text_pages.get(page_number, ""),
                "markdown": markdown_pages.get(page_number, ""),
            }
            for page_number in page_numbers
        ],
    }

    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
