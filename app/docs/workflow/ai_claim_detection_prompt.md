# Technical Architecture: Promotional Claim Detection App

## Overview

This document outlines the **technical structure and flow** for implementing high-recall promotional claim detection in a healthcare marketing review app using an existing UI framework. It details front-end interactions and back-end processing logic, with Gemini 3 Pro integrated for deep analysis.

---

## Frontend Architecture

### 1. **Document Upload Flow**

- **Input:** User selects and uploads a supported file (e.g., PDF, DOCX, PPTX).
- **UI Element:** File drop zone or upload button.
- **Behavior:**
  - On upload, the document is previewed in the **center panel**.
  - Visual confirmation of successful upload (filename, page count, filetype).

### 2. **Triggering Analysis**

- **Action:** User clicks “Analyze Document” button.
- **State:**
  - Loading state begins true to backend progress occurs.
  - Preview remains static for context.

### 3. **Claims Output Display**

- **Output Location:** Right-side panel labeled **“Claims Review.”**
- **Format:**
  - Structured list of detected claims.
  - Each includes the exact quote, confidence score, and content source.
  - Include filter UI Toggles for Approved, Rejected, Pending, All

---

## Backend Architecture

### 1. **Document Ingestion**

- **Accepted Formats:** PDF, DOCX, PPT, PPTX
- **Process:**
  - Receive user-uploaded document via file upload API.
  - Store in secure temporary storage (e.g., AWS S3, GCP Storage).

### 2. **Multimodal Content Extraction**

Run **two parallel extraction pipelines**:

#### A. **Text Extraction**

- PDF: Use `PyMuPDF` (fitz), `PDFMiner`, or `Apache Tika`
- PPTX: Use `python-pptx`, `Aspose.Slides`, or `LibreOffice` CLI parsing
- Extract visible text from:
  - Paragraphs
  - Text boxes
  - Speaker notes
  - Slide headers/footers

#### B. **Image OCR Extraction**

- Use OCR to extract text from slide images, infographics, scanned assets:
  - Baseline: `Tesseract OCR`
  - Advanced: `Google Vision API`, `Amazon Textract`, or `Microsoft Azure OCR`
- Each OCR fragment should be tagged with its image or slide origin for traceability.

#### ➡️ **Merged Output Structure**

```json
[
  { "source": "Slide 1 - Textbox", "content": "Feel like yourself again" },
  { "source": "Slide 1 - Image OCR", "content": "Clinically proven to work fast" },
  { "source": "Slide 2 - Chart Image OCR", "content": "85% reduction after 30 days" }
]
```

---

### 3. **Claim Detection Engine**

- **Engine:** Gemini 3 Pro (via API)
- **Prompt:** Injects structured detection persona (see separate AI Claim Detection Prompt doc)
- **Payload:**
  - Dynamically embeds extracted content fragments into persona-based prompt
  - Uses Gemini to detect claims and return structured results

### 4. **Structured Output Format**

```json
[
  {
    "claim": "Clinically proven to work fast",
    "confidence": 95,
    "source": "Slide 1 - Image OCR"
  },
  {
    "claim": "Feel like yourself again",
    "confidence": 75,
    "source": "Slide 1 - Textbox"
  }
]
```

---

## Summary

- The frontend facilitates a seamless UX with clear upload, confirmation, and analysis feedback.
- The backend handles multimodal text parsing, AI-driven claim analysis, and formats structured outputs for UI rendering.
- System prioritizes high detection accuracy and low-friction review by human users in the claims panel.

**Recommended Add-On Tools:**

- `PyMuPDF` or `PDFMiner`: Robust PDF text extraction
- `python-pptx` or `Aspose.Slides`: Extracts text from PowerPoint
- `Tesseract`: Free OCR baseline (high-recall, low-cost)
- `Gemini 3 Pro API`: Central intelligence layer for claim detection

