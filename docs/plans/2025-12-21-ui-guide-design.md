# UI Guide Design: Interactive Screenshot Walkthrough

**Date:** 2025-12-21
**Status:** Approved
**Scope:** MKG Claims Detector - PDF loaded, pre-analysis state

## Overview

An interactive HTML guide that overlays a screenshot of the MKG Claims Detector with clickable hotspots. When the user clicks a hotspot, the UI dims except for that element, and a floating tooltip appears explaining its purpose.

## User Experience

1. User opens the HTML file (can be hosted or opened locally)
2. They see a screenshot of the app with 5 glowing hotspot markers
3. Clicking any hotspot dims the rest of the UI (60% opacity overlay)
4. The clicked element stays bright, with a tooltip card beside it
5. Clicking elsewhere or pressing Escape closes the spotlight and returns to the overview

## Technical Approach

- Single self-contained HTML file (no build step, easy to share)
- Screenshot as background image
- CSS for spotlight effect (pseudo-element overlay with `clip-path` to cut out the highlighted region)
- Vanilla JS for hotspot interactions

## Visual Design

### Hotspot Markers
- Small pulsing circles (12-16px) with subtle glow animation
- Numbered 1-5 so users know how many elements exist
- Positioned at center of each UI element's bounding box
- Percentage-based coordinates for responsiveness

### Spotlight Effect
- Dark overlay (rgba black, ~60% opacity) covers entire screenshot
- Highlighted element "cut out" via CSS clip-path, stays fully bright
- Subtle box-shadow or border glow on the highlighted element

### Tooltip Card
- Floating card positioned intelligently (left/right/above/below based on element location)
- Contains:
  - **Title** — Element name
  - **Description** — 1-2 sentences explaining purpose
  - **Optional tip** — Usage hint if relevant
- Card has slight drop shadow, rounded corners, clean typography

### Transitions
- Smooth fade-in for overlay (~200ms)
- Tooltip slides in from nearest edge
- Closing reverses the animation

## Annotated Elements

| # | Element | Position | Tooltip Content |
|---|---------|----------|-----------------|
| 1 | PDF Viewer | Left panel | "Your uploaded document appears here. Once analysis runs, colored pins mark each detected claim directly on the page." |
| 2 | Model Selector | Top right config area | "Choose which AI model analyzes your document. Options include Gemini, Claude, and GPT-4o — each with different strengths." |
| 3 | Claim Focus | Below model selector | "Filter what types of claims to detect: All Claims, Disease State only, or Medication only. Narrower focus = more relevant results." |
| 4 | Analyze Button | Config panel | "Runs AI analysis on the uploaded PDF. Processing typically takes 10-30 seconds depending on document length." |
| 5 | Claims Panel | Right panel | "Detected claims appear here after analysis. Each card shows the claim text, confidence score, and approval status." |

## File Structure

```
docs/ui-guide/
├── index.html          # Self-contained interactive guide
└── screenshot.png      # Captured screenshot of PDF-loaded state
```

## Screenshot Requirements

- Viewport: 1440x900
- State: PDF loaded, pre-analysis (no claims yet)
- Sample PDF visible in viewer
- All config options visible and enabled

## Future Extensibility

- Additional states (empty, post-analysis) = new screenshot + new hotspot config
- Could evolve into multi-page guide with navigation between states
