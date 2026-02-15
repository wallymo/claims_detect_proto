# POC2 SOW Alignment Assessment

**Date:** February 13, 2026
**SOW Reference:** MKG Claims Detector Data Mapping POC2 (February 6, 2026)

## Executive Summary

All scope of work items are fully implemented. Five of six deliverables are built. The remaining deliverable (benchmark summary) will be produced through manual accuracy validation using annotated test documents provided by MKG.

## Scope of Work Alignment

### Brand-Based Content Repository — Complete

| Requirement | Status |
|---|---|
| Upload client-specific reference documents (PI, supporting materials) | Done — drag-drop upload in Library tab + brand creation modal |
| Documents associated to a specific brand | Done — `reference_documents` table with `brand_id` FK |
| Support for PDF and Word documents | Done — pdf-parse + mammoth extraction |

### Brand-Aware Claim Detection — Complete

| Requirement | Status |
|---|---|
| Users select brand prior to running claim detection | Done — brand dropdown in settings panel |
| Detector uses brand documents for contextual accuracy | Done — pre-extracted fact inventory appended to AI prompts |
| Claims identified with brand-specific language awareness | Done — 8 fact categories (efficacy, safety, dosage, mechanism, population, endpoint, statistical, regulatory) inform detection |

### Claim-to-Reference Mapping — Complete

| Requirement | Status |
|---|---|
| Each claim mapped to relevant reference content | Done — 3-tier pipeline: Tier 0 fact lookup → Tier 1 keyword pre-filter → Tier 2 AI matching |
| Click mapped reference to open source document | Done — "View Source" opens PDF overlay with page + excerpt |
| Verify whether claim is correctly supported | Done — reference excerpt shown inline on claim card |

### Claim Feedback Loop — Complete

| Requirement | Status |
|---|---|
| Structured feedback mechanism | Done — approve/reject with optional reason |
| Confirm positive detections | Done — approve button on each claim card |
| Reject detections with optional reason | Done — reject button opens modal with reason field |
| Feedback stored | Done — `claim_feedback` table in SQLite |
| Feedback refines future behavior | Partial — fact-level feedback affects Tier 0 match weighting; claim-level feedback stored but not yet used for active retraining (appropriate for POC) |

### User Interface Enhancements — Complete

| Requirement | Status |
|---|---|
| Brand selection prior to analysis | Done — settings accordion |
| Claim list with mapped references | Done — Claims tab with reference info per card |
| Click-through to supporting documents | Done — PDF viewer overlay |
| Simple feedback controls | Done — approve/reject on each claim |

### Access and Hosting — Partial

| Requirement | Status |
|---|---|
| Hosted on Hedgehox servers | Done — hosted on Vercel |
| Password protected endpoint | Not implemented — no authentication system |

## Deliverables Status

| Deliverable | Status |
|---|---|
| Functional POC hosted | Done (Vercel) |
| Benchmark summary identifying best model | **Pending** — will be produced through validation |
| Claim detection interface | Done |
| Prompt modification panel | Done (Master Prompt accordion) |
| JSON-based claim extraction and display | Done |
| Approval/rejection tracking system | Done |

## Success Criteria — Pending Validation

| Criterion | Target | Status |
|---|---|---|
| Claim detection accuracy | >90% | Not yet measured |
| Claim-to-reference mapping accuracy | >70% | Not yet measured |

## Validation Plan

**Approach:** Manual validation using annotated test documents.

1. MKG has provided annotated PDFs with highlighted claims and reference citations (the "answer key")
2. Clean (un-annotated) versions of the same documents are available
3. Clean documents will be run through POC2 with the brand's reference library loaded
4. The AI uses the reference library as a "cheat sheet" to detect claims and map them to references
5. Results are manually compared against annotated answer keys
6. Approve/reject controls serve as the scoring mechanism
7. Repeated across all 3 models (Gemini, Claude, GPT-4o) to identify best performer

**Metrics to capture per model:**
- **Detection recall:** Ground truth claims found by AI / total ground truth claims (target: >90%)
- **Detection precision:** Correct AI detections / total AI detections (informational)
- **Mapping accuracy:** Correct reference mappings / total matched claims (target: >70%)

**Output:** Benchmark summary document comparing model performance — completes the final deliverable.

## Built Beyond SOW

These capabilities were not in the original SOW but add value:

- **Three-tier matching pipeline** — Tier 0 fact lookup provides instant matches without AI cost
- **Reference fact indexing** — Gemini pre-extracts structured facts from each reference (8 categories)
- **Folder organization** — References can be organized into folders
- **Multi-model support** — Gemini, Claude, GPT-4o all available (SOW didn't specify multiple models)
- **Cost tracking** — Per-analysis cost displayed in UI
- **PDF viewer with claim pins** — x/y coordinate overlay shows claim locations on document
- **Editable reference display names** — Clean up auto-generated names

## Remaining Gap

**Password protection** — SOW specifies a password-protected endpoint. No authentication exists. This should be addressed before granting MKG team access for evaluation.
