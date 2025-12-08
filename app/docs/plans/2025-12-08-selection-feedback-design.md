# Selection Feedback Enhancement Design

## Problem

The current bidirectional selection between ClaimCards and DocumentViewer highlights is too subtle:
- Selected cards have a thin border that doesn't stand out
- Document highlights use a minimal `scale(1.01)` pulse that's barely noticeable

Users need clearer visual feedback when clicking either element.

## Solution

### 1. ClaimCard Selection: 2px Border + Glow

**File:** `src/components/claims-detector/ClaimCard.module.css`

Replace the current `.claimCard.active` styles:

```css
.claimCard.active {
  border: 2px solid var(--color-interactive-default);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15),
              0 0 12px rgba(59, 130, 246, 0.25);
}
```

**Effect:** Double border thickness with a soft outer glow that makes selected cards clearly "pop".

### 2. Document Highlight: Pulse Glow Animation

**File:** `src/components/claims-detector/DocumentViewer.module.css`

Replace the current `highlightPulse` animation with an expanding ring effect:

```css
.highlight.activeHighlight {
  background-color: color-mix(in srgb, var(--claim-color) 30%, transparent);
  animation: glowPulse 1.2s ease-out;
}

@keyframes glowPulse {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--claim-color) 50%, transparent); }
  25% { box-shadow: 0 0 0 8px transparent; }
  50% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--claim-color) 40%, transparent); }
  75% { box-shadow: 0 0 0 6px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
}
```

**Effect:** 2 expanding rings pulse outward from the highlight, naturally drawing the user's eye to the selected text.

## Files to Modify

1. `src/components/claims-detector/ClaimCard.module.css` - Update `.claimCard.active` styles
2. `src/components/claims-detector/DocumentViewer.module.css` - Replace `highlightPulse` keyframes

## Verification

1. Click a ClaimCard → card should have thick border + glow, document highlight should pulse
2. Click highlighted text in document → corresponding card should have thick border + glow
3. Animation should run once per selection, not loop
