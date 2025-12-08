# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Claims Detector is a React POC for AI-powered detection of medical/regulatory claims in pharmaceutical documents. Currently runs entirely on mock data—ready for API integration.

## Commands

```bash
npm run dev       # Start Vite dev server (localhost:5173)
npm run build     # Production build
npm run lint      # ESLint
npm run preview   # Preview production build
```

## Architecture

### Component Structure (Atomic Design)
```
src/components/
├── atoms/           # Button, Icon, Input, Toggle, Badge, Spinner, etc.
├── molecules/       # FileUpload, DropdownMenu, Alert, Tabs, StatCard
└── claims-detector/ # Domain components: DocumentViewer, ClaimCard, ScannerOverlay
```

### Path Aliases (vite.config.js)
- `@` → `./src`
- `@tokens` → `./src/tokens`
- `@components` → `./src/components`
- `@utils` → `./src/utils`

### State Management
All state lives in `App.jsx` (no external state library). Key state groups:
- Upload/document state
- Configuration (brand, model, AI discovery toggle)
- Analysis results (claims array, processing time)
- Filtering (status, type, source, search query)

### Mock Data
- `src/mocks/documents.js` - Sample pharma documents with full text content
- `src/mocks/claims.js` - 20+ claims with confidence, type, location, status

### Claim Schema
```javascript
{
  id: 'claim_001',
  text: 'Reduces cardiovascular events by 47%...',
  confidence: 0.92,                    // 0-1 scale
  type: 'efficacy',                    // efficacy|safety|regulatory|comparative|dosage|ingredient|testimonial|pricing
  source: 'core',                      // core|ai_discovered
  status: 'pending',                   // pending|approved|rejected
  location: { paragraph: 3, charStart: 145, charEnd: 198 }
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

## Key Interactions

- **Bidirectional sync**: Clicking a claim scrolls to and highlights text in DocumentViewer; clicking highlighted text selects the claim
- **Demo mode**: Add `?demo=true` URL param to enable model comparison feature
- **Mock mode in FileUpload**: Bypasses file picker for development
