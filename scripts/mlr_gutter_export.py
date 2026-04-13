#!/usr/bin/env python3
"""
Create an MLR-style derivative PDF with gutter annotation boxes.

Usage:
    scripts/.venv/bin/python3 scripts/mlr_gutter_export.py input.pdf payload.json output.pdf
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pymupdf


GUTTER_WIDTH = 108.0
GUTTER_INSET = 8.0
TOP_BOTTOM_PADDING = 18.0
BOX_PADDING_X = 6.0
BOX_PADDING_Y = 5.0
BOX_GAP = 6.0
BOX_BORDER_WIDTH = 0.8
FONT_NAME = "helv"
FONT_SIZE = 7.5
LINE_HEIGHT = 9.2
TEXT_COLOR = (0.72, 0.18, 0.12)
STROKE_COLOR = (0.75, 0.45, 0.42)
FILL_COLOR = (1.0, 1.0, 1.0)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def normalize_text(value) -> str:
    return " ".join(str(value or "").split())


def measure_text_width(text: str) -> float:
    return pymupdf.get_text_length(text, fontname=FONT_NAME, fontsize=FONT_SIZE)


def split_long_token(token: str, max_width: float) -> list[str]:
    if not token:
        return [""]
    if measure_text_width(token) <= max_width:
        return [token]

    pieces: list[str] = []
    current = ""
    for char in token:
        candidate = f"{current}{char}"
        if current and measure_text_width(candidate) > max_width:
            pieces.append(current)
            current = char
        else:
            current = candidate
    if current:
        pieces.append(current)
    return pieces or [token]


def wrap_line(text: str, max_width: float) -> list[str]:
    normalized = normalize_text(text)
    if not normalized:
        return [""]

    words = normalized.split(" ")
    wrapped: list[str] = []
    current = ""

    for word in words:
        parts = split_long_token(word, max_width)
        for part in parts:
            if not current:
                current = part
                continue

            candidate = f"{current} {part}"
            if measure_text_width(candidate) <= max_width:
                current = candidate
            else:
                wrapped.append(current)
                current = part

    if current:
        wrapped.append(current)

    return wrapped or [normalized]


def build_box_content(lines: list[str], max_width: float) -> list[str]:
    wrapped: list[str] = []
    for line in lines:
        wrapped.extend(wrap_line(line, max_width))
    return wrapped or [""]


def pack_boxes(boxes: list[dict], page_height: float) -> list[dict]:
    if not boxes:
        return []

    total_box_height = sum(box["box_height"] for box in boxes)
    available_height = max(1.0, page_height - (TOP_BOTTOM_PADDING * 2))
    if len(boxes) > 1 and total_box_height < available_height:
        gap = min(BOX_GAP, max(2.0, (available_height - total_box_height) / (len(boxes) - 1)))
    else:
        gap = 2.0

    packed = []
    cursor = TOP_BOTTOM_PADDING

    for box in sorted(boxes, key=lambda item: (item["target_y"], item["claim_id"])):
        box_height = box["box_height"]
        preferred_top = clamp(
            box["target_y"] - (box_height / 2.0),
            TOP_BOTTOM_PADDING,
            max(TOP_BOTTOM_PADDING, page_height - TOP_BOTTOM_PADDING - box_height),
        )
        top = max(cursor, preferred_top)
        packed.append({**box, "top": top})
        cursor = top + box_height + gap

    if packed:
        packed[-1]["top"] = min(
            packed[-1]["top"],
            max(TOP_BOTTOM_PADDING, page_height - TOP_BOTTOM_PADDING - packed[-1]["box_height"]),
        )

    for index in range(len(packed) - 2, -1, -1):
        next_box = packed[index + 1]
        current = packed[index]
        max_top = next_box["top"] - gap - current["box_height"]
        current["top"] = min(current["top"], max_top)

    if packed:
        min_top = min(box["top"] for box in packed)
        if min_top < TOP_BOTTOM_PADDING:
            shift = TOP_BOTTOM_PADDING - min_top
            for box in packed:
                box["top"] += shift

    return packed


def draw_box(page, rect: pymupdf.Rect, lines: list[str]) -> None:
    page.draw_rect(
        rect,
        color=STROKE_COLOR,
        fill=FILL_COLOR,
        width=BOX_BORDER_WIDTH,
        overlay=True,
    )
    text_x = rect.x0 + BOX_PADDING_X
    text_y = rect.y0 + BOX_PADDING_Y + FONT_SIZE
    for line in lines:
        page.insert_text(
            pymupdf.Point(text_x, text_y),
            line,
            fontname=FONT_NAME,
            fontsize=FONT_SIZE,
            color=TEXT_COLOR,
            overlay=True,
        )
        text_y += LINE_HEIGHT


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate an MLR-style gutter annotation PDF.")
    parser.add_argument("input_pdf", help="Path to the source PDF")
    parser.add_argument("payload_json", help="Path to JSON payload with approved annotations")
    parser.add_argument("output_pdf", help="Path to write the derivative PDF")
    args = parser.parse_args()

    input_path = Path(args.input_pdf)
    payload_path = Path(args.payload_json)
    output_path = Path(args.output_pdf)

    with payload_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    annotations_by_page: dict[int, list[dict]] = {}
    for annotation in payload.get("annotations", []):
        page_number = max(1, int(annotation.get("page", 1)))
        annotations_by_page.setdefault(page_number, []).append(annotation)

    src_doc = pymupdf.open(str(input_path))
    out_doc = pymupdf.open()

    for page_index in range(len(src_doc)):
        src_page = src_doc[page_index]
        src_rect = src_page.rect
        page_number = page_index + 1
        new_width = src_rect.width + (GUTTER_WIDTH * 2.0)
        new_page = out_doc.new_page(width=new_width, height=src_rect.height)

        source_rect = pymupdf.Rect(
            GUTTER_WIDTH,
            0,
            GUTTER_WIDTH + src_rect.width,
            src_rect.height,
        )
        new_page.show_pdf_page(source_rect, src_doc, page_index)

        content_width = GUTTER_WIDTH - (GUTTER_INSET * 2.0)
        page_annotations = annotations_by_page.get(page_number, [])
        prepared = []
        for annotation in page_annotations:
            notation_lines = [
                normalize_text(line)
                for line in annotation.get("notation_lines", [])
                if normalize_text(line)
            ]
            if not notation_lines:
                continue

            wrapped_lines = build_box_content(notation_lines, content_width - (BOX_PADDING_X * 2.0))
            box_height = (BOX_PADDING_Y * 2.0) + (len(wrapped_lines) * LINE_HEIGHT)
            prepared.append({
                "claim_id": annotation.get("claim_id", ""),
                "side": annotation.get("target_side", "right"),
                "target_y": (float(annotation.get("target_y_pct", 50.0)) / 100.0) * src_rect.height,
                "box_height": box_height,
                "wrapped_lines": wrapped_lines,
            })

        left_boxes = pack_boxes(
            [box for box in prepared if box["side"] == "left"],
            src_rect.height,
        )
        right_boxes = pack_boxes(
            [box for box in prepared if box["side"] != "left"],
            src_rect.height,
        )

        for box in left_boxes:
            rect = pymupdf.Rect(
                GUTTER_INSET,
                box["top"],
                GUTTER_INSET + content_width,
                box["top"] + box["box_height"],
            )
            draw_box(new_page, rect, box["wrapped_lines"])

        right_start_x = GUTTER_WIDTH + src_rect.width + GUTTER_INSET
        for box in right_boxes:
            rect = pymupdf.Rect(
                right_start_x,
                box["top"],
                right_start_x + content_width,
                box["top"] + box["box_height"],
            )
            draw_box(new_page, rect, box["wrapped_lines"])

    out_doc.save(str(output_path), garbage=4, deflate=True)
    out_doc.close()
    src_doc.close()


if __name__ == "__main__":
    main()
