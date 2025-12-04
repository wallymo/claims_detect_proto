# MKG Claims Detector POC - Development Brief

**Client:** MKG (Pharma Agency)
**Project Lead:** Wally Mostafa
**Date:** 2025-12-03
**Brief Type:** POC (Proof of Concept)

---

## Problem Statement

Pharmaceutical agencies manually review documents to identify medical/regulatory claims. This is slow and error-prone.

**Current state:** Human reviewers read documents, manually identify claims, compare against brand guidelines
**Desired state:** AI identifies claims automatically with 70-80%+ accuracy, learns from feedback

---

## Success Criteria

| Metric | Target | How Measured |
|--------|--------|--------------|
| Claim detection accuracy | 70-80%+ | Compare AI output to human-annotated test docs |
| False positive rate | Minimize | Track rejected claims via thumbs-down |
| Model comparison | Best performer identified | Run same docs through 3 models |

---

## Scope

### In Scope (Build This)

| ID | Feature | Priority | Notes |
|----|---------|----------|-------|
| F-1 | Document upload | Must | PDF + DOCX, OCR for image PDFs |
| F-2 | Brand guideline selection | Must | Dropdown to choose Novartis/Pfizer/etc |
| F-3 | AI processing pipeline | Must | Send to model, return JSON claims |
| F-4 | Claims display | Must | Bulleted list with confidence scores |
| F-5 | Feedback mechanism | Must | Thumbs up/down + optional reason |
| F-6 | Prompt editor | Must | Editable master prompt |
| F-7 | Model benchmarking + demo toggle | Must | Internal testing to recommend ONE model to client |

### Out of Scope (Don't Build)

- User authentication/login - Reason: Single-user POC
- Claim-to-content mapping - Reason: Phase 2
- PowerPoint support - Reason: Later phase
- Production deployment - Reason: Staging only
- Multi-tenant/multi-user - Reason: POC simplicity

---

## User Stories

| ID | User | Action | Outcome |
|----|------|--------|---------|
| US-1 | Reviewer | Upload a PDF/DOCX document | System analyzes it for claims |
| US-2 | Reviewer | Select brand guidelines | AI uses correct claim definitions |
| US-3 | Reviewer | View claims with confidence scores | Prioritize review by confidence |
| US-4 | Reviewer | Approve/reject individual claims | Train the system on accuracy |
| US-5 | Reviewer | Explain why claim was rejected | System learns boundaries |
| US-6 | Reviewer | Edit the master prompt | Improve detection accuracy |
| US-7 | Dev team | Toggle between models in demo | Show client why we recommend specific model |

---

## Acceptance Criteria

### F-1: Document Upload

Build drag-drop file upload component.

**Input:** PDF or DOCX file, max 10MB

**Behavior:**
1. User drags file to drop zone (or clicks to browse)
2. Validate: PDF or DOCX only
3. Validate: Under 10MB
4. Extract text (use OCR for image-based PDFs)
5. Show upload progress
6. On complete: Store file, trigger analysis option

**Edge cases:**
- Invalid type → Show: "Only PDF and DOCX files supported"
- Too large → Show: "File must be under 10MB"
- OCR fails → Show: "Could not extract text from this PDF"

**Done when:**
- [ ] Accepts PDF files (text-based and image-based via OCR)
- [ ] Accepts DOCX files
- [ ] Rejects other file types with clear message
- [ ] Rejects files over 10MB
- [ ] Shows progress indicator during upload
- [ ] Extracted text ready for analysis

---

### F-2: Brand Guideline Selection

Build dropdown selector for brand context.

**UI:**
```
┌─────────────────────────────┐
│ Brand Guidelines      [▼]  │
├─────────────────────────────┤
│ ○ Novartis                  │
│ ○ Pfizer                    │
│ ○ Merck                     │
│ ○ Custom (upload)           │
└─────────────────────────────┘
```

**Behavior:**
1. Default: No selection (required before analysis)
2. Selection loads associated guidelines into context
3. Guidelines stored as uploadable docs (PDF/Word/mixed formats)
4. Different brand = different detection results

**Data model:**
```typescript
interface BrandGuideline {
  id: string;
  name: string;           // "Novartis"
  guidelineText: string;  // Extracted text from guideline docs
  createdAt: Date;
}
```

**Done when:**
- [ ] Dropdown shows available brands
- [ ] Selection persists during session
- [ ] Guidelines loaded into AI context on analysis
- [ ] Can upload custom guideline document

---

### F-3: AI Processing Pipeline

Build backend to send document + context to AI model.

**Request flow:**
```
[Document text] + [Brand guidelines] + [Master prompt]
    → [Selected AI model]
    → [Parse JSON response]
    → [Return structured claims]
```

**API endpoint:**

```
POST /api/analyze
```

**Request:**
```json
{
  "documentText": "string (extracted text)",
  "brandGuidelineId": "string",
  "model": "gemini-3" | "claude-opus" | "gpt-4o",
  "masterPrompt": "string (optional override)"
}
```

**Response (success):**
```json
{
  "claims": [
    {
      "id": "claim_001",
      "text": "Reduces symptoms by 50% in clinical trials",
      "confidence": 0.92,
      "location": {
        "paragraph": 3,
        "charStart": 145,
        "charEnd": 198
      }
    }
  ],
  "model": "gemini-3",
  "processingTimeMs": 2340,
  "promptTokens": 1500,
  "completionTokens": 800
}
```

**Response (error):**
```json
{
  "error": "Model timeout after 60 seconds",
  "code": "MODEL_TIMEOUT"
}
```

**Error codes:** `INVALID_DOCUMENT`, `MODEL_ERROR`, `MODEL_TIMEOUT`, `RATE_LIMITED`

**Done when:**
- [ ] Sends request to selected model API
- [ ] Combines document + guidelines + prompt correctly
- [ ] Parses JSON response into Claim objects
- [ ] Returns structured response with timing info
- [ ] Handles errors gracefully with codes
- [ ] Timeout set to 60 seconds max

---

### F-4: Claims Display

Build claims list UI with confidence visualization.

**Layout:**
```
┌─────────────────────────────────────────────────────┐
│ Claims Found (15)                    Sort: [Confidence ▼] │
├─────────────────────────────────────────────────────┤
│ ████████░░ 92%                                      │
│ "Reduces symptoms by 50% in clinical trials"        │
│                                        [👍] [👎]    │
├─────────────────────────────────────────────────────┤
│ ██████░░░░ 78%                                      │
│ "FDA approved for ages 18+"                         │
│                                        [👍] [👎]    │
├─────────────────────────────────────────────────────┤
│ ████░░░░░░ 54%                                      │
│ "May cause mild side effects"                       │
│                                        [👍] [👎]    │
└─────────────────────────────────────────────────────┘
```

**Visual rules:**
- Confidence >= 80%: Green bar
- Confidence 50-79%: Yellow bar
- Confidence < 50%: Red bar

**Sorting:** Default by confidence (highest first)

**Data model:**
```typescript
interface Claim {
  id: string;
  text: string;
  confidence: number;        // 0.0 to 1.0
  location: {
    paragraph: number;
    charStart: number;
    charEnd: number;
  };
  status: 'pending' | 'approved' | 'rejected';
  feedback?: string;         // Rejection reason
  reviewedAt?: Date;
}
```

**Done when:**
- [ ] Claims render as bulleted list
- [ ] Confidence shown as percentage + visual bar
- [ ] Color coding by confidence level
- [ ] Sorted by confidence (highest first)
- [ ] Shows total count in header

---

### F-5: Feedback Mechanism

Build thumbs up/down voting with optional rejection reason.

**Interaction flow:**
```
[👍 clicked] → status = 'approved' → Save to DB → Visual confirmation

[👎 clicked] → Expand feedback field:
┌─────────────────────────────────────────┐
│ Why isn't this a claim? (optional)      │
│ ┌─────────────────────────────────────┐ │
│ │                                     │ │
│ └─────────────────────────────────────┘ │
│                              [Submit]   │
└─────────────────────────────────────────┘
→ status = 'rejected' → Save feedback → Collapse
```

**API:**
```
PATCH /api/claims/{claimId}
```

**Request:**
```json
{
  "status": "approved" | "rejected",
  "feedback": "string (optional, for rejected)"
}
```

**Training data collection:**
- Approved claims → "What good claims look like"
- Rejected claims + feedback → "Boundaries to avoid"
- Stored for future model fine-tuning/prompt improvement

**Done when:**
- [ ] Thumbs up sets status to 'approved'
- [ ] Thumbs down expands feedback field
- [ ] Feedback field is optional
- [ ] Submit saves and collapses feedback
- [ ] Visual indication of reviewed status
- [ ] Data persisted for training purposes

---

### F-6: Prompt Editor

Build editable master prompt with reset option.

**UI:**
```
┌─────────────────────────────────────────────────────┐
│ Master Prompt                          [Reset Default] │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ You are a pharmaceutical claims detector.       │ │
│ │ Analyze the following document and identify     │ │
│ │ all medical/regulatory claims that would        │ │
│ │ require MLR approval...                         │ │
│ │                                                 │ │
│ │ [editable textarea, ~500 char visible]          │ │
│ └─────────────────────────────────────────────────┘ │
│                                    [Save] [Cancel]  │
└─────────────────────────────────────────────────────┘
```

**Behavior:**
1. Load default prompt on first use
2. User edits prompt
3. Save persists for session
4. Reset restores default
5. Prompt used in next analysis

**Done when:**
- [ ] Textarea shows current prompt
- [ ] Edits can be saved
- [ ] Reset restores default prompt
- [ ] Saved prompt used in subsequent analysis
- [ ] Prompt persisted across page refreshes

---

### F-7: Model Benchmarking + Demo Toggle

**Purpose:** Test all 3 models internally, determine best performer, recommend ONE to client. Demo toggle shows *why* during live presentations.

---

#### Part A: Benchmarking Plan (Pre-Demo)

**Goal:** Determine which model performs best before client demo.

**Test Protocol:**

```
For each test document (5+ documents):
  1. Run through Gemini 3 → Save results
  2. Run through Claude Opus 4.5 → Save results
  3. Run through GPT-4o → Save results
  4. Compare all 3 against human annotations
  5. Score each model
```

**Metrics to Track:**

| Metric | Formula | What It Measures |
|--------|---------|------------------|
| Precision | TP / (TP + FP) | "Of claims found, how many were real?" |
| Recall | TP / (TP + FN) | "Of real claims, how many did we find?" |
| F1 Score | 2 × (P × R) / (P + R) | Balance of precision and recall |
| Avg Confidence | Mean of confidence scores | Model's self-assessment |
| Processing Time | Milliseconds | Speed |
| Cost per Doc | Tokens × rate | API expense |

**Where:**
- TP = True Positives (AI found it, human agrees)
- FP = False Positives (AI found it, human says no)
- FN = False Negatives (AI missed it, human found it)

**Benchmark Results Table (to populate):**

| Model | Precision | Recall | F1 | Avg Time | Cost/Doc | Notes |
|-------|-----------|--------|-----|----------|----------|-------|
| Gemini 3 | -- | -- | -- | -- | -- | Vision/OCR strength |
| Claude Opus 4.5 | -- | -- | -- | -- | -- | Cost effective |
| GPT-4o | -- | -- | -- | -- | -- | Baseline |

**Winner Criteria:**
1. F1 Score >= 0.70 (primary)
2. Processing time < 30s (secondary)
3. Cost reasonable (tertiary)

---

#### Part B: Demo Toggle (For Client Presentations)

**Purpose:** During live demos, show client *why* we recommend Model X over Y and Z.

**UI (Internal/Demo Only):**
```
┌─────────────────────────────────────────────────────────┐
│ 🔧 Model Comparison (Demo Mode)                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [Gemini 3]    [Claude Opus]    [GPT-4o]               │
│     ●              ○               ○                    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ Results: 18 claims found                        │   │
│  │ Precision: 92%  |  Recall: 85%  |  F1: 0.88    │   │
│  │ Time: 2.3s  |  Cost: $0.04                      │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [Run All Models] → Side-by-side comparison            │
└─────────────────────────────────────────────────────────┘
```

**Demo Flow:**
1. Upload same document
2. Click "Run All Models"
3. Show side-by-side results:
   - Which claims each model found
   - Which claims were unique to one model
   - Which claims ALL models agreed on (high confidence)
   - Performance metrics comparison

**Side-by-Side View:**
```
┌──────────────────┬──────────────────┬──────────────────┐
│    Gemini 3      │   Claude Opus    │     GPT-4o       │
│    18 claims     │    15 claims     │    16 claims     │
├──────────────────┼──────────────────┼──────────────────┤
│ ✓ "Reduces..."   │ ✓ "Reduces..."   │ ✓ "Reduces..."   │
│ ✓ "FDA app..."   │ ✓ "FDA app..."   │ ✓ "FDA app..."   │
│ ✓ "Clinical..."  │ ✗ (missed)       │ ✓ "Clinical..."  │
│ ✓ "May cause..." │ ✓ "May cause..." │ ✗ (missed)       │
│ ⚠ "30% of..."    │ ✗ (missed)       │ ⚠ "30% of..."    │
└──────────────────┴──────────────────┴──────────────────┘

Legend: ✓ = Found (matches human)  ✗ = Missed  ⚠ = Found (human didn't mark)
```

**Demo Script:**
1. "We tested 3 leading AI models on your documents"
2. "Here's the same document analyzed by each"
3. Toggle between models → "Notice Gemini caught this claim the others missed"
4. Show metrics → "Gemini achieved 88% F1 score vs 79% for the others"
5. "Based on our testing, we recommend Gemini 3 for your use case"

---

#### Part C: Data Model for Benchmarking

```typescript
interface BenchmarkRun {
  id: string;
  documentId: string;
  documentName: string;
  model: 'gemini-3' | 'claude-opus' | 'gpt-4o';
  claims: Claim[];
  metrics: {
    precision: number;
    recall: number;
    f1Score: number;
    processingTimeMs: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCost: number;
  };
  comparedToHuman: {
    truePositives: number;
    falsePositives: number;
    falseNegatives: number;
  };
  runAt: Date;
}

interface BenchmarkComparison {
  documentId: string;
  runs: BenchmarkRun[];  // One per model
  winner: 'gemini-3' | 'claude-opus' | 'gpt-4o';
  winnerReason: string;
}
```

---

#### Part D: Implementation Approach

**Phase 1: Manual Benchmarking (Before Demo)**
```bash
# Run benchmarks via CLI/script
node scripts/benchmark.js --document=test1.pdf --model=all
```

Output: JSON file with results for each model

**Phase 2: Demo Toggle (For Presentations)**
- Hidden toggle in UI (not for end users)
- Accessible via URL param: `?demo=true`
- Shows model switcher and comparison view

**Phase 3: Final Product**
- Remove toggle
- Hardcode winning model
- Single clean UI for end users

---

**Done when:**
- [ ] Can run same document through all 3 models
- [ ] Results saved with metrics (precision, recall, F1)
- [ ] Side-by-side comparison view works
- [ ] Metrics calculated against human annotations
- [ ] Demo toggle accessible via `?demo=true`
- [ ] Benchmark results exportable (CSV/JSON)
- [ ] Clear winner identified with data to support recommendation

---

## Technical Requirements

### Stack

| Layer | Technology | Reason |
|-------|------------|--------|
| Frontend | React/Next.js | Rapid prototyping |
| Backend | Next.js API routes or Python FastAPI | Simple deployment |
| Database | SQLite or PostgreSQL | Store claims, feedback |
| File Storage | Local /uploads/ or S3 | Document storage |
| OCR | pdf-parse + Tesseract (for images) | PDF text extraction |

### AI Model APIs

| Model | Provider | API Key Env Var |
|-------|----------|-----------------|
| Gemini 3 | Google | `GOOGLE_AI_KEY` |
| Claude Opus 4.5 | Anthropic | `ANTHROPIC_API_KEY` |
| GPT-4o | OpenAI | `OPENAI_API_KEY` |

### File Structure

```
/claims_detector
  /src
    /components
      FileUpload.tsx
      BrandSelector.tsx
      ClaimsList.tsx
      ClaimCard.tsx
      FeedbackForm.tsx
      PromptEditor.tsx
      ModelSelector.tsx
      ConfidenceBadge.tsx
    /pages (or /app for Next.js 13+)
      index.tsx           # Main UI
      /api
        analyze.ts        # POST /api/analyze
        claims/[id].ts    # PATCH /api/claims/:id
    /lib
      ocr.ts              # PDF text extraction
      models/
        gemini.ts
        claude.ts
        openai.ts
      prompts.ts          # Default prompt template
    /types
      claim.ts
      analysis.ts
  /uploads                # Uploaded documents
  /docs
    /briefs               # This file
```

### Environment Variables

```env
GOOGLE_AI_KEY=xxx
ANTHROPIC_API_KEY=xxx
OPENAI_API_KEY=xxx
DATABASE_URL=xxx
```

---

## Data Flow

```
1. [User uploads PDF/DOCX]
      ↓
2. [Extract text (OCR if needed)]
      ↓
3. [User selects brand guidelines]
      ↓
4. [User selects AI model]
      ↓
5. [Click "Analyze"]
      ↓
6. [Backend: Combine doc + guidelines + prompt]
      ↓
7. [Send to AI model API]
      ↓
8. [Parse JSON response → Claim objects]
      ↓
9. [Display claims sorted by confidence]
      ↓
10. [User reviews: thumbs up/down]
      ↓
11. [Save feedback for training]
```

---

## Dependencies

### Blocking (Need Before Starting)

| Dependency | Owner | Status |
|------------|-------|--------|
| GitHub repo access | Carm | Pending |
| API keys (Gemini, Claude, OpenAI) | Carm | Pending |
| Brand guidelines docs | Nick (MKG) | Pending kickoff call |
| Test documents (5+ with annotations) | Nick (MKG) | Pending kickoff call |
| CI/CD setup (Voltus) | Carm/Voltus | Pending repo |

### Non-Blocking (Nice to Have)

| Dependency | Owner | When Needed |
|------------|-------|-------------|
| Additional brand guidelines | Nick | During testing |
| More test documents | Nick | Model benchmarking |

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Brand guidelines are image-heavy PDFs | High | Medium | Test Gemini 3 vision; may need preprocessing |
| Single test doc leads to overfitting | High | High | Request 5+ diverse docs |
| 70-80% accuracy not achievable | Medium | High | POC designed to test this; set expectations |
| Holiday delays | High | Low | Plan for January launch |
| Scope creep from Nick | Medium | Medium | Carm manages; changes = cost conversation |

---

## Open Questions

- [ ] Exact accuracy threshold for success? (70%? 80%?) - Ask: Nick
- [ ] Brand guidelines format - images or text? - Ask: Nick
- [ ] How are human annotations formatted in test docs? - Ask: Nick
- [ ] Which brand(s) for initial testing? - Ask: Nick

---

## Timeline

| Phase | Activities |
|-------|------------|
| Pre-Kickoff | Model testing, planning, architecture |
| Discovery Call | Meet Nick, gather materials, set expectations |
| Development | 8 days - Build POC features |
| Review | 5 days - QA, client feedback, refinements |
| Launch | Likely January (holiday delays expected) |

---

## Next Steps

| Action | Owner | Due |
|--------|-------|-----|
| Send list of required access/API keys | Wally | Immediately |
| Create GitHub repo + account | Carm | This week |
| Set up CI/CD | Voltus | After repo |
| Schedule kickoff call with Nick | Flamur | ASAP |
| Begin model testing | Wally | Immediately |
| Gather brand guidelines + test docs | Nick | Kickoff call |

---

## Quick Start for Claude Code

To begin prototyping, run these commands:

```bash
# Create Next.js app
npx create-next-app@latest claims-detector --typescript --tailwind --app

# Install dependencies
npm install pdf-parse mammoth tesseract.js openai @anthropic-ai/sdk

# Create file structure
mkdir -p src/components src/lib/models src/types uploads
```

Then start with F-1 (File Upload) and work through features sequentially.
