# Enhanced Visual Claim Detection Design

**Date:** February 22, 2026
**Approach:** Shared Visual Taxonomy + Gemini Sweep Enhancement (Approach A)

## Problem

Visual elements in pharma documents — MOA diagrams, flowcharts, medical illustrations, before/after comparisons — contain implicit claims that the current detection system misses. Gemini's visual sweep covers charts and tables well but has no guidance for MOA, flowcharts, or medical illustrations. OpenAI and Claude have only a single generic sentence about visual content, making benchmark comparisons unfair.

## Design

### 1. Shared Visual Extraction Block

New `VISUAL_CLAIMS_INSTRUCTIONS` constant injected into `ALL_CLAIMS_PROMPT_USER`, `MEDICATION_PROMPT_USER`, and `DISEASE_STATE_PROMPT_USER`. Gives all 3 models (Gemini primary, OpenAI, Claude) visual-specific guidance.

**7 visual categories covered:**

| Category | Claim Examples |
|---|---|
| Charts & Graphs | "47% reduction vs placebo" (bar chart relationship) |
| Tables | Data cells with outcomes, rates, p-values, HRs, ORs |
| MOA / Pathway Diagrams | "Selectively inhibits JAK1 without affecting JAK3" |
| Flowcharts / Treatment Algorithms | "After failure of first-line therapy, switch to Drug X" |
| Medical Illustrations | Site-of-action, tissue penetration, BBB crossing |
| Before/After Comparisons | Visual efficacy demonstrations |
| Infographics & Pictographs | Icon arrays showing proportions, timeline graphics |

**Rules:**
- Chart titles/axis labels that frame a claim = claims themselves
- Annotation markers (dagger, double dagger, section, asterisk) near visual elements must be flagged
- Extract explicit values only — no estimating unlabeled positions
- Each distinct comparison/relationship = separate claim
- When uncertain, include with lower confidence rather than omit (over-flag principle)

### 2. Gemini Visual Sweep Enhancement

Add 3 new subsections to `buildVisualSweepPrompt()`:

**MOA / Pathway Diagrams:**
- Selectivity claims (which targets, which spared)
- Receptor binding specificity
- Cascade/signaling inhibition
- Downstream effect claims
- Any labeled mechanism step implying therapeutic advantage

**Flowcharts / Decision Trees:**
- Treatment sequencing and positioning
- Patient selection criteria at decision nodes
- Clinical criteria driving treatment decisions
- Recommended pathways implying comparative advantage

**Medical Illustrations:**
- Anatomical diagrams showing site-of-action or tissue penetration (PK/PD claims)
- Before/after visual comparisons (efficacy claims)
- Timeline diagrams showing onset of action, duration of response (temporal efficacy claims)
- Drug distribution illustrations implying bioavailability

### 3. Chart Fallback Position Fix

Current: all chart claims without coordinates stack at `(85, 30)`.
Fix: distribute vertically — `y = 30 + (index * 8)`, capped at `y = 50` to stay in slide region.

### 4. Primary Pass Media Resolution

Add `mediaResolution: 'MEDIA_RESOLUTION_HIGH'` to Gemini's primary detection pass config for consistency with visual sweep.

## Files Changed

- `app/src/services/gemini.js` — shared visual block, sweep prompt, merge fix, media resolution (only file modified — OpenAI/Anthropic receive changes automatically via their existing imports from gemini.js)

## What This Does NOT Change

- No new API calls (zero added cost)
- No architecture changes
- No new files
- No changes to dedup logic (already handles visual claims well)
- No changes to matching pipeline

## Success Criteria

- Visual claims from MOA diagrams, flowcharts, and medical illustrations are detected by all 3 models
- Benchmark comparisons between models are fair (all receive equivalent visual guidance)
- No regression in existing chart/table detection
- Over-flag principle maintained (more visual claims detected, even if some are false positives)
