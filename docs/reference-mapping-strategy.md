# Reference Mapping Strategy — Full Technical Detail

## The Problem We're Solving

When the AI detects a claim like *"Drug X showed 47% reduction in seizure frequency vs placebo (p<0.001)"*, a human MLR reviewer needs to verify that claim is backed by an approved reference document. Today they manually dig through dozens of PDFs to find the source. We automate that lookup.

## Two-Phase Architecture

The mapping happens in **two distinct phases** that run sequentially:

---

## Phase 1: Fact Indexing (Backend, Offline)

**When it runs:** Either batch via `node scripts/index-references.js`, or automatically when a new reference PDF is uploaded.

**What it does:** Pre-extracts every substantiable fact from each reference document and stores them as structured JSON in SQLite.

**Tech:**
- **Model:** Gemini 3 Flash (`backend/src/services/factExtractor.js`)
- **Chunking:** Documents are split into ~24,000 character chunks with 1,200 char overlap (roughly 4,000 words per chunk). This is because a single reference PDF can be 50+ pages and would blow Gemini's input limits.
- **Deduplication:** After all chunks are processed, facts are deduped by comparing the first 80 characters of each fact's text (lowercased). This catches the overlap zone where chunks repeat the same data.

**What Gemini extracts per fact:**
```json
{
  "id": "fact_001",
  "text": "Drug X showed 47% reduction in seizure frequency vs placebo (p<0.001, N=1,200)",
  "category": "efficacy",
  "keywords": ["47%", "seizure frequency", "placebo", "p<0.001"],
  "page": 3
}
```

**8 fact categories:** efficacy, safety, dosage, mechanism, population, endpoint, statistical, regulatory.

**Storage:** `reference_facts` table in SQLite. One row per reference document. The `facts_json` column stores the full array. Also tracks `extraction_status` (pending/indexing/indexed/failed), `confirmed_count`, `rejected_count`, and `model_used`.

**Rate limiting:** Batch script waits 1 second between references to avoid Gemini API throttling.

---

## Phase 2: Claim-to-Reference Matching (Frontend, Runtime)

**When it runs:** After claim detection completes on a user-uploaded document. Each detected claim goes through the three-tier pipeline sequentially (`app/src/services/referenceMatching.js`).

**Inputs:**
- Array of detected claims (from detection step)
- All reference documents for the selected brand (with their `content_text`)
- Pre-extracted facts for the brand (from the indexing phase)

---

### Tier 0: Direct Fact Keyword Lookup (No AI Call)

**Purpose:** Instant match if a claim closely mirrors a pre-extracted fact. Avoids an AI call entirely.

**How it works:**
1. Extract keywords from the claim text (strip stop words, lowercase, dedupe)
2. Loop through every fact from every indexed reference in the brand
3. For each fact, check how many of the fact's keywords appear in the claim text
4. Score = `(keywords found in claim) / (total fact keywords)`
5. Apply feedback weighting:
   - If the reference has been confirmed by reviewers and never rejected: **+10% boost** (`score *= 1.1`)
   - If the reference has been rejected more than confirmed: **-20% penalty** (`score *= 0.8`)
6. If best score >= **0.75** (75% keyword overlap), return immediately with the match

**What gets returned on Tier 0 match:**
```javascript
{
  matched: true,
  matchConfidence: 0.85,
  matchTier: 0,
  reference: {
    id: 42,
    name: "STUDY-XYZ Prescribing Information",
    page: 3,
    excerpt: "Drug X showed 47% reduction in seizure frequency..."
  },
  matchReasoning: "Direct fact match (85% keyword overlap): \"Drug X showed 47%...\""
}
```

**Why this matters:** With 54 reference documents and potentially hundreds of extracted facts, most common claims (efficacy numbers, safety stats, dosage info) hit here without ever touching the AI. This saves API cost and time.

---

### Tier 1: Keyword Pre-Filter (No AI Call)

**Purpose:** If Tier 0 didn't match, narrow 54 references down to the top 5-8 candidates so we don't send all 54 to Gemini.

**How it works:**
1. Extract keywords from the claim text (same stop-word removal)
2. For each reference, score keyword overlap: `(claim keywords found in reference full text) / (total claim keywords)`
3. Sort by score descending, take top 8
4. Filter out any with score = 0 (no overlap at all)

**If zero references pass the filter:** The claim is returned as unmatched with reasoning: *"No keyword overlap with any reference document"*. No AI call is made.

**Text truncation:** Each reference's `content_text` is truncated to **2,000 characters** before being sent to Tier 2. This keeps token usage manageable when passing 5-8 references.

---

### Tier 2: Gemini AI Matching (1 AI Call per Claim)

**Purpose:** Semantic understanding. Tier 1 found candidate references, now Gemini reads them and decides which one (if any) actually substantiates the claim.

**Tech:**
- **Model:** Gemini (same model as detection, configured in `gemini.js`)
- **Temperature:** 0 (deterministic as possible)
- **Response format:** `application/json` (structured output)
- **Max output:** 2,048 tokens

**The prompt sends:**
- The exact claim text
- A numbered list of filtered references (name + 2,000 char excerpt each)
- Instructions to return a match only if the reference *actually substantiates* the claim

**What Gemini returns:**
```json
{
  "matched": true,
  "referenceIndex": 3,
  "referenceName": "STUDY-XYZ Full Prescribing Information",
  "confidence": 0.87,
  "supportingExcerpt": "In the Phase III trial, patients receiving Drug X showed a 47% reduction...",
  "pageInReference": "Page 12, Section 14.1",
  "reasoning": "The claim cites the same primary endpoint data from the Phase III trial described in this reference."
}
```

**Key design decision:** The prompt says *"A low confidence match is better than a false positive."* We'd rather return `matched: false` than point a reviewer to the wrong reference.

---

## How Facts Feed Back Into Detection (Not Just Matching)

This is the part most people miss. The pre-extracted facts don't just help with matching — they also improve **claim detection** itself.

Before the AI scans the uploaded document, the frontend:
1. Fetches the fact summary for the selected brand
2. Loads the full facts for every indexed reference
3. Builds a condensed inventory string like:
```
REFERENCE FACT INVENTORY (use these known facts to identify substantiable claims):
- [Prescribing Info] Drug X showed 47% reduction in seizure frequency vs placebo (p<0.001) | efficacy
- [Safety Report] Most common adverse events: headache (12%), nausea (8%), dizziness (6%) | safety
- [Dosing Guide] Recommended dose: 200mg twice daily, titrate over 2 weeks | dosage
```
4. Appends this to the detection prompt sent to Gemini/GPT-4o/Claude

This means the detection AI knows what facts exist in the brand's reference library *before* it scans the document. It can recognize claims that reference those specific data points even if the document uses slightly different wording.

---

## Sequential Processing & Progress

Claims are matched **one at a time** (not in parallel) to avoid API rate limits. The `matchAllClaimsToReferences()` function takes an `onProgress` callback so the UI can show *"Matching claim 3 of 12..."* during processing.

---

## Stats

After all claims are matched, `getMatchingStats()` computes:
- Total claims, matched count, unmatched count
- Match rate as percentage
- Average confidence across matched claims

---

## The Feedback Loop

When a reviewer approves or rejects a claim's reference match, that feedback is stored in `claim_feedback` (backend). For fact-level feedback, `reference_facts` tracks `confirmed_count` and `rejected_count`. These counts directly affect Tier 0 scoring on future runs — confirmed references get boosted, repeatedly-rejected ones get penalized. Over time, the system learns which references are reliable sources for specific types of claims.

---

## Key Source Files

| File | Role |
|------|------|
| `backend/src/services/factExtractor.js` | Gemini fact extraction with chunking and dedup |
| `backend/src/models/ReferenceFact.js` | SQLite model for facts storage and queries |
| `backend/migrations/003_reference_facts.sql` | Facts table schema |
| `backend/scripts/index-references.js` | Batch indexing script |
| `app/src/services/referenceMatching.js` | Three-tier matching pipeline (Tier 0/1/2) |
| `app/src/services/gemini.js` | `matchClaimToReferences()` (Tier 2 AI call) + `analyzeDocument()` with fact inventory |
| `app/src/pages/MKG2ClaimsDetector.jsx` | Orchestrates detection → fact loading → matching flow |
