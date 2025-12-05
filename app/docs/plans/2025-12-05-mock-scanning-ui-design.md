# Claims Detector Mock Scanning UI Design

**Date:** 2025-12-05
**Status:** Approved for implementation
**Approach:** Hybrid Framer Motion + CSS

---

## Overview

Create a mock document scanning experience that simulates the full claims detection flow before API integration. The goal is to visualize what the live system will look like so it's plug-and-play ready when API keys arrive.

---

## Core Concept: Claims Detection Model

### Two Types of Claims

1. **Core Claims** - Known claims from a brand's "cheat sheet" (source of truth)
2. **AI-Discovered Claims** - New claims the AI finds on its own

### The Real Flow (When Live)
1. AI scans document and finds claims independently
2. Backend compares AI findings against the cheat sheet
3. Stats show accuracy: "X of Y core claims found" + "Z additional AI-discovered"

### Success Metric
Target 70%+ accuracy rate for AI finding claims on its own.

---

## Claim Types (8 Total)

| Type | Color | Icon | Badge Variant |
|------|-------|------|---------------|
| Efficacy | `#2196F3` (Blue) | `activity` | `info` |
| Safety | `#D32F2F` (Red) | `shield` | `error` |
| Regulatory | `#F57C00` (Amber) | `fileCheck` | `warning` |
| Comparative | `#7B1FA2` (Purple) | `gitCompare` | `neutral` |
| Dosage | `#00897B` (Teal) | `pill` | `info` |
| Ingredient | `#388E3C` (Green) | `flask` | `success` |
| Testimonial | `#C2185B` (Pink) | `quote` | `warning` |
| Pricing | `#616161` (Gray) | `dollarSign` | `neutral` |

---

## Mock Data Architecture

### File Structure
```
src/mocks/
  documents.js     # 2-3 sample pharma documents
  claims.js        # Claims data with type, source, confidence
```

### Document Schema
```js
{
  id: 'doc_001',
  title: 'Clinical Trial Summary - Product X',
  content: '...full document text...',
  coreClaims: 12  // Total known claims for this brand
}
```

### Claim Schema
```js
{
  id: 'claim_001',
  text: 'Reduces symptoms by 50% in clinical trials...',
  confidence: 0.92,           // 0.45 - 0.98 range
  type: 'efficacy',           // One of 8 types
  source: 'core',             // 'core' | 'ai_discovered'
  status: 'pending',          // 'pending' | 'approved' | 'rejected'
  feedback: null,             // Rejection reason if rejected
  location: {
    paragraph: 3,
    charStart: 145,
    charEnd: 198
  }
}
```

### Mock Data Volume
- Each document: 8-15 claims
- Distribution across all 8 types (realistic, not perfectly even)
- Confidence scores: 45% - 98%
- Mix of `core` and `ai_discovered` sources

---

## User Flow

### Step 1: Upload Document
- User clicks FileUpload component
- Any file triggers mock document load (intercept actual upload)
- FileUpload shows success state with filename
- Document appears blurred in center panel (ready for scan)

### Step 2: Select Core Claims
- User selects brand from "Core Claims" dropdown (Novartis, Pfizer, Merck)
- This determines which cheat sheet to compare against
- Enables the "Analyze Document" button

### Step 3: Analyze (Scanning Animation)
- Click "Analyze Document" triggers scanning sequence
- Animation runs 2-3 seconds
- On complete, claims populate right panel

### Step 4: Review Claims
- Claims displayed as cards sorted by confidence (high to low)
- Click card to scroll document to highlighted claim
- Click highlight in document to activate corresponding card
- Approve (thumbs up) or Reject (thumbs down) each claim

---

## Scanning Animation Design

### Tech Stack
- **Framer Motion** for scan line and particles (~30KB)
- **CSS** for progress ring and blur effects

### Animation Sequence

#### Phase 1: Pre-scan (0%)
- Document visible but blurred (`filter: blur(3px)`)
- Scanner overlay appears

#### Phase 2: Scanning (0-90%)
- **Scan line:** Horizontal bar sweeps top-to-bottom, repeating
  - Gradient glow effect
  - Framer Motion `animate` with `repeat: Infinity`
- **AI Particles:** 8-12 small dots (3-5px) in accent color
  - Float upward from scan line
  - Slight horizontal drift
  - Fade out over 400ms
  - Subtle 1px blur for soft glow
  - "Mid-fi cool" - impressive but grounded
- **Progress ring:** SVG arc in center
  - Fills from 0% to 100%
  - Percentage text updates in real-time
  - Subtle pulse animation

#### Phase 3: Completion (90-100%)
- Scan line fades out
- Progress ring completes with checkmark flash
- Document blur transitions to clear (`blur(0)`)

#### Phase 4: Reveal
- Claims highlight sequentially (50ms stagger)
- Each highlight pulses once then settles

### Component Structure
```jsx
<ScannerOverlay isScanning={isAnalyzing} progress={progress}>
  <BlurredDocument blur={isAnalyzing ? 3 : 0} />
  <ScanLine />
  <AIParticles />
  <ProgressRing percentage={progress} />
</ScannerOverlay>
```

---

## Document Viewer Highlights

### Base Highlight Style
- Soft background tint at 15% opacity (color matches claim type)
- Cursor pointer on hover

### Active Highlight Style (when clicked)
- Background bumps to 25% opacity
- 2px left border in claim type color
- Brief pulse animation (scale 1.0 → 1.01 → 1.0)
- 300ms delay before pulse (feels intentional)

### Confidence Indication
- Border thickness varies by confidence:
  - Low (<50%): 1px
  - Medium (50-80%): 2px
  - High (>80%): 3px

### Margin Annotations (Hover Only)
- Small pill badge in left margin on hover
- Shows claim type icon + abbreviated label ("Eff", "Saf", etc.)
- Keeps document clean when not interacting

### Bidirectional Sync
- Click claim card → document scrolls to highlight (smooth, centered)
- Click highlight → claim card activates + scrolls into view in panel
- Shared `activeClaim` state keeps both in sync

---

## Results Summary Panel

### Layout
```
┌─────────────────────────────────────────────┐
│  Results Summary                            │
├─────────────────────────────────────────────┤
│  Core Claims Found     8 of 12    ████████░░│
│  AI-Discovered         +4 new               │
│  ─────────────────────────────────────────  │
│  Approved [3]   Rejected [1]   Pending [8]  │
│                                             │
│  ⚡ 2.3s  •  Gemini 3                       │
└─────────────────────────────────────────────┘
```

### Stats Breakdown
- **Core Claims Found:** X of Y with progress bar
- **AI-Discovered:** +Z new (claims not in cheat sheet)
- **Status counts:** Approved, Rejected, Pending
- **Footer:** Processing time + Model name (from dropdown)

---

## Claims Panel

### Claim Card Components
- **Header:** Confidence bar + percentage + type badge + source badge
- **Body:** Claim text in quotes
- **Location:** Paragraph reference with map pin icon
- **Actions:** Thumbs up (Approve) / Thumbs down (Reject) - only on pending
- **Feedback form:** Textarea appears on reject click

### Source Badges
- **Core:** Solid badge style
- **AI Found:** Dashed border badge style

### Card States
- **Pending:** Default, shows action buttons
- **Approved:** Green "Approved" badge, no actions
- **Rejected:** Red "Rejected" badge, shows feedback if provided

### Action Feedback
- Brief success animation on approve (checkmark flash)
- Brief animation on reject (X flash)

---

## Filter System

### Status Tabs (Primary)
```
[ All (12) ] [ Pending (8) ] [ Approved (3) ] [ Rejected (1) ]
```

### Type Chips (Secondary - Multi-select)
```
[Efficacy] [Safety] [Regulatory] [Comparative] [Dosage] [Ingredient] [Testimonial] [Pricing]
```
- Click to toggle on/off
- Multiple can be active
- "Clear filters" appears when any active

### Source Toggle (Tertiary)
```
[ All Sources ] [ Core Only ] [ AI-Discovered Only ]
```

---

## Dependencies to Add

```bash
npm install framer-motion
```

---

## Files to Create/Modify

### New Files
- `src/mocks/documents.js` - Sample pharma documents
- `src/mocks/claims.js` - Mock claims data
- `src/components/claims-detector/ScannerOverlay.jsx` - Scanning animation
- `src/components/claims-detector/ScannerOverlay.module.css`
- `src/components/claims-detector/ProgressRing.jsx` - Circular progress
- `src/components/claims-detector/AIParticles.jsx` - Particle effect

### Modify
- `src/App.jsx` - Wire up mock data, new filters, stats display
- `src/App.css` - Results summary styling
- `src/components/claims-detector/DocumentViewer.jsx` - Enhanced highlights
- `src/components/claims-detector/DocumentViewer.module.css` - Highlight styles
- `src/components/claims-detector/ClaimCard.jsx` - Source badge, action animations
- `src/components/claims-detector/ClaimCard.module.css` - New badge styles

---

## Open Questions for Future

1. **Real API integration:** How will the cheat sheet be uploaded/managed?
2. **Model comparison:** UI for running same doc through multiple models?
3. **Export:** Download results as CSV/JSON for analysis?
4. **Batch processing:** Upload multiple documents at once?

---

## Next Steps

1. Create implementation plan with task breakdown
2. Set up git worktree for isolated development
3. Implement in order: Mock data → Scanner animation → Highlights → Filters → Stats
