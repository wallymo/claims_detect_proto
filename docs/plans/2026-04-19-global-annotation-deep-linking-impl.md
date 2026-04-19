# Global Annotation Deep Linking — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically discover unsuperscripted claims under global annotations and link each to precise evidence regions in the source reference PDF.

**Architecture:** Two-pass AI pipeline runs after PyMuPDF extraction. Pass 1 (Gemini Flash Lite) discovers claims in slide content. Pass 2 (evidence_candidates.py + Gemini Pro) locates precise evidence regions. Child claims nest under the global annotation card in the UI.

**Tech Stack:** Gemini Flash Lite (claim discovery), Gemini Pro (evidence reranking), evidence_candidates.py (deterministic shortlist), React (expandable card UI)

**Design doc:** `docs/plans/2026-04-19-global-annotation-deep-linking-design.md`

---

## Orchestration Lock

| Task | Files | Executor |
|------|-------|----------|
| Task 1: Backend linker service | `backend/src/services/globalAnnotationLinker.js` (new) | **Codex** |
| Task 2: Backend controller integration | `backend/src/controllers/pymupdfController.js` (modify) | **Codex** |
| Task 3: Frontend transform pass-through | `app/src/pages/MKG3ClaimsDetector.jsx` (modify L175-196) | **Opus Agent** |
| Task 4: Frontend expandable child claims UI | `MKGClaimCard.jsx` + `MKGClaimCard.module.css` | **Opus Agent** |
| Task 5: Wire child claim click to ReferenceViewer | `MKG3ClaimsDetector.jsx` (modify) | **Opus Agent** |

---

### Task 1: Backend — globalAnnotationLinker.js

**Files:**
- Create: `backend/src/services/globalAnnotationLinker.js`

**Step 1: Create the linker service**

```javascript
// backend/src/services/globalAnnotationLinker.js
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import { fileURLToPath } from 'url'
import { getGeminiClient, GEMINI_MODEL } from './gemini.js'
import Reference from '../models/Reference.js'
import { logger } from '../utils/logger.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_BIN = path.join(PROJECT_ROOT, 'scripts/.venv/bin/python3')
const CANDIDATES_SCRIPT = path.join(PROJECT_ROOT, 'scripts/evidence_candidates.py')

const FLASH_LITE_MODEL = 'gemini-2.5-flash-lite-preview-06-27'
const PRO_MODEL = 'gemini-2.5-pro-preview-06-05'

/**
 * Pass 1: Discover claims in slide content that orphan references support.
 * Returns array of { text, position_hint, reference_index, evidence_type_expected, confidence }
 */
async function discoverClaims(slideText, notesText, orphanReferences) {
  const ai = getGeminiClient()
  const refsBlock = orphanReferences.map((r, i) =>
    `Reference ${i}: ${r.text}`
  ).join('\n')

  const prompt = `You are analyzing a pharma slide deck page. Some references appear as footnotes but have no superscript citations in the text.

SLIDE CONTENT:
${slideText || '(none)'}

SPEAKER NOTES:
${notesText || '(none)'}

ORPHAN REFERENCES (no superscript points to them):
${refsBlock}

Task: Identify specific statements in the slide content or speaker notes that these orphan references likely support. Look for:
- Quantitative claims (percentages, hazard ratios, p-values, incidence rates)
- Mechanism of action statements
- Safety/tolerability findings
- Efficacy endpoints
- Comparative claims (superior, improved, favorable)
- Epidemiological facts (incidence, prevalence)

For each discovered claim, return:
- text: exact statement from the slide
- position_hint: approximate { x, y } as percentage of page (your best estimate)
- reference_index: which orphan reference (0-indexed) supports this claim
- evidence_type_expected: "statistical" | "mechanism" | "safety" | "epidemiological" | "general"
- confidence: 0-1 how certain you are this reference supports this claim

Return strict JSON only: { "discovered_claims": [...] }
If no claims match, return { "discovered_claims": [] }`

  const response = await ai.models.generateContent({
    model: FLASH_LITE_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json' }
  })

  const text = response.text || ''
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed.discovered_claims) ? parsed.discovered_claims : []
  } catch {
    logger.warn('[GlobalLinker] Pass 1 parse failed:', text.slice(0, 200))
    return []
  }
}

/**
 * Pass 2: Locate precise evidence in the reference PDF for a discovered claim.
 * Reuses evidence_candidates.py for deterministic shortlist + Gemini Pro rerank.
 */
async function locateEvidence(claimText, referencePdfPath) {
  // Step 2a: Get deterministic shortlist from Python
  let candidates = []
  try {
    const { stdout } = await execFileAsync(
      PYTHON_BIN,
      [CANDIDATES_SCRIPT, referencePdfPath, '--claim', claimText, '--top-k', '15'],
      { cwd: PROJECT_ROOT, maxBuffer: 50 * 1024 * 1024, timeout: 60_000 }
    )
    const payload = JSON.parse(stdout)
    candidates = payload.candidates || []
  } catch (err) {
    logger.warn('[GlobalLinker] evidence_candidates.py failed:', err.message)
    return null
  }

  if (candidates.length === 0) return null

  // Step 2b: Gemini Pro reranks to best 1-2
  const ai = getGeminiClient()
  const candidatesBlock = candidates.slice(0, 15).map((c, i) =>
    `[${i}] Page ${c.page_number}, type=${c.type}, score=${c.score?.toFixed(2)}: "${c.text?.slice(0, 200)}"`
  ).join('\n')

  const prompt = `Given this claim and candidate evidence regions from a reference PDF, select the BEST 1-2 regions that directly support the claim.

CLAIM: "${claimText}"

CANDIDATES:
${candidatesBlock}

For each selected region, return:
- candidate_index: index from the list above
- support_strength: "direct_support" | "partial_support" | "weak_support"
- rationale: one sentence explaining why this evidence supports the claim

Return strict JSON: { "evidence": [{ "candidate_index": N, "support_strength": "...", "rationale": "..." }] }`

  const response = await ai.models.generateContent({
    model: PRO_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json' }
  })

  const text = response.text || ''
  try {
    const parsed = JSON.parse(text)
    const selected = Array.isArray(parsed.evidence) ? parsed.evidence : []

    return selected.map(sel => {
      const cand = candidates[sel.candidate_index]
      if (!cand) return null
      return {
        page_number: cand.page_number,
        type: cand.type,
        rects: cand.rects,
        snippet: cand.text?.slice(0, 300),
        rationale: sel.rationale,
        support_strength: sel.support_strength
      }
    }).filter(Boolean)
  } catch {
    logger.warn('[GlobalLinker] Pass 2 parse failed:', text.slice(0, 200))
    return null
  }
}

/**
 * Main entry: enrich PyMuPDF result with child claims under global annotations.
 */
export async function enrichGlobalAnnotations(pymupdfResult, brandId) {
  // Check if Gemini key is available
  try {
    getGeminiClient()
  } catch {
    logger.info('[GlobalLinker] No Gemini key — skipping global annotation enrichment')
    return pymupdfResult
  }

  // Find pages with global annotations
  const pagesWithGlobals = (pymupdfResult.pages || []).filter(p =>
    Array.isArray(p.global_annotations) && p.global_annotations.length > 0
  )

  if (pagesWithGlobals.length === 0) return pymupdfResult

  logger.info(`[GlobalLinker] Enriching ${pagesWithGlobals.length} pages with global annotations`)

  // Load reference PDF paths for this brand
  let referenceMap = {}
  if (brandId) {
    try {
      const refs = await Reference.findByBrand(brandId)
      referenceMap = Object.fromEntries(refs.map(r => [r.id, r]))
    } catch {
      logger.warn('[GlobalLinker] Could not load reference paths for brand')
    }
  }

  for (const page of pagesWithGlobals) {
    // Reconstruct slide and notes text from the page data
    const slideText = (page.slide_claims || []).map(c => c.text).join('\n')
    const notesText = (page.notes_claims || []).map(c => c.text).join('\n')

    for (const globalAnno of page.global_annotations) {
      const orphanRefs = globalAnno.references || []

      if (orphanRefs.length === 0) continue

      // Pass 1: Discover claims
      const discovered = await discoverClaims(slideText, notesText, orphanRefs)

      if (discovered.length === 0) continue

      // Pass 2: Locate evidence for each claim (parallel)
      const childClaims = []
      const evidencePromises = discovered.map(async (disc, claimIdx) => {
        const ref = orphanRefs[disc.reference_index]
        if (!ref) return null

        // Find reference PDF path
        const refId = ref.id
        const refDoc = refId ? referenceMap[refId] : null
        if (!refDoc?.file_path) return {
          id: `pymupdf-gc-${page.page}-${page.global_annotations.indexOf(globalAnno)}-${claimIdx}`,
          text: disc.text,
          position: disc.position_hint,
          source: 'global-deep-link',
          confidence: disc.confidence,
          reference_id: refId,
          evidence: null
        }

        const evidence = await locateEvidence(disc.text, refDoc.file_path)

        return {
          id: `pymupdf-gc-${page.page}-${page.global_annotations.indexOf(globalAnno)}-${claimIdx}`,
          text: disc.text,
          position: disc.position_hint,
          source: 'global-deep-link',
          confidence: disc.confidence,
          reference_id: refId,
          evidence: Array.isArray(evidence) ? evidence[0] : evidence
        }
      })

      const results = await Promise.all(evidencePromises)
      globalAnno.childClaims = results.filter(Boolean)

      logger.info(`[GlobalLinker] Page ${page.page}: found ${globalAnno.childClaims.length} child claims for global annotation`)
    }
  }

  return pymupdfResult
}
```

**Step 2: Commit**

```bash
git add backend/src/services/globalAnnotationLinker.js
git commit -m "feat: add globalAnnotationLinker service (two-pass AI pipeline)"
```

---

### Task 2: Backend — Integrate Linker into pymupdfController

**Files:**
- Modify: `backend/src/controllers/pymupdfController.js:55-56`

**Step 1: Add linker import and call**

At the top of `pymupdfController.js`, add import:

```javascript
import { enrichGlobalAnnotations } from '../services/globalAnnotationLinker.js'
```

Replace lines 55-56:

```javascript
// Before:
const result = JSON.parse(stdout)
res.json(result)

// After:
let result = JSON.parse(stdout)
try {
  result = await enrichGlobalAnnotations(result, req.body?.brandId || req.query?.brandId)
} catch (err) {
  logger.warn('[PyMuPDF] Global annotation enrichment failed:', err.message)
  // Continue with un-enriched result
}
res.json(result)
```

Also add logger import at top:

```javascript
import { logger } from '../utils/logger.js'
```

**Step 2: Verify controller still works for normal flow**

Run: `curl -F "pdf=@test.pdf" http://localhost:3001/api/pymupdf-extract`
Expected: Same response as before. If no Gemini key set, enrichment is skipped gracefully.

**Step 3: Commit**

```bash
git add backend/src/controllers/pymupdfController.js
git commit -m "feat: integrate global annotation linker into PyMuPDF extraction"
```

---

### Task 3: Frontend — Transform childClaims pass-through

**Files:**
- Modify: `app/src/pages/MKG3ClaimsDetector.jsx:175-196`

**Step 1: Add childClaims to global annotation transform**

In `transformPyMuPDFResults()`, at line 194 (before the closing `}`), add `childClaims`:

```javascript
// Replace the global annotation block (lines 175-196) with:
    for (const [idx, g] of (page.global_annotations || []).entries()) {
      const region = (g.global_reason || '').includes('slide') ? 'slide' : 'notes'
      annotations.push({
        id: `pymupdf-g-${page.page}-${idx}`,
        text: g.text,
        claim: g.text,
        statement: g.text,
        region,
        refNumbers: g.superscripts || [],
        superscripts: g.superscripts || [],
        references: (g.references || []).map(r => ({ number: r.number, text: r.text, missing: false, id: matchRef(r.text) })),
        source: 'pymupdf',
        matched: true,
        matchTier: 'on-page',
        confidence: 100,
        page: page.page,
        position: g.position || null,
        globalSpot: true,
        globalReason: g.global_reason || 'orphan-page-reference',
        status: 'pending',
        childClaims: (g.childClaims || []).map((cc, ccIdx) => ({
          id: cc.id || `pymupdf-gc-${page.page}-${idx}-${ccIdx}`,
          text: cc.text,
          position: cc.position || null,
          source: 'global-deep-link',
          confidence: cc.confidence || 0,
          reference_id: cc.reference_id || null,
          evidence: cc.evidence || null,
        })),
      })
    }
```

**Step 2: Verify build**

Run: `cd app && npm run build`
Expected: Clean build, no errors.

**Step 3: Commit**

```bash
git add app/src/pages/MKG3ClaimsDetector.jsx
git commit -m "feat: pass childClaims through global annotation transform"
```

---

### Task 4: Frontend — Expandable child claims in MKGClaimCard

**Files:**
- Modify: `app/src/components/mkg/MKGClaimCard.jsx`
- Modify: `app/src/components/mkg/MKGClaimCard.module.css`

**Step 1: Add expand state and child claims section**

Add state at the top of the component function (after existing useState hooks):

```javascript
const [childrenExpanded, setChildrenExpanded] = useState(false)
```

After the global badge rendering (around line 368-370), add child claims count:

```jsx
{claim.childClaims?.length > 0 && (
  <button
    className={styles.childClaimsToggle}
    onClick={() => setChildrenExpanded(!childrenExpanded)}
    title={childrenExpanded ? 'Hide linked claims' : 'Show linked claims'}
  >
    <Icon name={childrenExpanded ? 'chevronDown' : 'chevronRight'} size={12} />
    {claim.childClaims.length} claim{claim.childClaims.length !== 1 ? 's' : ''} linked
  </button>
)}
```

Add the child claims section in the card body (after the reference callouts section, before any feedback/approval section):

```jsx
{claim.childClaims?.length > 0 && childrenExpanded && (
  <div className={styles.childClaimsSection}>
    {claim.childClaims.map((cc) => (
      <div key={cc.id} className={styles.childClaimRow}>
        <div className={styles.childClaimText}>{cc.text}</div>
        {cc.evidence ? (
          <button
            className={styles.evidenceBadge}
            onClick={() => onChildEvidenceClick?.(cc)}
            title={`Page ${cc.evidence.page_number} — ${cc.evidence.type}`}
          >
            <Icon name="fileText" size={10} />
            Pg {cc.evidence.page_number}
            <span className={styles.evidenceType}>{cc.evidence.type}</span>
          </button>
        ) : (
          <span className={styles.noEvidence}>No evidence found</span>
        )}
      </div>
    ))}
  </div>
)}
```

**Step 2: Add the new prop callback to the component signature**

Find the component's props destructuring and add `onChildEvidenceClick`:

```javascript
export default function MKGClaimCard({
  claim,
  // ... existing props ...
  onChildEvidenceClick,
})
```

**Step 3: Add CSS styles**

In `MKGClaimCard.module.css`, add:

```css
.childClaimsToggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid var(--gray-6);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  color: var(--gray-9);
  cursor: pointer;
  margin-left: 6px;
}
.childClaimsToggle:hover {
  background: var(--gray-3);
}

.childClaimsSection {
  margin-top: 8px;
  border-top: 1px solid var(--gray-4);
  padding-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.childClaimRow {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 4px;
  background: var(--gray-2);
}

.childClaimText {
  font-size: 12px;
  color: var(--gray-11);
  line-height: 1.4;
  flex: 1;
}

.evidenceBadge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--blue-2);
  color: var(--blue-11);
  border: none;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
.evidenceBadge:hover {
  background: var(--blue-4);
}

.evidenceType {
  text-transform: capitalize;
  opacity: 0.8;
}

.noEvidence {
  font-size: 11px;
  color: var(--gray-8);
  white-space: nowrap;
  flex-shrink: 0;
}
```

**Step 4: Verify build**

Run: `cd app && npm run build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add app/src/components/mkg/MKGClaimCard.jsx app/src/components/mkg/MKGClaimCard.module.css
git commit -m "feat: expandable child claims under global annotation cards"
```

---

### Task 5: Frontend — Wire child claim evidence click to ReferenceViewer

**Files:**
- Modify: `app/src/pages/MKG3ClaimsDetector.jsx`

**Step 1: Add handler for child evidence click**

After the existing `handleViewReference` function (around line 1374), add:

```javascript
const handleChildEvidenceClick = useCallback((childClaim) => {
  if (!childClaim?.evidence || !childClaim?.reference_id) return
  setReferenceViewerData({
    referenceId: childClaim.reference_id,
    page: childClaim.evidence.page_number,
    excerpt: childClaim.evidence.snippet,
    claimId: childClaim.id,
    claimText: childClaim.text,
    highlightRects: childClaim.evidence.rects,
  })
}, [])
```

**Step 2: Pass handler to MKGClaimCard**

Find where `MKGClaimCard` is rendered (search for `<MKGClaimCard`). Add the new prop:

```jsx
<MKGClaimCard
  // ... existing props ...
  onChildEvidenceClick={handleChildEvidenceClick}
/>
```

**Step 3: Pass highlightRects to ReferenceViewer**

At line 2462-2469 where ReferenceViewer is rendered, add the new prop:

```jsx
<ReferenceViewer
  referenceId={referenceViewerData.referenceId}
  page={referenceViewerData.page}
  excerpt={referenceViewerData.excerpt}
  claimId={referenceViewerData.claimId}
  claimText={referenceViewerData.claimText}
  onEvidenceChanged={handleEvidenceChanged}
  highlightRects={referenceViewerData.highlightRects}
/>
```

Note: `highlightRects` is a new optional prop. If ReferenceViewer doesn't handle it yet, it will be ignored. A future enhancement can render these as highlighted regions on the PDF.

**Step 4: Verify build**

Run: `cd app && npm run build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add app/src/pages/MKG3ClaimsDetector.jsx
git commit -m "feat: wire child claim evidence click to ReferenceViewer"
```

---

## Testing Notes

- **No Gemini key:** Pipeline gracefully degrades — global annotations show as today, no child claims
- **No global annotations on deck:** Pipeline skipped entirely, zero cost
- **No matching reference in library:** Child claims appear with "No evidence found" badge
- **AI finds 0 claims:** `childClaims: []`, global card shows as today
- **Manual testing:** Upload a deck with orphan references (e.g., the MKG Knowledge Base test doc). Verify global annotations show "N claims linked" toggle and children have evidence badges that open ReferenceViewer.

## Latency Budget

| Phase | Time |
|-------|------|
| PyMuPDF extraction | ~1s |
| Pass 1 (claim discovery, per page) | ~2-3s |
| Pass 2 (evidence location, per claim, parallel) | ~3-5s |
| **Total for 3-5 global annotations** | **~6-8s** |
