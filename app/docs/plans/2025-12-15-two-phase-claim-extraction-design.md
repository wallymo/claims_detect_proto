# Two-Phase Claim Extraction Design

## Problem

The current claim detection prompt misses claims, especially on visually complex pages. Testing with the GBS tri-fold PDF showed:
- Page 1: ~9 claims, caught 6 (~67%)
- Page 2: ~9-10 claims, caught 1 (~10%)

The model "satisfices" - finds obvious claims and stops trying hard. Page 2 has dense statistical claims in callout boxes and infographics that get skipped.

## Solution

Split detection into two explicit phases within a single prompt:

**Phase 1 - Inventory:** Extract every text element from each page. No judgment - just catalog what's there.

**Phase 2 - Classify:** Go through the inventory and flag which elements are claims with confidence scores.

## Why This Works

- Forces the model to acknowledge what it saw before filtering
- Creates accountability - if page 2 only has 4 items in inventory, we know it skimmed
- The inventory becomes a checklist the model works through, reducing satisficing
- Diagnostic visibility without complex automated checks

## Prompt Structure

```
PHASE 1 - INVENTORY
Before identifying claims, catalog EVERY text element you see:
- Headlines and subheadlines
- Statistics (especially numbers in circles, callout boxes)
- Bullet points and list items
- Graph/chart labels and annotations
- Body paragraphs
- Footnotes and references

List them by page. Miss nothing.

PHASE 2 - CLASSIFICATION
Now review your inventory. For each element, decide:
- Is this a promotional claim? (efficacy, safety, statistical, etc.)
- If yes, assign confidence score

[Existing claim type definitions and scoring rubric remain unchanged]
```

## Output Format

```json
{
  "inventory": [
    {
      "page": 1,
      "elements": [
        "Headline: Guillain-Barré Syndrome: A Neurological Emergency",
        "Stat callout: ≈150,000 cases/year (1 in 1000 lifetime risk)",
        "Stat callout: ≈20% are unable to walk unassisted at 1 year",
        "..."
      ]
    },
    {
      "page": 2,
      "elements": ["..."]
    }
  ],
  "claims": [
    {
      "claim": "≈150,000 cases/year (1 in 1000 lifetime risk)",
      "confidence": 94,
      "page": 1,
      "elementType": "stat callout"
    }
  ]
}
```

## Implementation

### Changes Required

1. **Prompt rewrite** (`src/services/gemini.js`)
   - Add Phase 1 inventory instructions before Phase 2 classification
   - Call out visual patterns explicitly (circled stats, callout boxes, graph labels)
   - Keep MLR persona and scoring rubric intact

2. **Output parsing**
   - Parse new `inventory` field from response
   - Claims array format stays the same (backward compatible)
   - Log inventory to console for debugging

### No Changes Needed

- API call structure (still single call to Gemini)
- Frontend components
- Claim status/filtering logic

## Success Criteria

- GBS tri-fold: old prompt caught 7 claims, new prompt should catch 15+
- Page 2 inventory should list all visible stats and callouts
- No regression on page 1 detection
