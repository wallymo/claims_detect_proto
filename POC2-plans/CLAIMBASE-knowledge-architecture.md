# ClaimBase: MLR Knowledge Architecture

> From Detection to Verification - Building Deterministic Claim Analysis

## Executive Summary

**Problem:** AI claim detection is probabilistic. The model "guesses" what requires substantiation based on general pharmaceutical knowledge, leading to variable results between runs.

**Solution:** ClaimBase - a structured knowledge base that transforms claim detection into claim verification. Instead of guessing, the model matches against known patterns, approved language, and historical decisions.

**Outcome:** Consistent, auditable results that improve over time as the MLR team's decisions become training data.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLAIMBASE SYSTEM                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐          │
│  │   INGEST     │───▶│   MATCH      │───▶│   VERIFY     │          │
│  │   Document   │    │   Claims     │    │   Against KB │          │
│  └──────────────┘    └──────────────┘    └──────────────┘          │
│         │                   │                   │                   │
│         ▼                   ▼                   ▼                   │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                   KNOWLEDGE BASE                         │       │
│  ├─────────────────────────────────────────────────────────┤       │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │       │
│  │  │  Approved   │  │  Reference  │  │  Historical │      │       │
│  │  │  Language   │  │  Documents  │  │  Decisions  │      │       │
│  │  │  Library    │  │  Citations  │  │  Patterns   │      │       │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │       │
│  └─────────────────────────────────────────────────────────┘       │
│         │                   │                   │                   │
│         ▼                   ▼                   ▼                   │
│  ┌─────────────────────────────────────────────────────────┐       │
│  │                   FEEDBACK LOOP                          │       │
│  │      MLR Review → Decision Logged → Model Improves       │       │
│  └─────────────────────────────────────────────────────────┘       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Knowledge Base Components

### 1. Approved Language Library (ALL)

Pre-approved claim language that has passed MLR review.

```typescript
interface ApprovedClaim {
  id: string
  text: string                    // Exact approved wording
  variants: string[]              // Acceptable variations
  category: ClaimCategory         // efficacy | safety | comparative | etc.
  therapeutic_area: string        // Oncology, Cardiology, etc.
  product: string | null          // Product-specific or general
  substantiation_ref: string      // Link to supporting reference
  approval_date: Date
  expiry_date: Date | null        // Some approvals expire
  restrictions: string[]          // Usage restrictions
  reviewer_notes: string
}
```

**Use Case:** When a claim is detected, first check if it matches approved language. If yes → auto-approve with high confidence.

### 2. Reference Document Index (RDI)

Searchable index of substantiation documents.

```typescript
interface ReferenceDocument {
  id: string
  title: string
  type: 'clinical_trial' | 'meta_analysis' | 'regulatory' | 'guideline' | 'label'
  citation: string                // Formatted citation
  publication_date: Date
  therapeutic_area: string[]
  products: string[]

  // Chunked content for RAG
  chunks: {
    text: string
    embedding: number[]           // Vector embedding for similarity search
    page: number
    section: string
  }[]

  // Extracted claims this document can substantiate
  substantiates: {
    claim_pattern: string         // Regex or semantic pattern
    excerpt: string               // Supporting text
    strength: 'direct' | 'indirect' | 'partial'
  }[]
}
```

**Use Case:** When a claim needs substantiation, search RDI for matching references. Return with confidence based on match strength.

### 3. Historical Decision Patterns (HDP)

Learned patterns from past MLR reviews.

```typescript
interface DecisionPattern {
  id: string
  claim_pattern: string           // Semantic pattern (not exact text)
  embedding: number[]             // Vector for similarity matching

  historical_decisions: {
    claim_text: string
    decision: 'approved' | 'rejected' | 'modified'
    reason: string
    reviewer: string
    date: Date
    context: string               // Document type, therapeutic area
  }[]

  // Aggregated insights
  approval_rate: number           // % approved historically
  common_issues: string[]         // Why claims like this get rejected
  suggested_modifications: string[] // How to fix common problems
}
```

**Use Case:** For novel claims, find similar historical patterns. Show reviewer: "Claims like this are approved 73% of the time. Common issues: [list]"

---

## Matching Algorithm

### Phase 1: Exact Match
```
Detected Claim → Approved Language Library
└─ If exact/variant match found → AUTO-APPROVE (confidence: 0.95+)
```

### Phase 2: Semantic Match
```
Detected Claim → Vector Embedding → Similarity Search
├─ Search Approved Language (threshold: 0.85)
├─ Search Reference Documents (threshold: 0.80)
└─ Search Historical Patterns (threshold: 0.75)
```

### Phase 3: Novel Claim Analysis
```
No strong matches found → Full AI Analysis
├─ Flag as "Novel Claim - Requires Review"
├─ Suggest similar approved alternatives
├─ Identify potential references for substantiation
└─ Show historical patterns for guidance
```

---

## Confidence Scoring

| Match Type | Confidence Range | Reviewer Action |
|------------|------------------|-----------------|
| Exact approved language | 0.95 - 1.00 | Auto-approve, audit trail |
| Semantic match to approved | 0.85 - 0.94 | Quick review, likely approve |
| Reference substantiation found | 0.70 - 0.84 | Review reference match |
| Historical pattern match | 0.50 - 0.69 | Full review with guidance |
| Novel claim | 0.30 - 0.49 | Full review, no guidance |

---

## Training Flywheel

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│    ┌─────────┐      ┌─────────┐      ┌─────────┐           │
│    │ Detect  │─────▶│ Review  │─────▶│  Log    │           │
│    │ Claims  │      │ (Human) │      │Decision │           │
│    └─────────┘      └─────────┘      └─────────┘           │
│         ▲                                  │                │
│         │                                  ▼                │
│    ┌─────────┐      ┌─────────┐      ┌─────────┐           │
│    │ Better  │◀─────│ Retrain │◀─────│ Curate  │           │
│    │ Results │      │ Model   │      │ Data    │           │
│    └─────────┘      └─────────┘      └─────────┘           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Feedback Capture Points

1. **Claim Approval/Rejection** - Decision + reason logged
2. **Claim Modification** - Original vs. approved version
3. **Reference Assignment** - Which ref substantiated which claim
4. **Reviewer Notes** - Contextual guidance for future

### Retraining Triggers

- Every 100 new decisions
- Weekly batch processing
- On-demand for high-priority corrections

---

## Technical Implementation

### Vector Database
- **Recommended:** Pinecone, Weaviate, or pgvector (Postgres)
- **Embedding Model:** OpenAI text-embedding-3-large or Cohere embed-v3
- **Index Strategy:** Separate indices for approved claims, references, patterns

### Storage Schema (Postgres + pgvector)

```sql
-- Approved claims with vector search
CREATE TABLE approved_claims (
  id UUID PRIMARY KEY,
  text TEXT NOT NULL,
  embedding VECTOR(1536),
  category VARCHAR(50),
  therapeutic_area VARCHAR(100),
  product VARCHAR(100),
  substantiation_ref UUID REFERENCES reference_documents(id),
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  metadata JSONB
);

-- Reference documents
CREATE TABLE reference_documents (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  citation TEXT,
  doc_type VARCHAR(50),
  content_chunks JSONB,  -- [{text, embedding, page, section}]
  created_at TIMESTAMP DEFAULT NOW()
);

-- Historical decisions for pattern learning
CREATE TABLE review_decisions (
  id UUID PRIMARY KEY,
  claim_text TEXT NOT NULL,
  claim_embedding VECTOR(1536),
  decision VARCHAR(20),  -- approved, rejected, modified
  modified_text TEXT,
  reason TEXT,
  reviewer_id UUID,
  document_id UUID,
  therapeutic_area VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Similarity search index
CREATE INDEX ON approved_claims
  USING ivfflat (embedding vector_cosine_ops);
```

### API Endpoints

```typescript
// Claim verification endpoint
POST /api/claims/verify
{
  claims: [{ text, page, position }],
  document_context: { therapeutic_area, product }
}
Response: {
  claims: [{
    text,
    match_type: 'exact' | 'semantic' | 'reference' | 'historical' | 'novel',
    confidence: number,
    matched_approved?: ApprovedClaim,
    matched_references?: ReferenceDocument[],
    historical_patterns?: DecisionPattern[],
    suggested_action: 'auto_approve' | 'quick_review' | 'full_review'
  }]
}

// Feedback endpoint
POST /api/claims/decision
{
  claim_id: string,
  decision: 'approved' | 'rejected' | 'modified',
  modified_text?: string,
  reason: string,
  reference_id?: string
}

// Knowledge base management
POST /api/knowledge/approved-claims    // Add approved language
POST /api/knowledge/references         // Index new reference
GET  /api/knowledge/search             // Semantic search
```

---

## Migration Path from POC1

### Phase 2A: Foundation (4-6 weeks)
- Set up vector database (pgvector recommended for simplicity)
- Build embedding pipeline for documents
- Create approved language CRUD interface
- Basic semantic search API

### Phase 2B: Integration (4-6 weeks)
- Integrate ClaimBase into detection flow
- Add match type to claim results
- Build reviewer feedback capture
- Dashboard for knowledge base management

### Phase 2C: Learning Loop (4-6 weeks)
- Historical pattern extraction from decisions
- Confidence calibration based on feedback
- Automated retraining pipeline
- Analytics on detection vs. verification rates

---

## Success Metrics

| Metric | POC1 (Current) | POC2 Target |
|--------|----------------|-------------|
| Result consistency | ~70% similar | >95% similar |
| Auto-approve rate | 0% | 30-40% |
| Review time per claim | Baseline | -50% |
| False positive rate | Unknown | <10% |
| Knowledge base coverage | 0 | 500+ approved claims |

---

## Client Value Proposition

> "Every review makes the system smarter. Your MLR team's expertise becomes institutional knowledge that scales across all future reviews. The more you use it, the more consistent and efficient it becomes."

### ROI Drivers
1. **Reduced review time** - Auto-approve known good claims
2. **Consistency** - Same claim always gets same treatment
3. **Audit trail** - Every decision logged and traceable
4. **Onboarding** - New reviewers guided by historical patterns
5. **Compliance** - Demonstrate systematic review process

---

## Open Questions for POC2 Planning

1. **Initial corpus:** What approved language/references exist today?
2. **Integration depth:** Replace detection or augment it?
3. **Multi-tenant:** Separate knowledge bases per client?
4. **Regulatory:** Data retention and audit requirements?
5. **Hosting:** Cloud vs. on-premise for sensitive data?

---

*Document version: 1.0*
*Created: 2025-01-12*
*Author: Claude + Claims Detector Team*
