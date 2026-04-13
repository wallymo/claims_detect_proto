#!/usr/bin/env python3

import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import pymupdf_poc


class LlamaParseGlobalAnnotationTests(unittest.TestCase):
    def test_detect_llamaparse_slide_elements_matches_slide_lines(self):
        spans = [
            {
                "text": "Primary endpoint improved by 30% versus control",
                "x": 20.0,
                "y": 18.0,
                "x_abs": 120.0,
                "y_abs": 180.0,
                "size": 16.0,
                "is_superscript": False,
                "block_id": 1,
            },
            {
                "text": "Median PFS was 23.7 months vs 16.6 months",
                "x": 20.0,
                "y": 24.0,
                "x_abs": 120.0,
                "y_abs": 240.0,
                "size": 16.0,
                "is_superscript": False,
                "block_id": 2,
            },
            {
                "text": "Cho BC et al. N Engl J Med. 2024.",
                "x": 10.0,
                "y": 49.0,
                "x_abs": 60.0,
                "y_abs": 490.0,
                "size": 5.0,
                "is_superscript": False,
                "block_id": 9,
            },
        ]
        llama_page = {
            "markdown": """
- Primary endpoint improved by 30% versus control
- Median PFS was 23.7 months vs 16.6 months
References
1. Cho BC et al. N Engl J Med. 2024.
""",
        }

        elements = pymupdf_poc.detect_llamaparse_slide_elements(
            llama_page,
            spans,
            boundary_y=55.0,
            slide_footnotes={1: "Cho BC et al. N Engl J Med. 2024."},
        )

        self.assertEqual(len(elements), 2)
        self.assertEqual(elements[0]["breakdown_provider"], "llamaparse")
        self.assertIn("Primary endpoint improved", elements[0]["text"])
        self.assertIn("Median PFS", elements[1]["text"])

    def test_detect_llamaparse_slide_elements_ignores_reference_like_lines(self):
        spans = [
            {
                "text": "Safety profile was consistent with prior studies",
                "x": 18.0,
                "y": 20.0,
                "x_abs": 100.0,
                "y_abs": 200.0,
                "size": 15.0,
                "is_superscript": False,
                "block_id": 1,
            },
        ]
        llama_page = {
            "text": """
Safety profile was consistent with prior studies
1. Author A et al. Journal. 2024.
""",
        }

        elements = pymupdf_poc.detect_llamaparse_slide_elements(
            llama_page,
            spans,
            boundary_y=55.0,
            slide_footnotes={1: "Author A et al. Journal. 2024."},
        )

        self.assertEqual(len(elements), 1)
        self.assertEqual(elements[0]["text"], "Safety profile was consistent with prior studies")


if __name__ == "__main__":
    unittest.main()
