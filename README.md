<p align="center">
  <img src="https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react&logoColor=white" alt="React 19.2"/>
  <img src="https://img.shields.io/badge/Vite-7.2-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 7.2"/>
  <img src="https://img.shields.io/badge/Express-4.x-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express"/>
  <img src="https://img.shields.io/badge/SQLite-WAL-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite"/>
  <img src="https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 20+"/>
  <img src="https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge" alt="License"/>
</p>

<h1 align="center">Claims Detector</h1>

<p align="center">
  <strong>AI-Powered Medical & Regulatory Claim Detection for Pharmaceutical Documents</strong>
</p>

<p align="center">
  Streamline MLR (Medical, Legal, Regulatory) review processes with multi-model AI analysis.<br/>
  Built for enterprise pharmaceutical compliance workflows.
</p>

---

## Overview

Claims Detector is a proof-of-concept application that leverages multiple AI models to automatically identify and flag medical/regulatory claims in pharmaceutical promotional materials. Designed for MLR review teams at pharmaceutical agencies, it reduces manual review time while maintaining compliance rigor.

### The Problem

Pharmaceutical promotional materials require extensive MLR review to ensure all claims are properly substantiated. Manual review is:
- **Time-intensive**: Reviewers must read every document line-by-line
- **Error-prone**: Human reviewers miss claims, especially in dense materials
- **Inconsistent**: Different reviewers flag different claims
- **Expensive**: Senior medical/legal reviewers are costly resources

### The Solution

Claims Detector uses multimodal AI to:
- **Automatically scan** PDF documents (text, charts, graphs, annotation markers)
- **Identify claims** requiring substantiation with confidence scores
- **Pinpoint locations** with precise x/y coordinates on each page
- **Categorize claims** by type (efficacy, safety, comparative, etc.)
- **Match claims to references** from a brand-specific knowledge base
- **Capture feedback** to improve future detection accuracy

### Design Principles

- **Over-flag, never under-flag** — false positives cost reviewer time; false negatives cost clients
- **Three content layers** — text, visual data (charts/graphs), and annotation markers (†, ‡, §, *)
- **All claims always shown** — unmatched claims are never hidden from reviewers
- **Pre-screening, not approval** — the reviewer always has final say

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Multi-Model AI** | Choose from Gemini, GPT-4o, or Claude |
| **Visual Document Analysis** | AI sees documents as images — catches claims in charts, graphs, and infographics |
| **Precise Positioning** | Claims pinpointed with x/y coordinates for bidirectional navigation |
| **Brand Reference Library** | Upload and organize reference documents per brand with folder management |
| **Claim-to-Reference Mapping** | Three-tier matching pipeline connects claims to source material |
| **Reference Fact Indexing** | Pre-extract structured facts from references via Gemini for faster matching |
| **Confidence Scoring** | 0-100 confidence rating for each detected claim |
| **Claim Categorization** | Auto-classification: efficacy, safety, regulatory, comparative, dosage, ingredient, testimonial, pricing |
| **Feedback Loop** | Approve/reject claims with optional reasons; feedback improves future detection |
| **Cost Tracking** | Real-time API usage and cost monitoring |

---

## Architecture

```
claims_detector/
├── app/                          # React frontend (Vite, :5173)
│   └── src/
│       ├── components/
│       │   ├── atoms/            # Button, Icon, Input, Toggle, Spinner
│       │   ├── molecules/        # Tabs, FileUpload, DropdownMenu
│       │   ├── claims-detector/  # LibraryTab, ReferenceListItem, DocumentTypeSelector
│       │   └── mkg/              # PDFViewer, MKGClaimCard, ClaimPinsOverlay
│       ├── pages/                # Home, MKGClaimsDetector, MKG2ClaimsDetector
│       ├── services/             # AI clients, backend API, reference matching
│       └── tokens/               # Design tokens (CSS variables)
├── backend/                      # Express + SQLite API (:3001)
│   ├── migrations/               # SQL schema (auto-run on startup)
│   ├── scripts/                  # preload-references, index-references
│   └── src/
│       ├── models/               # Brand, Reference, ClaimFeedback, Folder, ReferenceFact
│       ├── controllers/          # REST controllers
│       ├── routes/               # Route wiring
│       ├── services/             # Text extraction, fact extraction, alias generation
│       └── middleware/           # Error handling, file upload (Multer), validation
└── docs/                         # Plans and workflow diagrams
```

### Routes

| Route | Description |
|-------|-------------|
| `/` | Home page with mock data for demos |
| `/mkg` | POC1 — AI-powered PDF claim detection |
| `/mkg2` | POC2 — Full pipeline with brand library, claim-to-reference mapping, and feedback |

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19.2, Vite 7.2, CSS Modules, pdfjs-dist |
| **Backend** | Express 4.x, SQLite (better-sqlite3, WAL mode) |
| **AI Models** | Google Gemini, OpenAI GPT-4o, Anthropic Claude |
| **PDF Processing** | pdf-parse (server-side extraction), PDF.js (client-side rendering) |
| **File Upload** | Multer (backend), drag-and-drop (frontend) |
| **Deployment** | Vercel (frontend) |

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **npm** 10+
- API keys for at least one AI provider (Gemini recommended)

### Installation

```bash
# Clone the repository
git clone https://github.com/HedgeHox/claims_detect_proto.git
cd claims_detect_proto

# Install frontend dependencies
cd app && npm install

# Install backend dependencies
cd ../backend && npm install
```

### Configuration

**Frontend** — create `app/.env.local`:
```env
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_OPENAI_API_KEY=your_openai_api_key
VITE_ANTHROPIC_API_KEY=your_anthropic_api_key
```

**Backend** — create `backend/.env`:
```env
GEMINI_API_KEY=your_gemini_api_key
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_OPENAI_API_KEY=your_openai_api_key
VITE_ANTHROPIC_API_KEY=your_anthropic_api_key
```

### Running

```bash
# Terminal 1 — Backend
cd backend
npm run dev        # Express on :3001

# Terminal 2 — Frontend
cd app
npm run dev        # Vite on :5173
```

Vite proxies `/api` requests to `http://localhost:3001`.

### Available Scripts

**Frontend** (`app/`):

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run test` | Run tests (Vitest) |

**Backend** (`backend/`):

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Express with --watch |
| `npm run preload` | Load reference PDFs into SQLite |
| `node scripts/index-references.js` | Batch-extract facts from all references via Gemini |
| `node scripts/index-references.js --force` | Re-index all references (even already indexed) |

---

## Detection Pipeline

1. **Upload** a PDF document and select a brand
2. **AI Detection** — selected AI model analyzes the document multimodally (text + visuals) and returns claims with x/y coordinates, confidence scores, and types
3. **Reference Matching** (POC2) — three-tier pipeline maps each claim to source references:
   - **Tier 0 (fast path):** Keyword match against pre-extracted reference facts (>=75% overlap = instant match)
   - **Tier 1:** Keyword pre-filter narrows candidates to top 5-8 references
   - **Tier 2:** Gemini AI matches claim to reference with page number and excerpt
4. **Review** — reviewer approves or rejects each claim with optional feedback

### Claim Schema

```javascript
{
  id: 'claim_001',
  text: 'Reduces cardiovascular events by 47%...',
  confidence: 0.92,        // 0-1 scale
  type: 'efficacy',        // efficacy|safety|regulatory|comparative|dosage|ingredient|testimonial|pricing
  status: 'pending',       // pending|approved|rejected
  page: 1,
  position: { x: 25.0, y: 14.5 }  // x/y as % of page (0-100)
}
```

---

## Backend API

| Endpoint | Purpose |
|----------|---------|
| `GET/POST/DELETE /api/brands` | Brand CRUD |
| `GET/POST/PATCH/DELETE /api/brands/:brandId/references` | Reference document management with file upload |
| `POST /api/brands/:brandId/references/bulk-move` | Move references to folder |
| `POST /api/brands/:brandId/references/bulk-delete` | Bulk delete references |
| `GET /api/files/references/:refId` | Serve reference PDF |
| `GET /api/files/references/:refId/text` | Get extracted text |
| `GET/POST/PATCH /api/feedback` | Claim feedback persistence |
| `GET/POST/PATCH/DELETE /api/folders` | Folder management |
| `GET /api/brands/:brandId/references/:refId/facts` | Extracted facts for a reference |
| `POST /api/references/:refId/facts/extract` | Trigger fact extraction |
| `GET /api/brands/:brandId/facts/summary` | Fact status summary for a brand |

---

## Security Considerations

> **Note**: This is a proof-of-concept. Production deployment requires additional security measures.

### Current POC Limitations

- No authentication/authorization
- No rate limiting
- API keys stored client-side (POC1)
- No audit logging

### Recommended for Production

- [ ] OAuth 2.0 / SAML authentication
- [ ] API gateway with rate limiting
- [ ] Move API keys to secure backend proxy
- [ ] Role-based access control
- [ ] Comprehensive audit logging
- [ ] SOC 2 compliant hosting

---

## Roadmap

### Phase 1: POC1 (Complete)
- [x] Multi-model AI integration (Gemini, GPT-4o, Claude)
- [x] PDF document analysis with multimodal processing
- [x] Claim detection with x/y positioning
- [x] Confidence scoring and categorization
- [x] Cost tracking

### Phase 2: POC2 (Complete)
- [x] Express + SQLite backend
- [x] Brand-scoped reference library with file upload
- [x] Folder management for reference organization
- [x] Claim-to-reference mapping (three-tier pipeline)
- [x] Reference fact indexing via Gemini
- [x] Claim feedback loop (approve/reject)
- [x] Auto-index on reference upload

### Phase 3: Enterprise MVP
- [ ] User authentication (SSO)
- [ ] Team workspaces
- [ ] Batch document processing
- [ ] Integration APIs (Veeva, Zinc, etc.)
- [ ] Advanced analytics dashboard

---

## License

Proprietary - All Rights Reserved

---

<p align="center">
  <sub>Built for enterprise pharmaceutical compliance.</sub>
</p>
