# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claims Detector is a React-based POC for AI-powered detection of medical/regulatory claims in pharmaceutical documents. Built for MKG (a pharma agency) to streamline MLR (Medical, Legal, Regulatory) review processes.

**Two main views:**
- `/` - Home page with mock data for demos (client selection, AI discovery toggle)
- `/mkg` - MKG Claims Detector with real Gemini API integration for PDF analysis

## Commands

All commands run from the `/app` directory:

```bash
cd app
npm run dev       # Start Vite dev server (localhost:5173)
npm run build     # Production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

## Environment Setup

Create `app/.env.local` with:
```
VITE_GEMINI_API_KEY=your_key_here
```

## Architecture

### Repository Structure
```
claims_detector/
├── app/                    # React frontend (Vite)
│   ├── src/
│   │   ├── components/     # Atomic design components
│   │   ├── pages/          # Route pages (Home, MKGClaimsDetector)
│   │   ├── services/       # API services (gemini.js)
│   │   ├── mocks/          # Mock data for demos
│   │   ├── tokens/         # Design tokens (CSS variables)
│   │   └── utils/          # Utility functions
│   └── public/
├── docs/briefs/            # Project briefs and requirements
└── MKG Knowledge Base/     # Reference documents for claim matching
```

### Component Structure (Atomic Design)
```
src/components/
├── atoms/           # Button, Icon, Input, Toggle, Badge, Spinner, etc.
├── molecules/       # FileUpload, DropdownMenu, Alert, Tabs, StatCard, AccordionItem
├── claims-detector/ # Domain components: DocumentViewer, ClaimCard, ScannerOverlay, PDFViewer
└── mkg/             # MKG-specific components: KnowledgeBasePanel, MKGClaimCard
```

### Path Aliases (vite.config.js)
- `@` → `./src`
- `@tokens` → `./src/tokens`
- `@components` → `./src/components`
- `@utils` → `./src/utils`

### Gemini API Integration

The `/mkg` route uses real AI analysis via `src/services/gemini.js`:
- `analyzeDocument(pdfFile, onProgress)` - Sends PDF to Gemini for claim detection
- `matchClaimToReferences(claimText, references)` - Match claims to knowledge base
- `extractPDFText(pdfFile)` - Extract text from PDF using Gemini
- Current model: `gemini-3-pro-preview` (configurable via `GEMINI_MODEL` constant)

Cost tracking is stored in localStorage (`gemini_total_cost`).

### AI Model Comparison

The `/mkg` route supports three AI models for claim detection:

| | Gemini 3 Pro | Claude Sonnet 4.5 | GPT-4o |
|---|---|---|---|
| **Max Input (Context)** | ~1M tokens | 200K tokens | 128K tokens |
| **Max Output** | 64K tokens | 64K tokens | 16,384 tokens |
| **Input Pricing** | $2.00 / 1M (<200K) | $3.00 / 1M | $2.50 / 1M |
| **Output Pricing** | $12.00 / 1M (<200K) | $15.00 / 1M | $10.00 / 1M |
| **PDF API Support** | ✅ Native | ✅ Native | ✅ Native |
| **PDF Processing** | Native vision | Text + page images | Text + page images |
| **DOCX/PPTX Direct** | ❌ | ❌ | ❌ |

**Notes:**
- All three APIs accept PDFs directly—we send PDFs to all models with no client-side conversion
- Claude and OpenAI internally convert PDF pages to images + extracted text
- Gemini uses native vision for document understanding
- DOCX/PPTX require conversion to PDF via our normalizer service (LibreOffice)

**API Content Blocks:**
- Gemini: `inlineData` with `mimeType: 'application/pdf'`
- Claude: `document` with `source.media_type: 'application/pdf'`
- OpenAI: `file` with `file_data: 'data:application/pdf;base64,...'`

### IMPORTANT: Gemini Receives PDFs Visually (Multimodal)

**Gemini sees the PDF as a visual document, not just extracted text.**

The PDF is sent as base64 with `mimeType: 'application/pdf'`:
```javascript
inlineData: {
  mimeType: 'application/pdf',
  data: base64Data  // Gemini SEES the layout
}
```

**Implications:**
- Gemini can return x/y coordinates for claim positions directly
- NO need for client-side text matching to locate claims
- Ask Gemini to return `position: { x: 25.0, y: 14.5 }` as % of page dimensions
- Pin placement becomes trivial: `x = (position.x / 100) * canvasWidth`

**DO NOT** build complex text-matching algorithms to locate claims. Just ask Gemini for coordinates.

See `public/connect-pins/` for the simple coordinate-based approach.

### State Management

All state lives in page components (no external state library):
- `Home.jsx` - Mock-based demo with client selection, AI discovery toggle
- `MKGClaimsDetector.jsx` - Real Gemini integration with cost tracking

### Claim Schema
```javascript
{
  id: 'claim_001',
  text: 'Reduces cardiovascular events by 47%...',
  confidence: 0.92,                    // 0-1 scale
  type: 'efficacy',                    // efficacy|safety|regulatory|comparative|dosage|ingredient|testimonial|pricing
  source: 'core',                      // core|ai_discovered (Home page only)
  status: 'pending',                   // pending|approved|rejected
  page: 1,                             // PDF page number
  position: { x: 25.0, y: 14.5 },      // MKG: x/y as % of page (0-100), returned by Gemini
  location: { paragraph: 3, charStart: 145, charEnd: 198 }  // Home page only (legacy)
}
```

## Coding Conventions

### Components
- Functional components with `export default function ComponentName`
- CSS Modules with camelCase (`styles.claimCard`)
- Props destructured with defaults in function signature
- Each component in its own folder: `ComponentName/ComponentName.jsx` + `ComponentName.module.css`

### Styling
- Design tokens in `src/tokens/tokens.css` (CSS variables)
- CSS Modules configured for camelCase class names
- Use existing tokens for colors, spacing, typography—don't hardcode values

### Claim Type Colors (from tokens)
| Type | Variable | Color |
|------|----------|-------|
| efficacy | blue-7 | #1976D2 |
| safety | red-7 | #D32F2F |
| regulatory | amber-7 | #F57C00 |
| comparative | purple-7 | #7B1FA2 |
| dosage | teal-7 | #00897B |
| ingredient | green-7 | #388E3C |
| testimonial | pink-7 | #C2185B |
| pricing | gray-7 | #616161 |

## Key Features

- **Demo mode**: Add `?demo=true` URL param to enable model comparison feature on Home page
- **Bidirectional sync** (Home): Clicking a claim scrolls to highlighted text in DocumentViewer; clicking highlighted text selects the claim
- **PDF rendering** (MKG): Uses pdfjs-dist for native PDF display with claim highlighting
- **Progress tracking**: Analysis shows real-time progress via callback
- **Cost tracking**: Gemini API usage tracked per-run and total (localStorage)

## Mock Data

For development without API calls (Home page):
- `src/mocks/documents.js` - Sample pharma documents with full text content
- `src/mocks/claims.js` - 20+ claims with confidence, type, location, status
