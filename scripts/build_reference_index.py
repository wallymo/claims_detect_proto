#!/usr/bin/env python3
"""
Build a structured JSON index from PDF filenames in a references directory.

Parses author, year, journal tokens, and document type from filename conventions
commonly used in pharma/medical reference libraries.

Usage:
    python scripts/build_reference_index.py
    python scripts/build_reference_index.py --pretty
    python scripts/build_reference_index.py --dir References/References/
    python scripts/build_reference_index.py --output scripts/reference_index.json
"""

import argparse
import json
import re
import sys
from pathlib import Path

# Tokens to strip from journal_tokens
STOPWORDS = {"et", "al", "the", "and", "of", "in", "a", "an", "for", "on", "with", "to"}

# Dutch/multi-word surname prefixes
SURNAME_PREFIXES = {"van", "de", "den", "von", "del", "la", "le", "di"}

# Patterns that indicate prescribing information (matched as whole words)
PI_WORD_MARKERS = {"pi", "uspi", "ifu", "ppi"}
PI_PHRASE_MARKERS = {"prescribing information"}

# ---------------------------------------------------------------------------
# Filename parser
# ---------------------------------------------------------------------------

def classify_type(filename_lower):
    """Classify the document type based on filename contents."""
    # Check phrase markers first (substring match is fine for multi-word phrases)
    if any(m in filename_lower for m in PI_PHRASE_MARKERS):
        return "prescribing_info"
    # Check word markers with word boundaries to avoid false positives
    # (e.g., "pi" inside "Epidemiol" or "Neurohospitalist")
    for marker in PI_WORD_MARKERS:
        if re.search(r'(?<![a-zA-Z])' + re.escape(marker) + r'(?![a-zA-Z])', filename_lower):
            return "prescribing_info"
    if "nccn" in filename_lower:
        return "guideline"
    if re.search(r'(?<![a-zA-Z])dof(?![a-zA-Z])', filename_lower) or "data on file" in filename_lower:
        return "data_on_file"
    if "found" in filename_lower:
        return "organization"
    return "paper"


def extract_year(text):
    """Extract a 4-digit year (1900-2099) from text. Returns the last match."""
    # Use lookaround instead of \b so underscores/punctuation don't block matching
    matches = re.findall(r'(?<!\d)((?:19|20)\d{2})(?!\d)', text)
    return matches[-1] if matches else None


def tokenize_filename(stem):
    """
    Split filename stem into tokens by underscores and spaces.
    Hyphens within words are preserved (e.g., "Hafer-Macko" stays as one token)
    but standalone hyphens or leading/trailing hyphens are stripped.
    """
    # Replace underscores with spaces, then split on spaces
    normalized = stem.replace("_", " ")
    # Split on whitespace
    tokens = normalized.split()
    # Strip leading/trailing hyphens from each token
    return [t.strip("-") for t in tokens if t.strip("-")]


def extract_first_author(tokens):
    """
    Extract the first author surname from the beginning of the token list.
    Handles multi-word surnames like "van den Berg", "van Doorn".
    Handles hyphenated surnames like "González-Suárez", "Hafer-Macko".
    Returns (author_string_lowered, number_of_tokens_consumed).
    """
    if not tokens:
        return None, 0

    first_lower = tokens[0].lower().rstrip(",.")

    # Check for Dutch/multi-word surname prefixes
    if first_lower in SURNAME_PREFIXES and len(tokens) > 1:
        # Accumulate prefix words until we hit a non-prefix
        consumed = [first_lower]
        idx = 1
        while idx < len(tokens):
            next_lower = tokens[idx].lower().rstrip(",.")
            if next_lower in SURNAME_PREFIXES:
                consumed.append(next_lower)
                idx += 1
            else:
                # This is the actual surname
                consumed.append(next_lower)
                idx += 1
                break
        return " ".join(consumed), idx

    # Single token surname (may be hyphenated like "González-Suárez")
    author = first_lower
    return author, 1


def parse_filename(filename):
    """
    Parse a PDF filename into structured metadata.
    Returns a dict with filename, first_author, year, journal_tokens, type.
    """
    stem = Path(filename).stem  # filename without extension
    doc_type = classify_type(filename.lower())
    year = extract_year(stem)

    tokens = tokenize_filename(stem)
    first_author, consumed = extract_first_author(tokens)

    # Remaining tokens (after author) become candidates for journal_tokens
    remaining = tokens[consumed:]

    # Build journal tokens: lowercase, filter stopwords, year, and short noise
    journal_tokens = []
    for t in remaining:
        # Split on hyphens for remaining tokens (not author) so "PI-PPI-IFU" → ["PI", "PPI", "IFU"]
        # Also split on periods and commas for tokens like "1.2019" or "CH."
        subtokens = re.split(r'[-.,;()\[\]]+', t)
        for sub in subtokens:
            cleaned = re.sub(r'[^a-zA-Z0-9]', '', sub).lower()
            if not cleaned:
                continue
            if cleaned in STOPWORDS:
                continue
            # Skip if it's the year we already extracted
            if year and cleaned == year:
                continue
            # Skip single characters (initials like "NL", "BC" are 2 chars, keep them)
            if len(cleaned) <= 1:
                continue
            # Skip pure-numeric tokens longer than 4 digits (dates like "20251014")
            if cleaned.isdigit() and len(cleaned) > 4:
                continue
            # Skip version markers like "v2", "vC", "v20"
            if re.match(r'^v\d', cleaned):
                continue
            journal_tokens.append(cleaned)

    return {
        "filename": filename,
        "first_author": first_author,
        "year": year,
        "journal_tokens": journal_tokens,
        "type": doc_type,
    }


# ---------------------------------------------------------------------------
# Directory scanning
# ---------------------------------------------------------------------------

def scan_directory(dir_path):
    """Scan directory for PDF files and parse each filename."""
    results = []
    pdf_dir = Path(dir_path)

    if not pdf_dir.is_dir():
        print(f"Error: directory not found: {pdf_dir}", file=sys.stderr)
        sys.exit(1)

    for f in sorted(pdf_dir.iterdir()):
        # Skip non-PDF files
        if f.suffix.lower() != ".pdf":
            continue
        entry = parse_filename(f.name)
        results.append(entry)

    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    # Default directory: References/References/ relative to project root
    # Project root = parent of scripts/ directory
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    default_dir = project_root / "References" / "References"

    parser = argparse.ArgumentParser(
        description="Parse PDF filenames into structured reference metadata."
    )
    parser.add_argument(
        "--dir",
        type=str,
        default=str(default_dir),
        help=f"Directory containing reference PDFs (default: {default_dir})",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty-print JSON output with indentation",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Write JSON to file instead of stdout",
    )

    args = parser.parse_args()
    results = scan_directory(args.dir)

    indent = 2 if args.pretty else None
    json_str = json.dumps(results, indent=indent, ensure_ascii=False)

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json_str + "\n", encoding="utf-8")
        print(f"Wrote {len(results)} entries to {out_path}", file=sys.stderr)
    else:
        print(json_str)


if __name__ == "__main__":
    main()
