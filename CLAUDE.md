# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claims Detector is a React-based POC for AI-powered detection of medical/regulatory claims in pharmaceutical documents. Built for MKG (a pharma agency) to streamline MLR (Medical, Legal, Regulatory) review processes.

**Two main views:**
- `/` - Home page with mock data for demos (client selection, AI discovery toggle)
- `/mkg` - MKG Claims Detector with real AI API integration for PDF analysis

## Commands

All commands run from the `/app` directory:

```bash
cd app
npm run dev       # Start Vite + normalizer-service concurrently
npm run dev:app   # Vite only (no normalizer)
npm run build     # Production build
npm run lint      # ESLint
```

Normalizer service standalone (from `/normalizer-service`):
```bash
npm run dev       # Start on localhost:3001 with --watch
npm start         # Production start
```

## Environment Setup

Create `app/.env.local`:
```
VITE_GEMINI_API_KEY=your_key
VITE_OPENAI_API_KEY=your_key
VITE_ANTHROPIC_API_KEY=your_key
VITE_NORMALIZER_URL=http://localhost:3001
```

## Architecture

### Repository Structure
```
claims_detector/
├── app/                    # React frontend (Vite)
│   └── src/
│       ├── components/     # Atomic design (atoms, molecules, claims-detector, mkg)
│       ├── pages/          # Home.jsx, MKGClaimsDetector.jsx
│       ├── services/       # gemini.js, openai.js, anthropic.js
│       ├── mocks/          # Mock data for Home page demos
│       └── tokens/         # Design tokens (CSS variables)
├── normalizer-service/     # Express backend for DOCX/PPTX→PDF conversion
├── docs/briefs/            # Project briefs and requirements
└── MKG Knowledge Base/     # Reference documents for claim matching
```

### Path Aliases (vite.config.js)
- `@` → `./src`
- `@tokens` → `./src/tokens`
- `@components` → `./src/components`
- `@utils` → `./src/utils`

### AI Service Architecture

Three interchangeable AI backends in `src/services/`:

| Service | API Method | Model |
|---------|------------|-------|
| `gemini.js` | `client.models.generateContent()` | gemini-3-pro-preview |
| `openai.js` | `client.responses.create()` | gpt-4o |
| `anthropic.js` | `fetch('/v1/messages')` | claude-sonnet-4-5-20250929 |

All three send PDFs directly as base64 with visual/multimodal processing. Gemini returns x/y coordinates for claim positions—no client-side text matching needed.

**Key pattern:** Ask the AI for `position: { x, y }` as % of page dimensions. Pin placement: `x = (position.x / 100) * canvasWidth`.

### Normalizer Service

Converts DOCX/PPTX to PDF using LibreOffice headless. Also renders PDF pages to PNG for Claude/OpenAI (which prefer images over native PDF).

- `POST /normalize` - Returns canonical PDF + page images
- Requires LibreOffice and Poppler (`pdftocairo`) on system

### State Management

All state lives in page components (no external state library):
- `Home.jsx` - Mock-based demo with client selection
- `MKGClaimsDetector.jsx` - Real AI integration with cost tracking (localStorage)

### Claim Schema
```javascript
{
  id: 'claim_001',
  text: 'Reduces cardiovascular events by 47%...',
  confidence: 0.92,                    // 0-1 scale
  type: 'efficacy',                    // efficacy|safety|regulatory|comparative|dosage|ingredient|testimonial|pricing
  status: 'pending',                   // pending|approved|rejected
  page: 1,
  position: { x: 25.0, y: 14.5 }       // x/y as % of page (0-100)
}
```

## Coding Conventions

- Functional components: `export default function ComponentName`
- CSS Modules with camelCase: `styles.claimCard`
- Component folders: `ComponentName/ComponentName.jsx` + `ComponentName.module.css`
- Design tokens in `src/tokens/tokens.css`—use existing variables, don't hardcode colors/spacing

## Key Features

- **Demo mode**: `?demo=true` URL param enables model comparison on Home page
- **Bidirectional sync** (Home): Click claim → scroll to text; click text → select claim
- **PDF rendering** (MKG): pdfjs-dist with claim pin overlay
- **Cost tracking**: API usage tracked per-run and cumulative in localStorage
