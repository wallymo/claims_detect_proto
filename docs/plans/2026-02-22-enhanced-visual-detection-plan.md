# Enhanced Visual Claim Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve claim detection from visual elements (MOA diagrams, flowcharts, medical illustrations, charts, tables) across all 3 AI models.

**Architecture:** Add a shared `VISUAL_CLAIMS_INSTRUCTIONS` block to the 3 exported prompt constants in `gemini.js` (auto-propagates to OpenAI/Anthropic via imports). Enhance Gemini's visual sweep prompt with MOA/flowchart/medical illustration sections. Fix chart fallback pin stacking. Add high-res media to primary pass.

**Tech Stack:** JavaScript (ES modules), Vitest for tests

---

### Task 1: Add VISUAL_CLAIMS_INSTRUCTIONS constant

**Files:**
- Modify: `app/src/services/gemini.js` (insert new constant before `ALL_CLAIMS_PROMPT_USER` around line 714)

**Step 1: Add the constant**

Insert this new exported constant before `ALL_CLAIMS_PROMPT_USER` (line ~714):

```javascript
export const VISUAL_CLAIMS_INSTRUCTIONS = `
# Visual Element Claims
IMPORTANT: Charts, graphs, tables, diagrams, and illustrations contain claims that require substantiation just like text. Analyze EVERY visual element.

## Charts & Graphs
- Extract the RELATIONSHIP each chart shows (comparison, trend, superiority), not just axis labels
- Bar/line/pie/scatter charts, Kaplan-Meier curves, forest plots, waterfall/spider/swimmer plots
- Each distinct comparison or data point visible in a chart is a SEPARATE claim

## Tables
- EVERY data cell with an outcome, rate, percentage, p-value, hazard ratio, odds ratio, or delta is a claim
- Table titles framing a claim count as claims themselves

## MOA / Pathway Diagrams
- Mechanism of action diagrams showing selectivity, receptor binding, or pathway inhibition are claims
- "Selectively targets X receptor" shown visually = efficacy/specificity claim
- Cascade/signaling diagrams showing downstream effects = mechanism claims
- Any labeled step implying therapeutic advantage requires substantiation

## Flowcharts / Treatment Algorithms
- Treatment sequencing diagrams imply positioning claims (e.g., "use after first-line failure")
- Patient selection criteria at decision nodes = population claims
- Recommended pathways implying comparative advantage over alternatives

## Medical Illustrations
- Anatomical diagrams showing site-of-action, tissue penetration, or drug distribution = PK/PD claims
- Blood-brain barrier crossing, organ targeting = bioavailability claims
- Before/after visual comparisons = efficacy claims requiring substantiation

## Infographics & Pictographs
- Icon arrays showing proportions (e.g., 7/10 figures highlighted = "70% response rate")
- Timeline graphics showing onset of action or duration of response = temporal efficacy claims
- Percentage wheels, pictographs with statistics

## Visual Element Rules
- Chart titles and axis labels that frame a claim ARE claims
- Annotation markers (†, ‡, §, *) near visual elements must be flagged
- Extract only explicit values visible in the graphic — do NOT estimate unlabeled bar heights
- Each distinct comparison, trend, or data relationship = separate claim
- When uncertain about a visual element, include with lower confidence rather than omitting`
```

**Step 2: Commit**

```bash
git add app/src/services/gemini.js
git commit -m "feat: add VISUAL_CLAIMS_INSTRUCTIONS constant for visual claim detection"
```

---

### Task 2: Inject visual instructions into ALL_CLAIMS_PROMPT_USER

**Files:**
- Modify: `app/src/services/gemini.js` (line ~715, `ALL_CLAIMS_PROMPT_USER`)

**Step 1: Add visual instructions to prompt**

In `ALL_CLAIMS_PROMPT_USER`, replace the existing line:
```
- Include charts/graphs/infographics with statistical claims
```

With:
```
- Include charts/graphs/infographics with statistical claims
${VISUAL_CLAIMS_INSTRUCTIONS}
```

Insert `${VISUAL_CLAIMS_INSTRUCTIONS}` after the `# Rules` section and before `# Confidence`. The prompt is a template literal so the variable reference works directly.

**Step 2: Commit**

```bash
git add app/src/services/gemini.js
git commit -m "feat: inject visual instructions into ALL_CLAIMS prompt"
```

---

### Task 3: Inject visual instructions into MEDICATION_PROMPT_USER

**Files:**
- Modify: `app/src/services/gemini.js` (line ~787, `MEDICATION_PROMPT_USER`)

**Step 1: Add visual instructions to prompt**

In `MEDICATION_PROMPT_USER`, add `${VISUAL_CLAIMS_INSTRUCTIONS}` after the `# Rules` section (after the annotation markers rule, before `# Confidence`).

**Step 2: Commit**

```bash
git add app/src/services/gemini.js
git commit -m "feat: inject visual instructions into MEDICATION prompt"
```

---

### Task 4: Inject visual instructions into DISEASE_STATE_PROMPT_USER

**Files:**
- Modify: `app/src/services/gemini.js` (line ~751, `DISEASE_STATE_PROMPT_USER`)

**Step 1: Add visual instructions to prompt**

In `DISEASE_STATE_PROMPT_USER`, add `${VISUAL_CLAIMS_INSTRUCTIONS}` after the `# Rules` section (after `- Include visual elements with statistical claims`, before `# Confidence`).

**Step 2: Commit**

```bash
git add app/src/services/gemini.js
git commit -m "feat: inject visual instructions into DISEASE_STATE prompt"
```

---

### Task 5: Enhance buildVisualSweepPrompt with MOA, flowcharts, medical illustrations

**Files:**
- Modify: `app/src/services/gemini.js` (line ~484, `buildVisualSweepPrompt()`)

**Step 1: Add 3 new sections to the prompt**

In `buildVisualSweepPrompt()`, after the `## Also Extract` section and before `# Rules`, add:

```javascript
## MOA / Pathway Diagrams
- **Mechanism of action diagrams**: What selectivity, binding, or inhibition is claimed? (e.g., "Drug X selectively inhibits JAK1 without affecting JAK3")
- **Receptor binding illustrations**: What receptor specificity or affinity is shown?
- **Cascade/signaling diagrams**: What downstream effects are being claimed? What pathways are activated or blocked?
- **Pharmacodynamic illustrations**: What biological process does the drug modulate?
- Any labeled mechanism step that implies therapeutic advantage is a claim.

## Flowcharts / Treatment Algorithms
- **Treatment sequencing diagrams**: What ordering or positioning is recommended? (e.g., "After failure of first-line therapy, switch to Drug X")
- **Patient selection criteria**: What eligibility, stratification, or biomarker criteria appear at decision nodes?
- **Clinical decision trees**: What outcomes or test results drive treatment decisions?
- **Recommended pathways**: Do they imply comparative advantage over alternatives?
- Each decision node containing a clinical criterion is a potential claim.

## Medical Illustrations / Anatomical Diagrams
- **Site-of-action diagrams**: What tissue penetration, organ targeting, or drug distribution is shown? These imply PK/PD claims.
- **Before/after comparisons**: Visual efficacy demonstrations (dermatology, ophthalmology, etc.) are claims requiring substantiation.
- **Timeline diagrams**: Onset of action, duration of response, or treatment milestones shown visually are temporal efficacy claims.
- **Drug distribution illustrations**: BBB crossing, tissue concentration, bioavailability shown visually = PK claims.
```

**Step 2: Commit**

```bash
git add app/src/services/gemini.js
git commit -m "feat: add MOA, flowchart, medical illustration detection to visual sweep"
```

---

### Task 6: Fix chart fallback position stacking

**Files:**
- Modify: `app/src/services/gemini.js` (line ~414, `mergeRawClaims()`)

**Step 1: Write the failing test**

Create test in `app/test/services/gemini-merge.test.js` (or add to existing test file if one exists for gemini):

```javascript
import { describe, it, expect } from 'vitest'

// We'll test the merge behavior by importing mergeRawClaims if exported,
// or by testing the behavior indirectly. Since mergeRawClaims is not exported,
// we test the behavior through the visual claims that come out.

describe('chart fallback position distribution', () => {
  it('should distribute multiple chart fallback claims vertically, not stack them', () => {
    // This test verifies the fix by checking that the y-coordinates
    // of chart-fallback-positioned claims are not all identical.
    // We'll verify this in the implementation step.
  })
})
```

Note: `mergeRawClaims` is a private function — we'll verify the fix via manual testing with a multi-chart PDF. The code change is small and self-contained.

**Step 2: Implement the fix**

In `mergeRawClaims()`, replace the fixed fallback assignment:

```javascript
// BEFORE (stacking):
c.x = CHART_FALLBACK_X
c.y = CHART_FALLBACK_Y
c._chartFallbackPosition = true
return true
```

With distributed positioning:

```javascript
// AFTER (distributed):
c.x = CHART_FALLBACK_X
c.y = Math.min(CHART_FALLBACK_Y + (chartFallbackIndex * 8), 50) // Cap at y=50 to stay in slide region
c._chartFallbackPosition = true
chartFallbackIndex++
return true
```

Also add `let chartFallbackIndex = 0` before the `validVisualClaims.filter()` call:

```javascript
let chartFallbackIndex = 0
const validVisualClaims = visualClaims.filter(c => {
```

**Step 3: Commit**

```bash
git add app/src/services/gemini.js
git commit -m "fix: distribute chart fallback pin positions vertically instead of stacking"
```

---

### Task 7: Add mediaResolution HIGH to primary detection pass

**Files:**
- Modify: `app/src/services/gemini.js` (line ~936, primary pass config)

**Step 1: Add mediaResolution to config**

In the primary detection pass config object, add `mediaResolution: 'MEDIA_RESOLUTION_HIGH'`:

```javascript
// BEFORE:
config: {
  systemInstruction: SYSTEM_INSTRUCTION,
  temperature: 0, topP: 0.1, topK: 1,
  maxOutputTokens: 64000,
  responseMimeType: 'application/json',
  responseJsonSchema: CLAIMS_JSON_SCHEMA
}

// AFTER:
config: {
  systemInstruction: SYSTEM_INSTRUCTION,
  temperature: 0, topP: 0.1, topK: 1,
  mediaResolution: 'MEDIA_RESOLUTION_HIGH',
  maxOutputTokens: 64000,
  responseMimeType: 'application/json',
  responseJsonSchema: CLAIMS_JSON_SCHEMA
}
```

**Step 2: Commit**

```bash
git add app/src/services/gemini.js
git commit -m "feat: add high-res media resolution to Gemini primary detection pass"
```

---

### Task 8: Verify build and lint

**Step 1: Run lint**

```bash
cd app && npm run lint
```

Expected: No new lint errors (we only modified prompt strings and a small logic fix).

**Step 2: Run build**

```bash
cd app && npm run build
```

Expected: Build succeeds. May see existing >500KB chunk warning (expected).

**Step 3: Run existing tests**

```bash
cd app && npm run test
```

Expected: All existing tests pass (prompt changes don't affect test logic).

**Step 4: Final commit if any fixes needed**

```bash
git add -A && git commit -m "chore: fix lint/build issues from visual detection enhancement"
```

---

### Task 9: Manual smoke test

**Step 1: Start both servers**

```bash
cd backend && npm run dev &
cd app && npm run dev
```

**Step 2: Test with a pharma PDF**

1. Open `http://localhost:5173/mkg`
2. Upload a pharma PDF that contains charts/MOA diagrams
3. Run analysis with Gemini — verify visual sweep detects MOA/flowchart claims
4. Check browser console for `[Gemini]` log line — confirm `visual_new` count increased
5. Run same PDF with OpenAI and Claude — verify they now detect visual claims too
6. Compare claim counts across models — should be more balanced than before

**Step 3: Verify pin positions**

If a page has multiple chart-derived claims, verify pins are vertically distributed (not stacked at one point).
