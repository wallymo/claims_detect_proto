# Backend Architecture - Claims Detector

**Last Updated:** 2026-01-08

## Overview

**TL;DR:** There's **no traditional backend**. This is a **frontend-only SPA** that makes direct API calls to AI providers (Gemini, Claude, OpenAI) from the browser. All PDF processing, claim detection, and state management happens client-side.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    React Frontend (Vite)                    │
│                  /app/src (localhost:5173)                  │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │   Gemini   │  │   Claude   │  │   OpenAI   │
     │  API (3 Pro) │  │ (Sonnet 4.5)│  │  (GPT-4o)  │
     └────────────┘  └────────────┘  └────────────┘
```

---

## Service Layer (`src/services/`)

Three API wrappers with **identical interfaces** for swappable models:

### **gemini.js** - Google Gemini 3 Pro

**File:** `src/services/gemini.js`

**Key Features:**
- Uses `@google/genai` SDK
- Sends PDF as **base64 multimodal input** (Gemini sees visual layout)
- Returns claims with `{x, y}` positions as percentages
- Model: `gemini-3-pro-preview`
- Pricing: $1.25 input / $5.00 output per 1M tokens

**Interface:**
```javascript
analyzeDocument(pdfFile, onProgress, promptKey, customPrompt)
  → Returns: { success, claims[], usage: { model, inputTokens, outputTokens, cost } }
```

**How it works:**
1. Convert PDF File → base64
2. POST to Gemini API with:
   ```javascript
   {
     model: 'gemini-3-pro-preview',
     contents: [
       { text: prompt },
       { inlineData: { mimeType: 'application/pdf', data: base64 }}
     ],
     config: {
       temperature: 0,
       responseMimeType: 'application/json'
     }
   }
   ```
3. Gemini returns:
   ```json
   {
     "claims": [
       { "claim": "Text here", "confidence": 85, "page": 1, "x": 25.0, "y": 14.5 }
     ]
   }
   ```
4. Extract usage metadata (input/output tokens) and calculate cost

---

### **anthropic.js** - Claude Sonnet 4.5

**File:** `src/services/anthropic.js`

**Key Features:**
- Uses **direct fetch** (SDK has CORS issues in browser)
- Converts PDF → PNG images first (`pdfToImages` utility) for better spatial accuracy
- Sends images as base64 multimodal input
- Model: `claude-sonnet-4-5-20250929`
- Pricing: $3.00 input / $15.00 output per 1M tokens

**Why PDF → Images?**
> "Claude's image vision is more spatially accurate than its PDF parsing"

**Interface:**
```javascript
analyzeDocument(pdfFile, onProgress, promptKey, customPrompt)
  → Returns: { success, claims[], usage: { model, inputTokens, outputTokens, cost } }
```

**How it works:**
1. Convert PDF → PNG images per page using `pdfToImages(pdfFile)`
2. Convert images → base64
3. POST to Anthropic API:
   ```javascript
   fetch('https://api.anthropic.com/v1/messages', {
     headers: {
       'x-api-key': apiKey,
       'anthropic-version': '2023-06-01',
       'anthropic-dangerous-direct-browser-access': 'true'  // CORS workaround
     },
     body: {
       model: 'claude-sonnet-4-5-20250929',
       messages: [{
         role: 'user',
         content: [
           ...pageImages.map(img => ({
             type: 'image',
             source: { type: 'base64', media_type: 'image/png', data: img.base64 }
           })),
           { type: 'text', text: prompt }
         ]
       }]
     }
   })
   ```
4. Parse JSON response (same schema as Gemini)

---

### **openai.js** - GPT-4o

**File:** `src/services/openai.js`

**Key Features:**
- Uses `openai` SDK with `dangerouslyAllowBrowser: true`
- Also converts PDF → images for vision accuracy
- Sends images as `data:image/png;base64` URLs
- Model: `gpt-4o`
- Pricing: $2.50 input / $10.00 output per 1M tokens

**Interface:**
```javascript
analyzeDocument(pdfFile, onProgress, promptKey, customPrompt)
  → Returns: { success, claims[], usage: { model, inputTokens, outputTokens, cost } }
```

**How it works:**
1. Convert PDF → PNG images per page
2. Convert images → base64
3. Call OpenAI API:
   ```javascript
   openai.chat.completions.create({
     model: 'gpt-4o',
     messages: [{
       role: 'user',
       content: [
         { type: 'text', text: prompt },
         ...pageImages.map(img => ({
           type: 'image_url',
           image_url: { url: `data:image/png;base64,${img.base64}` }
         }))
       ]
     }],
     temperature: 0,
     response_format: { type: 'json_object' }
   })
   ```
4. Extract usage and calculate cost

---

## End-to-End Flow

### **1. PDF Upload**

**File:** `MKGClaimsDetector.jsx:140-175`

```javascript
User selects PDF
  → Validate file type (must be PDF)
  → Store File object in state (uploadedFile)
  → Reset claims/analysis state
  → Update uploadState: 'empty' → 'uploading' → 'complete'
```

---

### **2. PDF Rendering**

**Component:** `PDFViewer` (`src/components/mkg/PDFViewer.jsx`)

```javascript
PDFViewer receives File object
  → Uses pdfjs-dist to render each page on <canvas>
  → Extracts text per page (optional, for fallback text matching)
  → Renders claim pins as overlay markers at (x%, y%) coordinates
  → Handles pin clicks → highlights claim in sidebar
```

---

### **3. Analysis Trigger**

**File:** `MKGClaimsDetector.jsx:178-246`

```javascript
User clicks "Analyze Document"
  1. Select AI model (gemini-3-pro | claude-sonnet-4.5 | gpt-4o)
  2. Select prompt preset (all-claims | disease-state | medication)
  3. Build final prompt:
     - User-facing prompt (editable in UI)
     - + Position instructions (backend-only, appended automatically)
  4. Route to appropriate service based on selected model
  5. Track progress with onProgress callback
```

**Model Routing:**
```javascript
const MODEL_ANALYZERS = {
  'gemini-3-pro': analyzeWithGemini,
  'claude-sonnet-4.5': analyzeWithAnthropic,
  'gpt-4o': analyzeWithOpenAI
}
```

---

### **4. Claims Processing**

**File:** `MKGClaimsDetector.jsx:213-225`

```javascript
AI API response received
  → Transform claims to frontend format:
    {
      id: 'claim_001',                    // Generated ID
      text: 'claim text',                 // From AI
      confidence: 0.92,                   // 0-1 scale (AI returns 0-100)
      status: 'pending',                  // pending | approved | rejected
      page: 1,                            // PDF page number
      position: { x: 25.0, y: 14.5 }      // % of page dimensions (from AI)
    }

  → Fallback (if positions missing):
    - Use text matching against extracted PDF pages
    - Function: enrichClaimsWithPositions(claims, extractedPages)

  → Add globalIndex for stable sorting
  → Update state: setClaims(processedClaims)
```

---

### **5. Cost Tracking**

**File:** `MKGClaimsDetector.jsx:228-235`

```javascript
Calculate cost:
  inputCost = (inputTokens / 1_000_000) * inputRate
  outputCost = (outputTokens / 1_000_000) * outputRate
  totalCost = inputCost + outputCost

Track in state:
  - lastUsage: { model, modelDisplayName, inputTokens, outputTokens, cost, inputRate, outputRate }
  - sessionCost: Sum of all runs in current session
  - totalCost: All-time total (persisted to localStorage: 'gemini_total_cost')

Display in UI:
  "This run: $0.12 | Session: $0.45 | All-time: $2.87"
```

---

### **6. Rendering Claims**

**Components:**
- `PDFViewer` - Renders PDF with claim pins
- `ClaimCard` - Claim sidebar item

```javascript
PDFViewer:
  → Render claim pins at (x%, y%) coordinates
  → Pin CSS positioning:
      left: (claim.position.x / 100) * canvasWidth
      top: (claim.position.y / 100) * canvasHeight
  → Pin click → setActiveClaimId → highlight in sidebar

ClaimCard:
  → Click → scroll PDF to claim's page
  → Approve/Reject buttons → update claim.status
  → Color-coded by confidence (high/medium/low)
```

---

## Claim Schema

```javascript
{
  id: 'claim_001',
  text: 'Reduces cardiovascular events by 47%...',
  confidence: 0.92,                    // 0-1 scale
  status: 'pending',                   // pending | approved | rejected
  page: 1,                             // PDF page number
  position: { x: 25.0, y: 14.5 },      // x/y as % of page (0-100), returned by AI
  globalIndex: 0                       // Stable sort index
}
```

---

## Prompt System

### **Preset Prompts** (Editable in UI)

**File:** `src/services/gemini.js`

1. **ALL_CLAIMS_PROMPT_USER** - Comprehensive claim detection
2. **DISEASE_STATE_PROMPT_USER** - Disease/condition claims only
3. **MEDICATION_PROMPT_USER** - Drug/product claims only

**Dropdown:** `MKGClaimsDetector.jsx:33-38`
```javascript
const PROMPT_OPTIONS = [
  { id: 'all-claims', label: 'All Claims', promptKey: 'all' },
  { id: 'disease-state', label: 'Disease State', promptKey: 'disease' },
  { id: 'medication', label: 'Medication', promptKey: 'drug' }
]
```

### **Position Instructions** (Backend-only, auto-appended)

**File:** `src/services/gemini.js:76-92`

```
POSITION: Return the x/y coordinates where a marker pin should be placed for each claim:
- x: LEFT EDGE of the claim text as percentage (0 = page left, 100 = page right)
- y: vertical center of the claim text as percentage (0 = page top, 100 = page bottom)
- The pin will appear AT these exact coordinates, so position at the LEFT EDGE of text, not center
- For charts/images: position at the LEFT EDGE of the visual element
- Example: text starting 20% from left at 30% down the page = x:20, y:30

Return ONLY this JSON:
{
  "claims": [
    { "claim": "[Exact phrase]", "confidence": 85, "page": 1, "x": 25.0, "y": 14.5 }
  ]
}
```

**Why separate?**
- User can edit the detection strategy (claim types, confidence scoring)
- Position format is technical implementation detail, not user-facing

---

## State Management

**All state lives in:** `MKGClaimsDetector.jsx`

No external state library (Redux, Zustand, etc.)

### **State Groups:**

```javascript
// Document state
uploadedFile: File | null
uploadState: 'empty' | 'uploading' | 'complete'

// Analysis state
selectedModel: 'gemini-3-pro' | 'claude-sonnet-4.5' | 'gpt-4o'
selectedPrompt: 'all-claims' | 'disease-state' | 'medication'
editablePrompt: string  // User can edit prompt text
isAnalyzing: boolean
analysisComplete: boolean
analysisProgress: 0-100
analysisStatus: string  // "Sending to AI..." etc.

// Claims state
claims: Claim[]
activeClaimId: string | null
statusFilter: 'all' | 'pending' | 'approved' | 'rejected'
searchQuery: string
sortOrder: 'high-low' | 'low-high'
showClaimPins: boolean
showPinHighlights: boolean

// Cost tracking
lastUsage: { model, inputTokens, outputTokens, cost, ... }
sessionCost: number
totalCost: number  // Synced to localStorage
```

---

## Environment Variables

**Required in:** `app/.env.local`

```bash
VITE_GEMINI_API_KEY=AIza...
VITE_ANTHROPIC_API_KEY=sk-ant...
VITE_OPENAI_API_KEY=sk-proj...
```

**Why VITE_ prefix?**
- Vite only exposes env vars starting with `VITE_` to the browser bundle

---

## Key Design Decisions

### **Why No Backend?**

1. **Prototype speed**: No server deployment, just static hosting (Vercel/Netlify)
2. **Cost optimization**: Pay-per-use AI APIs only (no EC2/Lambda/database costs)
3. **Simplicity**: One codebase, no API gateway/auth/DB schema

**Trade-offs:**
- API keys exposed in browser (acceptable for POC, not production)
- No server-side caching/rate limiting
- CORS workarounds required

---

### **Why PDF → Images for Claude/OpenAI?**

**Per anthropic.js:222-225:**
> "Claude's image vision is more spatially accurate than its PDF parsing"

**Benefits:**
- More accurate `{x, y}` coordinates for claim positioning
- Consistent behavior across all models

**Drawbacks:**
- Larger payload size (PNG images vs compressed PDF)
- Extra processing step (pdf.js rendering)

**Gemini:**
- Handles PDF natively with good spatial awareness
- No image conversion needed

---

### **Why Three Models?**

1. **Model comparison**: Let users test which AI finds claims best
2. **Redundancy**: If one API is down, switch models
3. **Cost optimization**:
   - Gemini Flash: $0.075 input
   - GPT-4o: $2.50 input
   - Claude Opus: $5.00 input

---

### **Position Calculation**

All models return positions as **percentage of page dimensions**:

```javascript
// AI returns: { x: 25.0, y: 14.5 }
// Frontend converts to pixels:
pin.style.left = `${(claim.position.x / 100) * canvasWidth}px`
pin.style.top = `${(claim.position.y / 100) * canvasHeight}px`
```

**Why percentages?**
- PDF pages vary in size (A4, Letter, custom)
- Canvas rendering scales with viewport
- Percentages work regardless of zoom level

---

## Utilities

### **pdfToImages** (`src/utils/pdfToImages.js`)

Converts PDF File → PNG images (one per page)

```javascript
import * as pdfjsLib from 'pdfjs-dist'

async function pdfToImages(pdfFile) {
  // Load PDF
  const arrayBuffer = await pdfFile.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const images = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 })  // 2x for retina
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height

    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise

    const base64 = canvas.toDataURL('image/png').split(',')[1]
    images.push({ pageNumber: i, base64 })
  }

  return images
}
```

**Used by:**
- `anthropic.js` - Required for Claude API
- `openai.js` - Required for GPT-4o API

---

### **textMatcher** (`src/utils/textMatcher.js`)

Fallback positioning when AI doesn't return `{x, y}` coordinates

```javascript
enrichClaimsWithPositions(claims, extractedPages)
  → Searches extractedPages for claim.text
  → Calculates approximate x/y based on character position
  → Returns claims with position: { x, y }
```

**Only used when:**
- AI response missing position data
- Legacy claims without coordinates

---

## CORS Workarounds

### **Gemini**
✅ Native SDK support, no CORS issues

### **Anthropic**
⚠️ Requires special header:
```javascript
headers: {
  'anthropic-dangerous-direct-browser-access': 'true'
}
```

**Risk:** Could break with future API changes

### **OpenAI**
⚠️ Requires SDK flag:
```javascript
new OpenAI({
  apiKey,
  dangerouslyAllowBrowser: true
})
```

**Risk:** Exposes API key in browser (prototype acceptable)

---

## Limitations & Risks

### **Security**
1. **API keys in browser**: Visible in network tab, can be extracted
2. **No rate limiting**: User can spam API calls → high costs
3. **No authentication**: Anyone with the URL can use the app

### **Performance**
1. **Browser memory**: Large PDFs (100+ pages) may crash during image conversion
2. **Network payload**: PNG images much larger than compressed PDF
3. **No caching**: Every analysis hits AI API (no server-side cache)

### **Cost**
1. **No budget controls**: User can rack up unlimited API costs
2. **localStorage tracking**: Cost tracking tied to browser (cleared on cache wipe)

### **Reliability**
1. **CORS fragility**: Anthropic/OpenAI workarounds could break
2. **No retry logic**: Network failures = user must re-upload
3. **No backend fallback**: If all three APIs are down, app is unusable

---

## Production Considerations

To productionize this architecture, you'd need:

1. **Backend API proxy**
   - Hide API keys server-side
   - Implement rate limiting per user
   - Add server-side caching (Redis)
   - Retry logic with exponential backoff

2. **Authentication**
   - User accounts (Auth0, Clerk, etc.)
   - API key tied to user ID
   - Usage quotas per account

3. **Cost controls**
   - Monthly spending limits
   - Warn user before expensive operations
   - Billing integration (Stripe)

4. **Monitoring**
   - Error tracking (Sentry)
   - API usage analytics
   - Performance monitoring (Vercel Analytics)

5. **Database**
   - Persist claims/documents
   - Audit trail for approvals/rejections
   - Reference knowledge base storage

---

## File Structure Reference

```
app/src/
├── services/           # AI API wrappers
│   ├── gemini.js       # Gemini 3 Pro
│   ├── anthropic.js    # Claude Sonnet 4.5
│   └── openai.js       # GPT-4o
│
├── pages/
│   └── MKGClaimsDetector.jsx  # Main analysis page (state management)
│
├── components/
│   ├── mkg/
│   │   ├── PDFViewer.jsx      # PDF rendering + claim pins
│   │   └── KnowledgeBasePanel.jsx
│   └── claims-detector/
│       └── ClaimCard.jsx       # Claim sidebar item
│
└── utils/
    ├── pdfToImages.js   # PDF → PNG converter (for Claude/OpenAI)
    └── textMatcher.js   # Fallback position calculator
```

---

## Testing the Flow

### **Manual Test**

1. Start dev server: `cd app && npm run dev`
2. Navigate to: `http://localhost:5173/mkg`
3. Upload a PDF with medical claims
4. Select model (Gemini/Claude/OpenAI)
5. Select prompt (All Claims/Disease State/Medication)
6. Click "Analyze Document"
7. Verify:
   - Claims appear in sidebar
   - Pins render on PDF at correct positions
   - Cost tracking updates
   - Clicking pin highlights claim in sidebar
   - Clicking claim scrolls PDF to page

### **Debug Console Logs**

All services log:
```javascript
console.log(`📍 Claim ${i}: x=${x}, y=${y}, text="${text.slice(0,50)}..."`)
console.log(`💰 Usage: ${inputTokens} + ${outputTokens} = $${cost}`)
```

---

## Questions for Future Developers

1. **Should we add a backend?**
   - Pro: Security, caching, rate limiting
   - Con: Complexity, deployment costs

2. **Should we stick with one model?**
   - Current: Multi-model support adds complexity
   - Alternative: Pick best performer, remove others

3. **Should we cache AI responses?**
   - Same PDF + same prompt = same claims?
   - Risk: Stale data if prompts improve

4. **How to handle very large PDFs?**
   - Current limit: ~100 pages before browser crashes
   - Solutions: Backend processing, chunking, or PDF size limits

---

## Contact

For questions about this architecture:
- Review `CLAUDE.md` in project root
- Check service files for inline comments
- Run analysis with browser DevTools open to see API calls

**Last Updated:** 2026-01-08
