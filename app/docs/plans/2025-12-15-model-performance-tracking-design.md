# Model Performance Tracking Design

**Goal:** Add a "Model Performance" accordion showing model name, processing time, per-run cost, and cumulative API spend.

**Architecture:** Extract token usage from Gemini API response, calculate cost, persist total to localStorage.

---

## Data Flow

**Source:** Gemini API response includes `usageMetadata`:
- `promptTokenCount` (input tokens)
- `candidatesTokenCount` (output tokens)

**Cost calculation:** Based on Gemini pricing per 1M tokens (input/output rates).

**Persistence:** `totalCost` stored in localStorage, accumulates across sessions.

---

## Implementation

### 1. Model Display Names (gemini.js)

```javascript
const MODEL_DISPLAY_NAMES = {
  'gemini-3-pro-preview': 'Gemini 3 Pro',
  'gemini-2.0-flash': 'Gemini 2.0 Flash',
}
```

### 2. Return Usage from analyzeDocument()

```javascript
return {
  success: true,
  claims,
  usage: {
    inputTokens: number,
    outputTokens: number,
    cost: number  // calculated in dollars
  }
}
```

### 3. MKGClaimsDetector State

- `runCost` - cost of current/last analysis
- `totalCost` - cumulative, synced with localStorage

### 4. Model Performance Accordion

| Field | Example |
|-------|---------|
| Model | Gemini 3 Pro |
| Time | 3.2s |
| Run Cost | $0.04 |
| Total to Date | $1.27 |

### 5. Remove from Results Summary

- Remove processing time row
- Remove model name from meta row
- Keep only claim counts

---

## UI Changes

**Before:**
- Results Summary: claims + time + model

**After:**
- Results Summary: claims only
- Model Performance: model + time + cost + total
