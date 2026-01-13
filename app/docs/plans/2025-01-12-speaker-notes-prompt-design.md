# Speaker Notes Prompt Enhancement Design

## Problem

When analyzing "notes pages" PDFs (PPTX exported with notes), the AI completely ignores the speaker notes section at the bottom of each page. It only extracts claims from the slide image portion at the top.

## Document Structure

Each notes page has a consistent two-region layout:
- **Top ~50%:** Slide image with title, graphics, statistics, citations
- **Bottom ~50%:** "Speaker notes" or "Speaker note" header followed by bullet points (• main bullets, ○/▪ sub-bullets)

## Solution

Add explicit document structure instructions to all AI prompts that:
1. Describe the two-region layout
2. Mandate analysis of BOTH regions
3. Provide position guidance for speaker notes claims (y: 55-90%)

## Implementation

### File: `src/services/gemini.js`

**Add new constant after `POSITION_INSTRUCTIONS` (line ~135):**

```javascript
// Document structure instructions for notes pages
const DOCUMENT_STRUCTURE_INSTRUCTIONS = `
# Document Structure (Notes Pages)
Each page has TWO regions you MUST analyze:
1. **SLIDE (top ~50%):** Visual content with title, graphics, statistics
2. **SPEAKER NOTES (bottom ~50%):** Starts with "Speaker notes" or "Speaker note" header, followed by bullet points (• main, ○ sub-bullets)

CRITICAL: Speaker notes often contain detailed claims, statistics, and study citations that do NOT appear on the slide. You MUST extract claims from BOTH regions. Missing speaker notes content is unacceptable.
`
```

**Update `POSITION_INSTRUCTIONS` to include speaker notes guidance:**

```javascript
const POSITION_INSTRUCTIONS = `
# Position
- x: LEFT EDGE of claim text as % (0=left, 100=right)
- y: vertical CENTER of claim as % (0=top, 100=bottom)
- Charts/graphs: position at LEFT EDGE of visual element
- Speaker notes claims: y will typically be 55-90% (bottom half of page)`
```

**Update each user-facing prompt to include document structure:**

Prepend `DOCUMENT_STRUCTURE_INSTRUCTIONS` to:
- `ALL_CLAIMS_PROMPT_USER`
- `DISEASE_STATE_PROMPT_USER`
- `MEDICATION_PROMPT_USER`

### File: `src/services/openai.js`

**Update `JSON_OUTPUT_INSTRUCTIONS` (line ~80):**

Add speaker notes position guidance to the existing instructions.

### File: `src/services/anthropic.js`

**Update `JSON_OUTPUT_INSTRUCTIONS` (line ~59):**

Add speaker notes position guidance to the existing instructions.

## Pin Behavior

Claims from speaker notes will have:
- **x:** ~5-15% (left-aligned text)
- **y:** ~55-90% (bottom half of page)

This is correct behavior - pins will appear in the speaker notes region where the claims actually appear.

## Testing

After implementation:
1. Run analysis on `MKG Knowledge Base/Test Doc/Note Pages_Example.pdf`
2. Verify claims are extracted from BOTH slide and speaker notes regions
3. Verify y-coordinates for speaker notes claims are in the 55-90% range
