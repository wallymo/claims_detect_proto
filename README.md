<p align="center">
  <img src="https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react&logoColor=white" alt="React 19.2"/>
  <img src="https://img.shields.io/badge/Vite-7.2-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite 7.2"/>
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

Claims Detector is an enterprise-grade proof-of-concept application that leverages multiple AI models to automatically identify and flag medical/regulatory claims in pharmaceutical promotional materials. Designed for MLR review teams at pharmaceutical agencies, it dramatically reduces manual review time while maintaining compliance rigor.

### The Problem

Pharmaceutical promotional materials require extensive MLR review to ensure all claims are properly substantiated. Manual review is:
- **Time-intensive**: Reviewers must read every document line-by-line
- **Error-prone**: Human reviewers miss claims, especially in dense materials
- **Inconsistent**: Different reviewers flag different claims
- **Expensive**: Senior medical/legal reviewers are costly resources

### The Solution

Claims Detector uses multimodal AI to:
- **Automatically scan** PDFs, DOCX, and PPTX documents
- **Identify claims** requiring substantiation with confidence scores
- **Pinpoint locations** with precise x/y coordinates on each page
- **Categorize claims** by type (efficacy, safety, comparative, etc.)
- **Match to references** from your knowledge base

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Multi-Model AI** | Choose from Gemini 3 Pro, GPT-4o, or Claude Sonnet 4.5 |
| **Visual Document Analysis** | AI sees documents as images—catches claims in charts, graphs, and infographics |
| **Precise Positioning** | Claims pinpointed with x/y coordinates for easy navigation |
| **Document Normalization** | DOCX/PPTX automatically converted to canonical PDF format |
| **Confidence Scoring** | 0-100 confidence rating for each detected claim |
| **Claim Categorization** | Auto-classification: efficacy, safety, regulatory, comparative, dosage, ingredient, testimonial, pricing |
| **Knowledge Base Matching** | Match claims against your reference document library |
| **Cost Tracking** | Real-time API usage and cost monitoring |
| **Bidirectional Navigation** | Click claim → jump to document; click document → select claim |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLAIMS DETECTOR                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         React Frontend (Vite)                        │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │   │
│  │  │  Home Page   │  │  MKG Claims  │  │     Shared Components    │   │   │
│  │  │  (Demo Mode) │  │   Detector   │  │  PDFViewer, ClaimCard,   │   │   │
│  │  │  Mock Data   │  │  Real AI API │  │  DocumentViewer, etc.    │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         AI Service Layer                             │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │   │
│  │  │   Gemini     │  │   OpenAI     │  │       Anthropic          │   │   │
│  │  │ gemini-3-pro │  │   gpt-4o     │  │  claude-sonnet-4.5       │   │   │
│  │  │  Native PDF  │  │ Responses API│  │    Messages API          │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Normalizer Service (Express)                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │  DOCX/PPTX → PDF (LibreOffice)  │  PDF → PNG (Poppler)       │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19.2, Vite 7.2, CSS Modules, pdfjs-dist |
| **Backend** | Node.js 20+, Express 5 |
| **AI Models** | Google Gemini 3 Pro, OpenAI GPT-4o, Anthropic Claude Sonnet 4.5 |
| **Document Processing** | LibreOffice (DOCX/PPTX), Poppler (PDF rendering) |
| **State Management** | React component state (no external library) |
| **Styling** | CSS Modules, Design Tokens |

---

## Getting Started

### Prerequisites

- **Node.js** 20+
- **npm** 10+
- **LibreOffice** 7.6+ (for DOCX/PPTX conversion)
- **Poppler** (for PDF rendering) - `brew install poppler` on macOS

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/claims-detector.git
cd claims-detector

# Install frontend dependencies
cd app
npm install

# Install normalizer service dependencies
cd ../normalizer-service
npm install
```

### Configuration

Create `app/.env.local` with your API keys:

```env
# AI Model API Keys (at least one required)
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_OPENAI_API_KEY=your_openai_api_key
VITE_ANTHROPIC_API_KEY=your_anthropic_api_key

# Normalizer Service URL
VITE_NORMALIZER_URL=http://localhost:3001
```

### Running the Application

```bash
# From the /app directory - starts both frontend and normalizer service
cd app
npm run dev

# Access the application
# Frontend: http://localhost:5173
# Normalizer: http://localhost:3001
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server + normalizer service concurrently |
| `npm run dev:app` | Start Vite dev server only |
| `npm run build` | Create production build |
| `npm run lint` | Run ESLint |
| `npm run preview` | Preview production build |

---

## Usage

### Demo Mode (Home Page)

Navigate to `http://localhost:5173/` for the demo interface with mock data. Perfect for:
- Stakeholder demonstrations
- UI/UX testing
- Development without API costs

Add `?demo=true` to enable model comparison features.

### Production Mode (MKG Claims Detector)

Navigate to `http://localhost:5173/mkg` for the full AI-powered analysis:

1. **Upload Document** - Drag & drop or select PDF, DOCX, or PPTX
2. **Select AI Model** - Choose Gemini, GPT-4o, or Claude
3. **Analyze** - AI scans document and identifies claims
4. **Review** - Navigate claims with confidence scores and positions
5. **Export** - Download results for your MLR workflow

---

## API Reference

### Normalizer Service

#### `POST /normalize`

Convert DOCX/PPTX/PDF to canonical format with page images.

**Request:**
```http
POST /normalize
Content-Type: multipart/form-data

file: <binary>
```

**Response:**
```json
{
  "success": true,
  "document": {
    "document_id": "uuid",
    "canonical_pdf": "data:application/pdf;base64,...",
    "page_images": [
      { "page": 1, "base64": "..." }
    ],
    "page_count": 10,
    "original_filename": "document.docx",
    "original_type": "docx",
    "conversion_time_ms": 1500
  }
}
```

**Limits:**
- Max file size: 100MB
- Max pages: 200
- Accepted types: PDF, DOCX, PPTX

#### `GET /health`

Health check endpoint for monitoring.

---

## Claim Schema

```typescript
interface Claim {
  id: string;              // e.g., "claim_001"
  text: string;            // The exact claim text from document
  confidence: number;      // 0.0 - 1.0 confidence score
  type: ClaimType;         // Category of claim
  status: ClaimStatus;     // Review status
  page: number;            // Page number (1-indexed)
  position: {
    x: number;             // X position as % of page width (0-100)
    y: number;             // Y position as % of page height (0-100)
  };
}

type ClaimType =
  | 'efficacy'      // Effectiveness claims
  | 'safety'        // Safety/risk claims
  | 'regulatory'    // Regulatory status claims
  | 'comparative'   // Comparison to alternatives
  | 'dosage'        // Dosing information
  | 'ingredient'    // Ingredient/composition claims
  | 'testimonial'   // Patient/HCP testimonials
  | 'pricing';      // Cost/value claims

type ClaimStatus = 'pending' | 'approved' | 'rejected';
```

---

## AI Model Comparison

| Capability | Gemini 3 Pro | GPT-4o | Claude Sonnet 4.5 |
|------------|--------------|--------|-------------------|
| **Max Context** | ~1M tokens | 128K tokens | 200K tokens |
| **Max Output** | 64K tokens | 16K tokens | 64K tokens |
| **PDF Processing** | Native multimodal | Images + text | Images + text |
| **Input Cost** | $2.00/1M | $2.50/1M | $3.00/1M |
| **Output Cost** | $12.00/1M | $10.00/1M | $15.00/1M |
| **Best For** | Large documents | Balanced cost/quality | Nuanced analysis |

---

## Deployment

### Docker (Normalizer Service)

```bash
cd normalizer-service
docker build -t claims-detector-normalizer .
docker run -p 3001:3001 claims-detector-normalizer
```

### Environment Variables (Production)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Normalizer service port | 3001 |
| `MAX_FILE_SIZE_MB` | Maximum upload size | 100 |
| `MAX_PAGES` | Maximum document pages | 200 |
| `PDF_RENDERER` | Renderer: `poppler` or `pdfjs` | poppler |
| `PDF_RENDER_DPI` | DPI for page images | 144 |

### Recommended Platforms

- **Frontend**: Vercel, Netlify, AWS Amplify
- **Normalizer Service**: Railway, Render, AWS ECS (requires LibreOffice)

---

## Project Structure

```
claims_detector/
├── app/                          # React frontend application
│   ├── src/
│   │   ├── components/           # UI components (atomic design)
│   │   │   ├── atoms/            # Basic elements (Button, Input, Badge)
│   │   │   ├── molecules/        # Composite elements (FileUpload, Tabs)
│   │   │   ├── claims-detector/  # Domain components (ClaimCard, PDFViewer)
│   │   │   └── mkg/              # MKG-specific components
│   │   ├── pages/                # Route pages
│   │   ├── services/             # AI API integrations
│   │   ├── mocks/                # Demo data
│   │   ├── tokens/               # Design system tokens
│   │   └── utils/                # Utility functions
│   └── public/                   # Static assets
├── normalizer-service/           # Document conversion backend
├── docs/                         # Documentation and briefs
└── MKG Knowledge Base/           # Reference documents
```

---

## Security Considerations

> **Note**: This is a proof-of-concept application. Production deployment requires additional security measures.

### Current POC Limitations

- No authentication/authorization
- No rate limiting
- No virus scanning on uploads
- API keys stored client-side
- No audit logging

### Recommended for Production

- [ ] Implement OAuth 2.0 / SAML authentication
- [ ] Add API gateway with rate limiting
- [ ] Integrate ClamAV virus scanning
- [ ] Move API keys to secure backend proxy
- [ ] Add comprehensive audit logging
- [ ] Implement role-based access control
- [ ] Enable SOC 2 compliant hosting

---

## Roadmap

### Phase 1: POC (Current)
- [x] Multi-model AI integration
- [x] PDF/DOCX/PPTX support
- [x] Claim detection with positioning
- [x] Basic knowledge base matching
- [x] Cost tracking

### Phase 2: Enterprise MVP
- [ ] User authentication (SSO)
- [ ] Team workspaces
- [ ] Claim approval workflows
- [ ] Reference library management
- [ ] Batch document processing

### Phase 3: Production
- [ ] SOC 2 compliance
- [ ] Custom model fine-tuning
- [ ] Integration APIs (Veeva, Zinc, etc.)
- [ ] Advanced analytics dashboard
- [ ] Audit trail and compliance reporting

---

## Contributing

This is currently a private repository. For contribution guidelines, please contact the project maintainers.

---

## License

Proprietary - All Rights Reserved

This software is the confidential and proprietary information of the project owners. Unauthorized copying, distribution, or use is strictly prohibited.

---

## Support

For technical support or questions:
- **Internal Teams**: Contact the development team via Slack
- **Issues**: File issues in the GitHub repository

---

<p align="center">
  <sub>Built with enterprise pharmaceutical compliance in mind.</sub>
</p>
