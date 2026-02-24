# Claims Detector: MLR pre-screening platform

## The problem

Before pharma promo materials can go to market, MLR reviewers read every slide, check each claim against approved source documents, and flag anything unsupported. This takes hours per deck. Miss a claim and the client risks an FDA warning letter. Over-flag and you've burned a reviewer's afternoon on nothing.

Claims Detector runs AI over the document, pulls out the claims, and matches them to the brand's approved references. Reviewers get a prioritized list instead of a blank document. They still make the call. They just don't start from zero.

### Why it matters

Reviewers miss things when they're tired. AI doesn't get tired. It reads text, charts, tables, footnote markers, speaker notes. Multiple models cross-check each other's work. In testing, what used to take hours of manual reading takes minutes, and we measure accuracy against annotated answer keys from the review team so the numbers are real.

---

## What the prototype already does

The prototype is live. This is what it does right now.

### Upload and scan

Upload a PDF (promo deck, leave-behind, whatever goes through MLR). The AI reads it and returns a list of detected claims, each with a confidence score and its location in the document.

### Visual detection

The AI doesn't just read text. It scans charts, graphs, tables, and data visualizations. A bar chart showing "47% reduction in symptoms" is a claim, and the system catches it. It also flags annotation markers (daggers, asterisks, double daggers) that link to footnotes, since those often contain regulatory language.

### Brand reference library

Each brand gets its own reference library: package inserts, clinical trial data, supporting materials. Upload them once, and the system uses them as the source of truth when matching claims. The AI pre-indexes every reference document, extracting structured facts across eight categories (efficacy, safety, dosage, mechanism, population, endpoints, statistical findings, regulatory status).

### Claim-to-reference matching

When a claim is detected, the system searches the brand's reference library for supporting evidence. It uses a three-tier pipeline: instant fact lookup (no AI cost), keyword search to narrow candidates, then AI confirmation with hybrid scoring that weighs semantic similarity, keyword overlap, and numeric precision. Each matched claim shows the source document, the relevant passage, and the page number. Reviewers can click through to the original PDF. When clicked through, the PDF shows highlighted supporting text for the claim it's supporting.

### Reviewer feedback loop

Every approve, reject, and missed-claim report becomes a training label. On the next run, the AI sees what reviewers confirmed, what it got wrong, and what it missed entirely. These labels are scoped three ways: same document (highest priority), same brand, and cross-brand (so a pattern caught on one brand informs detection on another). No model retraining required. The AI gets smarter through better instructions, not new weights.

### Interactive document viewer

The PDF viewer shows claim locations as pins on the actual document pages. Reviewers can zoom, pan, and click any pin to jump to that claim's details.

---

## The full application

Everything below ships in the final product. Features marked **[Live]** are working in the current prototype. Features marked **[Planned]** will be built during the development engagement.

### 1. Document intake

- **[Live]** PDF upload with drag-and-drop
- **[Live]** Multi-page document support with page-by-page rendering
- **[Planned]** Batch upload (queue multiple documents for sequential processing)
- **[Planned]** Microsoft PowerPoint (.pptx) native support (no PDF conversion needed)
- **[Planned]** Word document (.docx) support for narrative promo materials
- **[Planned]** Email/HTML promo material support
- **[Planned]** Automatic document type identification

### 2. AI claim detection

- **[Live]** Full-text claim detection with confidence scoring (0-100%)
- **[Live]** Visual claim detection in charts, graphs, tables, and data visualizations
- **[Live]** Annotation marker detection (daggers, asterisks, superscripts linking to footnotes)
- **[Live]** Speaker notes and slide region awareness (deduplication built in)
- **[Live]** Document type selection
- **[Live]** Customizable detection prompts (reviewers can adjust what the AI looks for)
- **[Planned]** Claim categorization by type (efficacy, safety, comparative, statistical, regulatory)
- **[Planned]** Historical claim tracking (has this exact claim appeared in previous submissions)

### 3. Reference library management

- **[Live]** Brand-scoped reference libraries (each product gets its own set of approved sources)
- **[Live]** PDF upload with text extraction
- **[Live]** Folder organization with bulk move/archive/delete
- **[Live]** Soft delete with trash/restore (nothing is permanently lost by accident)
- **[Live]** AI-powered fact indexing across eight categories per reference
- **[Live]** Semantic embeddings for intelligent passage search
- **[Live]** Editable display names for uploaded references
- **[Planned]** Version control for references (track when a PI is updated, flag claims against outdated versions)
- **[Planned]** Expiration dates on references (auto-flag when supporting docs are past their review date)
- **[Planned]** Reference sharing across brands (for shared class-level data)

### 4. Claim-to-reference matching

- **[Live]** Three-tier matching pipeline (fact lookup, keyword pre-filter, AI confirmation)
- **[Live]** Hybrid scoring: semantic similarity, keyword overlap, numeric precision
- **[Live]** Diversity selection (returns varied supporting evidence, not just the top-scoring single match)
- **[Live]** Click-through to source document with page number and highlighted passage
- **[Live]** Match confidence tiers (high-confidence, auto-confirmed, direct, keyword fallback)
- **[Live]** Add missed claims through pinpoint feature
- **[Planned]** Bulk re-matching when new references are added to a library
- **[Planned]** Match explanation (plain-English summary of why a reference was selected)
- **[Planned]** Negative matching (flag claims where no supporting reference exists in the library)
- **[Planned]** Highlight text directly in the application when adding a missed claim and its supporting reference PDF

### 5. Review workflow

- **[Live]** Approve/reject controls on each claim with structured rejection reasons
- **[Live]** Claim filtering by status, type, confidence level, and free-text search
- **[Live]** Sorting by confidence (high-to-low, low-to-high)
- **[Live]** Missed claim reporting (reviewers flag claims the AI didn't catch)
- **[Live]** Training data export (approved/rejected claims exportable as structured data)
- **[Planned]** Reviewer assignment (assign documents to specific team members)
- **[Planned]** Review status dashboard (progress across all pending documents)
- **[Planned]** Comment threads on individual claims (reviewer-to-reviewer discussion)
- **[Planned]** Review completion sign-off (formal "this document has been pre-screened" stamp)

### 6. Analytics and reporting

- **[Planned]** Detection accuracy dashboards (precision/recall tracked over time)
- **[Planned]** Reviewer productivity metrics (documents reviewed, time per document, claims per document)
- **[Planned]** Monthly/quarterly reporting exports
- **[Planned]** Trend analysis (are certain claim types increasing across submissions)

### 7. Administration

- **[Planned]** User authentication and role-based access (admin, reviewer, viewer)
- **[Planned]** SSO integration (SAML/OAuth for enterprise environments)
- **[Planned]** Audit trail (who reviewed what, when, and what they decided)
- **[Planned]** Brand/team permissions (control who can access which brand libraries)
- **[Planned]** Custom branding (client logo, color scheme)

### 8. Exportables

- **[Planned]** Export document with annotations directly on PDF for submission

### 9. Infrastructure

- **[Live]** Cloud-hosted (currently Vercel, portable to any cloud provider)
- **[Live]** Automatic database migrations
- **[Planned]** Production database migration (PostgreSQL for multi-user concurrency)
- **[Planned]** File storage migration (S3-compatible object storage for reference documents)
- **[Planned]** Automated backups and disaster recovery
- **[Planned]** HIPAA-compliant hosting option

---

## What happens next

The prototype proves the core pipeline works: upload a document, detect claims, match them to references, let reviewers verify. The full product build takes that foundation and adds the infrastructure, access controls, and workflow features needed for production use across a team.

Hedgehox builds it. You own it. When you need updates, we're a phone call away.
