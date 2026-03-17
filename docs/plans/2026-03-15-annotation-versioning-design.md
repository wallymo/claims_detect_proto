# Annotation Versioning & Brand Learning Design

**Date:** March 15, 2026
**Branch:** newworkflow
**Route:** /mkg3

## Problem

Gemini Vision gets annotation placement and reference mapping 90-95% right on first pass. We can't fix the remaining 5-10% through model training. Instead, we let reviewers correct to 100% and cache those corrections permanently. Over time, the system builds brand-level knowledge from reviewer actions that improves AI accuracy on new documents.

## Core Concept: Correct Once, Remember Forever

1. AI analyzes a document — produces v1 (90-95% accurate)
2. Reviewer corrects pin placements, fixes references, removes false positives, adds missed annotations
3. Every save creates a new version — full history preserved, nothing destructive
4. Same document re-uploaded → loads latest corrected version instantly
5. Revised document uploaded → carries forward annotations from matching pages
6. Approve/reject actions feed brand-level patterns that improve future first-pass accuracy

## Four Edit Operations

### 1. Move Pin

- **Interaction:** Click pin to select (existing behavior), then drag to reposition
- **Cursor:** Changes to `grab` on hover over selected pin
- **No edit mode toggle** — drag-on-selected is the natural interaction
- **Reuses:** Existing `findDotAt()` hit detection in ClaimPinsOverlay
- **Updates:** `claim.position.x` and `claim.position.y` (percentage coordinates) in real-time

### 2. Edit References

On the existing MKGClaimCard, add an edit icon next to the reference section. Opens a dropdown/modal with three options:

- **Swap:** Pick a different reference from the brand's library to replace the current one
- **Add:** Attach an additional reference from the brand's library
- **Upload:** Drag-drop a new reference PDF that gets added to the library and linked to this annotation

Brand library is already loaded in the frontend — primarily UI wiring.

### 3. Add Missed Annotation

Builds on the existing missed claim flow (pin placement + MissedClaimForm). Changes:

- Saved missed annotations become indistinguishable from AI-detected ones in the version snapshot
- They receive proper sequential numbering and styling
- Included in the version's `annotations_json` like any other annotation

### 4. Delete Annotation

- Trash icon on MKGClaimCard
- Soft delete — marked as deleted in the current version but preserved in edit history
- Can be restored from a previous version via the version history

## Data Model

Four new tables in existing SQLite database (new migration):

### `annotation_versions`

Core version history — each row is a full snapshot.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| document_hash | TEXT | SHA256 of the uploaded PDF |
| brand_id | INTEGER FK | References brands table |
| version_number | INTEGER | Auto-increment per document (1, 2, 3...) |
| document_name | TEXT | Original filename |
| annotations_json | TEXT | Full JSON snapshot of all annotations at this version |
| source | TEXT | `"ai"` for v1 (raw AI output), `"manual"` for human-edited saves |
| parent_version_id | INTEGER FK | Links to the version this was derived from (null for v1) |
| created_by | TEXT | Placeholder for future auth |
| created_at | DATETIME | Timestamp |

### `annotation_edits`

Individual edit audit trail — what changed between versions.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| version_id | INTEGER FK | References annotation_versions |
| annotation_id | TEXT | ID of the annotation that was edited |
| edit_type | TEXT | One of: `move`, `ref_change`, `ref_add`, `delete`, `add_missed` |
| before_json | TEXT | State before the edit |
| after_json | TEXT | State after the edit |
| created_at | DATETIME | Timestamp |

### `brand_patterns`

Implicit learning from reviewer corrections. Accumulated automatically from approve/reject actions.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| brand_id | INTEGER FK | References brands table |
| pattern_type | TEXT | `ref_association`, `claim_language`, `ref_frequency` |
| pattern_json | TEXT | e.g., `{ "reference": "Gonzalez 2024", "claim_patterns": ["47% reduction in..."], "strength": 5 }` |
| created_at | DATETIME | First recorded |
| updated_at | DATETIME | Last strength update |

Strength increases with each confirming correction, decreases if contradicted.

### `document_lineage`

Links revised PDFs to their predecessors for carry-forward.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| document_hash | TEXT | SHA256 of the new PDF |
| parent_hash | TEXT | SHA256 of the predecessor (null if first upload) |
| brand_id | INTEGER FK | References brands table |
| similarity_score | REAL | Page-level text similarity (0-1) |
| created_at | DATETIME | Timestamp |

## Version History UI

Minimal footprint in the existing toolbar:

- **Version indicator:** Badge showing current version (e.g., `v3`) next to a "Save Version" button
- **Version dropdown:** Click the indicator to see the history — timestamps, source (`AI analysis` vs `Manual edit`), edit count per version
- **Load previous version:** Select from dropdown → loads that snapshot in read-only. "Restore" button forks a new version from it
- **v1 is always the raw AI output** — the "before" in the before/after story for demos
- **Unsaved changes indicator:** Subtle visual cue when edits haven't been saved as a new version

## Carry-Forward Logic

When a revised PDF is uploaded for a brand that has versioned documents:

1. Compute SHA256 of the new file
2. **Exact hash match** → load latest version directly, no analysis needed
3. **No match** → extract text from both old and new PDF, run page-level text similarity scoring
4. **Pages above 85% similarity** → carry over annotations from the matched page, flag as `"carried": true`
5. **Pages below threshold** → run fresh AI analysis
6. Result becomes v1 of the new document, with `parent_hash` linking to predecessor in `document_lineage`
7. Carried annotations show a subtle indicator ("from previous version") so reviewers know to spot-check

## Brand Learning (Implicit)

No new UI — piggybacks on existing approve/reject actions:

- **Approve** an annotation → reference-to-claim association recorded in `brand_patterns` with positive strength
- **Reject** an annotation → association recorded with negative strength (don't suggest this pairing again)
- **Swap a reference** → old association gets negative weight, new one gets positive
- One extra database insert per approve/reject action alongside existing `claim_feedback` write

### How patterns are used

When AI analyzes a new document for a brand with accumulated patterns, the strongest patterns get injected into the Gemini prompt as hints:

> "For this brand, 'Gonzalez 2024' typically supports claims about efficacy reduction percentages. 'Smith 2023' is commonly cited for safety profile data."

This improves first-pass accuracy without model training — it's prompt-level learning from human corrections.

## Implementation Phases

### Phase 1 — Foundation (data model + version save/load)

- New migration: all 4 tables
- API endpoints: save version, load versions by document hash, list version history
- Auto-save v1 after AI analysis completes
- "Save Version" button in toolbar + version indicator badge
- Load latest version on re-upload of same PDF (exact hash match)
- **Demo story:** "AI got 93% right. Reviewer saved a corrected version. Next time this doc is opened — instant, 100% accurate."

### Phase 2 — Edit operations

- Drag-to-move on selected pins (ClaimPinsOverlay changes)
- Reference edit/swap/add on MKGClaimCard
- Delete annotation (soft delete)
- Clean up existing missed-claim flow to integrate with versioning
- Each edit tracked in `annotation_edits`

### Phase 3 — Learning + carry-forward

- Wire approve/reject actions to write `brand_patterns`
- Inject brand patterns into Gemini prompt for new documents
- Fuzzy carry-forward: page text similarity matching for revised PDFs
- `document_lineage` tracking

## Why This Works for the POC

- **Honest framing:** "AI catches 90-95% on first pass. The system lets you perfect it and never lose that work."
- **Builds an asset:** Every reviewed document makes the system smarter for that brand
- **Future-proof:** Vision models are improving rapidly. The versioning system captures value now while the AI catches up
- **Audit trail:** Full edit history proves to MKG that corrections are tracked and accountable
- **No model training required:** Brand learning is prompt injection from human-verified patterns — deterministic, explainable, immediate
