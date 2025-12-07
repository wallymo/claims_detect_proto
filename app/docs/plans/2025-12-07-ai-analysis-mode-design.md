# AI Analysis Mode Design

## Overview

Add "AI Analysis" as a brand option that demonstrates AI-only claim detection with 70-85% confidence levels, plus supporting features for confidence sorting and editable claim types.

## Features

### 1. AI Analysis Brand Option

**Location:** Brand dropdown, after "Johnson & Johnson", before divider

```
Novartis
Pfizer
Merck
Amgen
Johnson & Johnson
AI Analysis        ← NEW
─────────────────
Upload Custom...
```

**Behavior when selected:**
- Loads separate AI Analysis mock dataset
- All claims have `source: 'ai_discovered'` (no core claims)
- Results summary hides "Core Claims Found" section entirely
- Shows AI-Discovered count, status breakdown, processing time, model

### 2. AI Analysis Mock Dataset

**Location:** `src/mocks/claims.js`

**Specifications:**
- 8 claims total
- All claims: `source: 'ai_discovered'`
- Confidence range: 0.70-0.85
- ONE claim at ~0.45 confidence (demonstrates rejection workflow with feedback)
- Mix of claim types for variety

**Example low-confidence claim:**
```javascript
{
  id: 'ai_claim_007',
  text: 'Product may help with general wellness outcomes',
  confidence: 0.45,
  type: 'efficacy',
  source: 'ai_discovered',
  status: 'pending',
  location: { paragraph: 8 }
}
```

### 3. Confidence Sorting

**Location:** Above claims list, near search input

**UI:** Dropdown - "Sort by: Confidence ↓" / "Confidence ↑"

**Behavior:**
- Applies to all modes (not just AI Analysis)
- Default: High→Low
- Sorts filtered claims by confidence score

### 4. Editable Claim Types

**Location:** On each ClaimCard, the type badge becomes clickable

**UI:**
- Click type badge to open dropdown
- Dropdown shows all 8 types with their colors:
  - Efficacy (blue)
  - Safety (red)
  - Regulatory (amber)
  - Comparative (purple)
  - Dosage (teal)
  - Ingredient (green)
  - Testimonial (pink)
  - Pricing (gray)

**Behavior:**
- Works in all modes
- Works on any claim status (pending, approved, rejected)
- Selection updates claim immediately
- Badge color updates to match new type

## State Changes

### App.jsx

New/modified state:
- `selectedBrand` - can now be "AI Analysis"
- `sortOrder` - new state: 'high-low' | 'low-high'

New handlers:
- `updateClaimType(claimId, newType)` - updates claim's type in claims array

### Claims filtering logic

When sorting enabled:
```javascript
const sortedClaims = [...filteredClaims].sort((a, b) => {
  return sortOrder === 'high-low'
    ? b.confidence - a.confidence
    : a.confidence - b.confidence
})
```

### Results Summary

Conditional rendering:
- If `selectedBrand === 'AI Analysis'`: hide Core Claims section
- Otherwise: show Core Claims section as normal

## Files to Modify

1. `src/App.jsx` - Add AI Analysis to BRAND_OPTIONS, sort state, type update handler
2. `src/mocks/claims.js` - Add AI_ANALYSIS_CLAIMS dataset
3. `src/components/claims-detector/ClaimCard.jsx` - Make type badge clickable with dropdown
4. Results summary section in App.jsx - Conditional Core Claims display
