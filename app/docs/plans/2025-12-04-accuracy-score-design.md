# Accuracy Score & Feedback System Design

**Date:** 2025-12-04
**Status:** Approved

---

## Overview

Design for measuring AI claim detection accuracy and creating a human-AI collaboration feedback loop.

---

## Models for POC Testing

| Model | Input Cost | Output Cost | Notes |
|-------|------------|-------------|-------|
| Gemini 3 Pro | $2.00/1M | $12.00/1M | Cheapest, best multimodal |
| GPT-4o | $2.50/1M | $10.00/1M | Best output price, proven |
| Claude Opus 4.5 | $5.00/1M | $25.00/1M | Highest accuracy, low hallucination |

---

## Accuracy Score Definition

**What we measure:** Did the AI find the same claims the humans marked, AND classify them correctly?

**Two metrics (simplified from F1):**
- **Found:** X of Y claims detected (recall)
- **Correct:** X of Y detected were valid (precision)

**Display granularity:**
- Testing phase: Per-document AND per-model aggregate
- Production: Per-document focus

---

## Two Modes of Operation

| Mode | Description | Value |
|------|-------------|-------|
| Validation | AI checks against human-annotated claims | Confirms accuracy |
| Discovery | AI finds claims humans may have missed | Augments human review |

---

## UI Design

### Claims Panel Header
```
┌─────────────────────────────────────────────────────────┐
│ Detected Claims (15)                        78% [badge]│
└─────────────────────────────────────────────────────────┘
```

**Accuracy badge colors:**
- Green (>=80%): Exceeds target
- Yellow (70-79%): Meets target
- Red (<70%): Below target

**Badge click → drill-down popover:**
- Found: X of Y claims
- Correct: X of Y found were valid

### Claims List Sections
```
✓ MATCHED (12)      ← Confirmed against human annotations
⚡ AI SUGGESTED (3)  ← Potential claims humans missed [NEW] tag
```

---

## Feedback System

### Thumbs Up Actions
| Context | Result |
|---------|--------|
| On Matched claim | Confirms AI was correct |
| On AI Suggested | Adds claim to ground truth (human missed it) |

### Thumbs Down Flow
Opens feedback modal with:

1. **Quick Reasons (multi-select chips):**
   - Not a claim
   - Wrong category
   - Already approved
   - Out of context
   - Needs more context

2. **Text Guidance (optional):**
   Free-form field for user to explain what AI should look for instead

### Feedback Data Captured
```json
{
  "claim_text": "string",
  "ai_category": "string",
  "ai_confidence": 0.0-1.0,
  "rejection_reasons": ["array"],
  "user_guidance": "string (optional)",
  "document_id": "string",
  "model": "string",
  "timestamp": "ISO date"
}
```

---

## System Prompt Architecture

```
┌─────────────────────────────────────────────────────────┐
│ 1. Brand Guidelines (per brand selection)              │
│    - Approved claims language                          │
│    - Prohibited phrases                                │
│    - Claim categories for this product                 │
├─────────────────────────────────────────────────────────┤
│ 2. Claim Detection Instructions                        │
│    - Definition of what constitutes a claim            │
│    - How to categorize (efficacy, safety, etc.)        │
│    - Confidence scoring guidance                       │
├─────────────────────────────────────────────────────────┤
│ 3. Few-Shot Examples (from annotated docs)             │
│    - 3-5 examples of claims with explanations          │
│    - 2-3 examples of non-claims                        │
└─────────────────────────────────────────────────────────┘
```

**Required inputs:**
- Brand guidelines documents (available)
- Human-annotated example documents (available)

---

## Ground Truth Sources

1. **Pre-loaded benchmark docs:** Known claims for accuracy testing
2. **Thumbs up/down feedback:** Builds ground truth over time

---

## Success Metrics

- Target accuracy: 70-80%
- Track per-model to identify best performer
- Monitor rejection reasons to improve prompts

---

## Export PDF Report

One-page exportable report for stakeholder review.

**Mock file:** `src/components/claims-detector/ExportReportMock.html`

### Header Section
- Report title: "Claims Detection Report"
- Company logo placeholder
- Document info bar: filename, brand guidelines, model used, date

### Score Cards (3 cards)
| Card | Content | Style |
|------|---------|-------|
| Overall Accuracy | 82% | Green highlight, primary |
| Claims Found | 14 of 17 | Neutral, shows AI vs human match |
| Bonus Finds | +2 | Orange/amber, AI suggested extras |

### Claims Tables
1. **Matched Claims** - Claims AI found that match human annotations
   - Columns: Claim Text, Type, Confidence, Status

2. **AI Suggested** - Potential missed claims for human review
   - Same columns, orange "Review" status badge

### Analysis Summary
Simple 4-stat grid: Total Detected, Matched, AI Suggested, Rejected

### Footer
Version, page number, confidentiality notice

---

## Next Steps

1. Implement accuracy badge in Claims Panel header
2. Add drill-down popover for claims breakdown
3. Create feedback modal for thumbs down
4. Add "AI Suggested" section with [NEW] tags
5. Build data capture for feedback storage
6. Implement PDF export functionality
