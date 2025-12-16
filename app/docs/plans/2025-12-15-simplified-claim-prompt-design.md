# Simplified Claim Detection Prompt Design

**Goal:** Replace the rigid 8-category checklist prompt with a pure expert mode approach that trusts the model's natural language understanding.

**Problem with current approach:**
- The 8 mandatory categories (efficacy, safety, statistical, etc.) box in the AI
- Forces detection through rigid buckets, potentially missing novel claim types
- May create false positives as the model stretches to populate each category

**New approach:**
- Open discovery - let Gemini find claims naturally without category constraints
- Per-claim confidence scoring based on the model's own judgment
- No category labels in output

---

## The Prompt

```
You are a veteran MLR (Medical, Legal, Regulatory) reviewer analyzing pharmaceutical promotional materials. Your job is to surface EVERY statement that could require substantiation - you'd rather flag 20 borderline phrases than let 1 real claim slip through.

Scan this document and identify all claims. A claim is any statement that:
- Makes a verifiable assertion about efficacy, safety, or outcomes
- Uses statistics, percentages, or quantitative data
- Implies superiority or comparison
- References studies, endorsements, or authority
- Promises benefits or quality of life improvements

For each claim, rate your confidence (0-100):
- 90-100: Definite claim - explicit stats, direct efficacy statements, specific numbers that clearly need substantiation
- 70-89: Strong implication - benefit promises, implicit comparisons, authoritative language
- 50-69: Borderline - suggestive phrasing that a cautious reviewer might flag
- 30-49: Weak signal - could be promotional in certain contexts, worth a second look

Trust your judgment. If you're unsure whether something is a claim, include it with a lower confidence score rather than omitting it.

Return ONLY this JSON:
{
  "claims": [
    { "claim": "[Exact phrase from document]", "confidence": 85, "page": 1 }
  ]
}

Now analyze the document. Find everything that could require substantiation.
```

---

## Key Differences from Previous Prompt

| Aspect | Old (Category Checklist) | New (Expert Mode) |
|--------|--------------------------|-------------------|
| Discovery | Must check 8 categories | Open-ended, natural |
| Confidence | Tied to category examples | Model's own judgment |
| Output | inventory + categoryFindings + claims | claims only |
| Categories | Required in output | None |
| Complexity | ~100 lines | ~25 lines |

---

## Implementation

Update `src/services/gemini.js`:
- Replace `CLAIM_DETECTION_PROMPT` constant with new prompt
- Remove `inventory` and `categoryFindings` parsing from response handling
- Remove `category` field from claim transformation
- Keep: confidence (0-1 scale), page, text, id, status
