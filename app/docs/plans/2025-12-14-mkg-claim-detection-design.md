# MKG Claims Detector - Pure Claim Detection Design

## Overview

Simplify the MKG Claims Detector to focus solely on AI-powered promotional claim detection for pharmaceutical materials. Remove reference matching functionality and streamline the UI for human review of detected claims.

## Architecture

### Three-Panel Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  MKG Claims Detector                                    [POC]   │
│  AI-powered promotional claim detection for pharma materials    │
├────────────┬─────────────────────────────┬──────────────────────┤
│  CONFIG    │     DOCUMENT VIEWER         │    CLAIMS PANEL      │
│            │                             │                      │
│ • Upload   │   (Preview as images)       │  [Status toggles]    │
│ • Model    │   (Scanner animation)       │  [Search] [Sort]     │
│ • Analyze  │                             │                      │
│ • Results  │                             │  Claim cards with    │
│            │                             │  confidence bars     │
└────────────┴─────────────────────────────┴──────────────────────┘
```

---

## Left Config Panel

### Document Section
- Upload dropzone accepting **PDF, DOCX, PPT, PPTX**
- Shows filename after upload with remove button

### Settings Section
- AI Model dropdown (Google Gemini 3 Pro, Claude Sonnet 4.5)
- Both options shown for demo flexibility (only Gemini implemented initially)

### Analyze Button
- Primary action button
- Disabled until document uploaded
- Shows spinner + "Analyzing..." during processing

### Results Summary (after analysis)

```
Total Claims Found          12
─────────────────────────────
High Confidence (90-100%)    4
Medium Confidence (70-89%)   5
Low Confidence (<70%)        3
─────────────────────────────
⚡ 3.2s  •  Gemini 3 Pro
```

Confidence tiers:
- **High (90-100%):** Direct/obvious claims
- **Medium (70-89%):** Strong implications
- **Low (<70%):** Vague or suggestive

---

## Center Document Viewer

### States

**Empty:** Placeholder prompting upload

**After Upload:** Document rendered as images (consistent across all formats)

**During Analysis:**
- Scanner overlay animation
- Progress percentage reflects **real** backend progress:
  - 0-30%: Extracting text
  - 30-60%: Running OCR on images
  - 60-95%: Detecting claims
  - 100%: Complete

### Document Rendering
- All file types (PDF, DOCX, PPT, PPTX) converted to page images server-side
- Consistent preview without format-specific viewers
- Page navigation for multi-page documents
- **No claim highlighting** - pure document preview

---

## Right Claims Panel

### Filter Bar

```
┌──────────────────────────────────────────────┐
│ [Pending (8)] [Approved (3)] [Rejected (1)]  │
│                                              │
│ [Search claims...]              [Conf ↓]     │
└──────────────────────────────────────────────┘
```

- **Status toggles:** Buttons with counts, click to filter
- **Search:** Filter claims by text content
- **Sort toggle:** Confidence high-to-low or low-to-high

### Claim Card

```
┌─────────────────────────────────────────┐
│ "Clinically proven to reduce symptoms  │
│  by 47% in just 2 weeks"               │
│                                        │
│ ████████████░░░░  92%                  │
│                                        │
│              [✓ Approve] [✗ Reject]    │
└─────────────────────────────────────────┘
```

- Claim text (exact quote from document)
- Confidence bar + percentage (color-coded by tier)
- Approve / Reject buttons
- **No category badge**
- **No source label**

### Empty States
- Before analysis: "Upload a document and click Analyze to detect claims"
- During analysis: Spinner + "Detecting claims..."
- No results: "No claims detected"

---

## Backend Architecture

### Document Ingestion
- Accept PDF, DOCX, PPT, PPTX uploads
- Store temporarily for processing
- Convert all formats to page images for frontend preview

### Multimodal Extraction (parallel pipelines)

**Text Extraction:**
- PDF: PyMuPDF, PDFMiner, or Apache Tika
- PPTX/DOCX: python-pptx, python-docx, or LibreOffice CLI
- Extract from: paragraphs, text boxes, speaker notes, headers/footers

**OCR Extraction:**
- Extract text from embedded images, charts, infographics
- Options: Tesseract OCR, Google Vision API, Amazon Textract

### AI Claim Detection

**Prompt Source:** `docs/workflow/pharma_claims_persona.md`

The backend reads the persona prompt directly from this file. This keeps the prompt as a single source of truth that can be iterated on without touching application code.

The persona defines:
- Detection categories (Return to Normal, Speed/Magnitude, Competitive Framing, Risk Minimization, Appeal to Authority)
- Confidence scoring rules (90-100% direct claims, 70-89% implications, etc.)
- Output format requirements
- Processing rules for thoroughness

**Categories are for detection logic only - not exposed to frontend.**

### Output Format

```json
[
  {
    "claim": "Clinically proven to work fast",
    "confidence": 95
  },
  {
    "claim": "Feel like yourself again",
    "confidence": 75
  }
]
```

Simple output: claim text + confidence score (0-100)

### Progress Tracking
- Backend reports real progress through stages
- Frontend updates scanner percentage accordingly
- Enables accurate processing time measurement

---

## Changes from Current Implementation

### Removing
- Knowledge Base panel (entire section)
- Reference matching workflow (matched/unmatched toggle)
- Claim highlighting in document viewer
- Category badges on claim cards
- Source labels on claim cards
- Confidence filter dropdown

### Keeping
- Three-panel layout
- Document upload flow
- Model selector (Gemini + Claude options)
- Scanner animation
- Claim cards with confidence bar
- Approve/Reject actions
- Status filter toggles
- Search and sort functionality

### Adding/Changing
- Support for DOCX, PPT, PPTX (not just PDF)
- Convert all documents to images for preview
- Real progress percentage tracking
- Results Summary with confidence tier breakdown
- Simplified claim output (text + confidence only)
