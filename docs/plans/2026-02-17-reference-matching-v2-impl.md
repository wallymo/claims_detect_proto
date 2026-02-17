# Reference Matching V2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current passage-chunk-based matching pipeline with a fact-anchored + full-reference extraction pipeline that returns verified verbatim quotes.

**Architecture:** Four-tier pipeline: Tier 0.5 (fact embedding search) → Tier 1 (semantic retrieval to narrow references) → Tier 2 (full-reference extraction via Gemini Flash) → Tier 2b (quote verification against actual text). No deduplication — every claim instance is a separate MLR annotation.

**Tech Stack:** Gemini embedding-001 (768-dim), Gemini 2.0 Flash (extraction), SQLite, Express, React/Vite

**Design doc:** `docs/plans/2026-02-17-reference-matching-v2-design.md`

---

### Task 1: Migration — Add embedding column to reference_facts

**Files:**
- Create: `backend/migrations/006_fact_embeddings.sql`

**Step 1: Write migration SQL**

```sql
ALTER TABLE reference_facts ADD COLUMN embedding BLOB;
ALTER TABLE reference_facts ADD COLUMN embedding_model TEXT;
```

**Step 2: Verify migration runs on backend startup**

Run: `cd backend && npm run dev`
Expected: Server starts, migration 006 applies. Check logs for "Running migration 006".

**Step 3: Verify column exists**

Run: `cd backend && node -e "import('./src/config/database.js').then(m => { m.initDb(); const db = m.getDb(); console.log(db.pragma('table_info(reference_facts)').map(c => c.name)); m.closeDb(); })"`
Expected: Column list includes `embedding` and `embedding_model`.

**Step 4: Commit**

```bash
git add backend/migrations/006_fact_embeddings.sql
git commit -m "feat: add embedding column to reference_facts (migration 006)"
```

---

### Task 2: ReferenceFact model — Add embedding search methods

**Files:**
- Modify: `backend/src/models/ReferenceFact.js`

**Step 1: Add `findByBrandIdWithEmbeddings` method**

After the existing `findByBrandId` method, add:

```javascript
findByBrandIdWithEmbeddings(brandId) {
  const db = getDb()
  const rows = db.prepare(`
    SELECT rf.*, rd.display_alias, rd.filename, rd.id as ref_doc_id
    FROM reference_facts rf
    JOIN reference_documents rd ON rd.id = rf.reference_id
    WHERE rd.brand_id = ?
      AND rd.deleted_at IS NULL
      AND rf.extraction_status = 'indexed'
      AND rf.embedding IS NOT NULL
  `).all(brandId)
  return rows.map(row => ({
    ...row,
    facts: row.facts_json ? JSON.parse(row.facts_json) : []
  }))
},
```

**Step 2: Add `updateEmbedding` method**

```javascript
updateEmbedding(referenceId, embedding, embeddingModel) {
  const db = getDb()
  db.prepare(`
    UPDATE reference_facts
    SET embedding = ?, embedding_model = ?, updated_at = CURRENT_TIMESTAMP
    WHERE reference_id = ?
  `).run(embedding, embeddingModel, referenceId)
  return this.findByReferenceId(referenceId)
},
```

**Step 3: Commit**

```bash
git add backend/src/models/ReferenceFact.js
git commit -m "feat: add embedding search methods to ReferenceFact model"
```

---

### Task 3: Fact embedding script

**Files:**
- Create: `backend/scripts/embed-facts.js`

**Step 1: Write the embed-facts script**

Model it on `backend/scripts/embed-references.js` but much simpler — embed the concatenated fact text for each reference's facts (not individual facts, since facts_json is per-reference).

```javascript
import 'dotenv/config'
import { initDb, getDb, closeDb } from '../src/config/database.js'
import { embedText } from '../src/services/passageEmbedder.js'
import { ReferenceFact } from '../src/models/ReferenceFact.js'

function parseArgs() {
  const args = process.argv.slice(2)
  const flags = { force: false, brandId: null, concurrency: 3 }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') flags.force = true
    if (args[i] === '--brand-id' && args[i + 1]) flags.brandId = parseInt(args[++i], 10)
    if (args[i] === '--concurrency' && args[i + 1]) flags.concurrency = parseInt(args[++i], 10) || 3
  }
  return flags
}

async function main() {
  const flags = parseArgs()
  initDb()
  const db = getDb()

  // Get all indexed facts
  let query = `
    SELECT rf.reference_id, rf.facts_json, rf.embedding, rd.display_alias, rd.brand_id
    FROM reference_facts rf
    JOIN reference_documents rd ON rd.id = rf.reference_id
    WHERE rf.extraction_status = 'indexed'
      AND rf.facts_json IS NOT NULL
      AND rd.deleted_at IS NULL
  `
  const params = []
  if (flags.brandId) {
    query += ' AND rd.brand_id = ?'
    params.push(flags.brandId)
  }
  if (!flags.force) {
    query += ' AND rf.embedding IS NULL'
  }

  const rows = db.prepare(query).all(...params)
  console.log(`Found ${rows.length} reference fact sets to embed`)

  let embedded = 0
  let failed = 0

  for (const row of rows) {
    try {
      const facts = JSON.parse(row.facts_json)
      if (!facts || facts.length === 0) {
        console.log(`  Skip ref ${row.reference_id} (${row.display_alias}): no facts`)
        continue
      }

      // Concatenate all fact texts into one string for embedding
      const factText = facts.map(f => f.text || '').filter(Boolean).join('\n')
      if (!factText.trim()) {
        console.log(`  Skip ref ${row.reference_id} (${row.display_alias}): empty fact text`)
        continue
      }

      const embedding = await embedText(factText)
      ReferenceFact.updateEmbedding(row.reference_id, embedding, 'gemini-embedding-001')
      embedded++
      console.log(`  Embedded ref ${row.reference_id} (${row.display_alias}): ${facts.length} facts, ${factText.length} chars`)

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 100))
    } catch (err) {
      failed++
      console.error(`  Failed ref ${row.reference_id} (${row.display_alias}):`, err.message)
    }
  }

  console.log(`\nDone: ${embedded} embedded, ${failed} failed, ${rows.length - embedded - failed} skipped`)
  closeDb()
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
```

**Step 2: Test the script (dry run)**

Run: `cd backend && node scripts/embed-facts.js --brand-id 1`
Expected: Embeds facts for brand 1's references. Each line shows reference name + fact count.

**Step 3: Commit**

```bash
git add backend/scripts/embed-facts.js
git commit -m "feat: add embed-facts script for fact embedding generation"
```

---

### Task 4: Fact search endpoint

**Files:**
- Modify: `backend/src/controllers/factController.js`
- Modify: `backend/src/routes/facts.js`
- Modify: `app/src/services/api.js`

**Step 1: Add searchFacts to factController**

Add to `factController` object in `backend/src/controllers/factController.js`:

```javascript
async searchFacts(req, res, next) {
  try {
    const brandId = parseInt(req.params.brandId, 10)
    const brand = Brand.findById(brandId)
    if (!brand) throw new AppError('Brand not found', 404)

    const { claim_text } = req.body
    if (!claim_text || claim_text.trim().length === 0) {
      throw new AppError('claim_text is required', 400)
    }

    // Get all facts with embeddings for this brand
    const factSets = ReferenceFact.findByBrandIdWithEmbeddings(brandId)
    if (factSets.length === 0) {
      return res.json({ results: [], count: 0 })
    }

    // Embed the claim
    const { embedText } = await import('../services/passageEmbedder.js')
    const queryEmbedding = await embedText(claim_text.trim())

    // Cosine similarity search across fact embeddings
    const results = factSets
      .filter(fs => fs.embedding)
      .map(fs => {
        const similarity = cosineSimilarity(queryEmbedding, fs.embedding)
        return {
          reference_id: fs.reference_id,
          display_alias: fs.display_alias,
          facts: fs.facts,
          similarity
        }
      })
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5)

    res.json({ results, count: results.length })
  } catch (err) {
    next(err)
  }
}
```

Add cosine similarity helper at top of file (or import from ReferencePassage — but simpler to inline):

```javascript
function cosineSimilarity(bufA, bufB) {
  const a = new Float32Array(bufA.buffer, bufA.byteOffset, bufA.byteLength / 4)
  const b = new Float32Array(bufB.buffer, bufB.byteOffset, bufB.byteLength / 4)
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
```

**Step 2: Add route**

In `backend/src/routes/facts.js`, add to `brandFactRoutes`:

```javascript
brandFactRoutes.post('/facts/search', factController.searchFacts)
```

**Step 3: Add frontend API function**

In `app/src/services/api.js`, add after `searchPassages`:

```javascript
export async function searchFacts(brandId, claimText) {
  return request(`/brands/${brandId}/facts/search`, {
    method: 'POST',
    body: JSON.stringify({ claim_text: claimText })
  })
}
```

**Step 4: Verify endpoint works**

Run backend, then: `curl -X POST http://localhost:3001/api/brands/1/facts/search -H 'Content-Type: application/json' -d '{"claim_text":"seizure frequency reduction"}'`
Expected: JSON with `results` array containing references sorted by similarity.

**Step 5: Commit**

```bash
git add backend/src/controllers/factController.js backend/src/routes/facts.js app/src/services/api.js
git commit -m "feat: add fact search endpoint for Tier 0.5 matching"
```

---

### Task 5: Quote verification utility (TDD)

**Files:**
- Create: `app/src/utils/quoteVerifier.js`
- Create: `app/test/utils/quoteVerifier.test.js`

**Step 1: Write failing tests**

```javascript
import { describe, it, expect } from 'vitest'
import { verifyQuote } from '../../src/utils/quoteVerifier.js'

describe('quoteVerifier', () => {
  const referenceText = `
    In the Phase 3 clinical trial, Drug X demonstrated a 47% reduction
    in seizure frequency compared to placebo (p<0.001, n=500).
    Discontinuation due to adverse events occurred in 3.2% of patients
    versus 2.8% in the placebo group. The most common adverse events
    were headache (12%), nausea (8%), and dizziness (6%).
  `.trim()

  describe('verified — exact substring', () => {
    it('returns verified when quote is an exact substring', () => {
      const quote = '47% reduction in seizure frequency compared to placebo'
      const result = verifyQuote(quote, referenceText)
      expect(result.status).toBe('verified')
      expect(result.charOffset).toBeGreaterThan(0)
    })

    it('handles whitespace normalization', () => {
      const quote = '47% reduction  in seizure frequency compared to placebo'
      const result = verifyQuote(quote, referenceText)
      expect(result.status).toBe('verified')
    })
  })

  describe('verified — fuzzy match (>=80% LCS)', () => {
    it('returns verified when quote is close but not exact', () => {
      const quote = '47% reduction in seizure frequency versus placebo'
      const result = verifyQuote(quote, referenceText)
      expect(result.status).toBe('verified')
    })
  })

  describe('partial — numeric tokens in same paragraph', () => {
    it('returns partial when key numbers appear nearby', () => {
      const quote = 'Seizure frequency was reduced by 47% with statistical significance of p<0.001'
      const result = verifyQuote(quote, referenceText)
      expect(result.status).toBe('partial')
    })
  })

  describe('unverified — hallucinated quote', () => {
    it('returns unverified when quote has no match', () => {
      const quote = 'Drug Y showed 83% improvement in cognitive function'
      const result = verifyQuote(quote, referenceText)
      expect(result.status).toBe('unverified')
    })
  })

  describe('edge cases', () => {
    it('handles empty quote', () => {
      const result = verifyQuote('', referenceText)
      expect(result.status).toBe('unverified')
    })

    it('handles empty reference', () => {
      const result = verifyQuote('some quote', '')
      expect(result.status).toBe('unverified')
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run test/utils/quoteVerifier.test.js`
Expected: FAIL — module not found.

**Step 3: Implement quoteVerifier.js**

```javascript
/**
 * Verify that an AI-generated quote actually exists in the reference text.
 * Returns { status, charOffset, matchedText } where status is:
 *   - 'verified': exact or near-exact match found
 *   - 'partial': key numeric tokens found in same paragraph
 *   - 'unverified': no match (likely hallucination)
 */
export function verifyQuote(quote, referenceText) {
  if (!quote || !referenceText) {
    return { status: 'unverified', charOffset: null, matchedText: null }
  }

  const normQuote = normalize(quote)
  const normRef = normalize(referenceText)

  if (!normQuote || !normRef) {
    return { status: 'unverified', charOffset: null, matchedText: null }
  }

  // Check 1: Exact substring match (after normalization)
  const exactIndex = normRef.indexOf(normQuote)
  if (exactIndex !== -1) {
    return { status: 'verified', charOffset: exactIndex, matchedText: normQuote }
  }

  // Check 2: Sliding window LCS — find best-matching window in reference
  const windowSize = Math.min(normQuote.length * 2, normRef.length)
  let bestLcsRatio = 0
  let bestOffset = 0

  // Slide across reference in steps to find region with highest overlap
  const step = Math.max(1, Math.floor(normQuote.length / 4))
  for (let start = 0; start <= normRef.length - normQuote.length / 2; start += step) {
    const window = normRef.slice(start, start + windowSize)
    const lcsLen = longestCommonSubsequenceLength(normQuote, window)
    const ratio = lcsLen / normQuote.length
    if (ratio > bestLcsRatio) {
      bestLcsRatio = ratio
      bestOffset = start
    }
  }

  if (bestLcsRatio >= 0.80) {
    return { status: 'verified', charOffset: bestOffset, matchedText: null }
  }

  // Check 3: Numeric tokens in same paragraph
  const quoteNumerics = extractNumerics(quote)
  if (quoteNumerics.length > 0) {
    const paragraphs = referenceText.split(/\n\s*\n|\.\s+/)
    for (let i = 0; i < paragraphs.length; i++) {
      const paraLower = paragraphs[i].toLowerCase()
      const found = quoteNumerics.filter(n => paraLower.includes(n))
      if (found.length === quoteNumerics.length) {
        // Estimate char offset of this paragraph
        const offset = referenceText.indexOf(paragraphs[i])
        return { status: 'partial', charOffset: offset >= 0 ? offset : null, matchedText: null }
      }
    }
  }

  return { status: 'unverified', charOffset: null, matchedText: null }
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9%.<>=\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractNumerics(text) {
  const nums = new Set()
  const lower = text.toLowerCase()
  const matches = lower.match(/\b\d+(?:\.\d+)?%?\b/g) || []
  matches.forEach(m => nums.add(m))
  const pvals = lower.match(/p\s*[<>=]\s*0?\.\d+/g) || []
  pvals.forEach(m => nums.add(m.replace(/\s+/g, '')))
  return [...nums]
}

/**
 * Length of longest common subsequence between two strings.
 * O(n*m) DP — acceptable for strings under ~1000 chars.
 */
function longestCommonSubsequenceLength(a, b) {
  if (!a || !b) return 0
  // Use shorter string as rows for memory efficiency
  const short = a.length <= b.length ? a : b
  const long = a.length <= b.length ? b : a
  const prev = new Uint16Array(short.length + 1)
  const curr = new Uint16Array(short.length + 1)

  for (let i = 1; i <= long.length; i++) {
    for (let j = 1; j <= short.length; j++) {
      if (long[i - 1] === short[j - 1]) {
        curr[j] = prev[j - 1] + 1
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1])
      }
    }
    prev.set(curr)
    curr.fill(0)
  }
  return prev[short.length]
}
```

**Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run test/utils/quoteVerifier.test.js`
Expected: All 6 tests PASS.

**Step 5: Commit**

```bash
git add app/src/utils/quoteVerifier.js app/test/utils/quoteVerifier.test.js
git commit -m "feat: add quote verification utility with TDD tests"
```

---

### Task 6: Full-reference extraction prompt in gemini.js

**Files:**
- Modify: `app/src/services/gemini.js:720-795`

**Step 1: Add new `extractSupportingQuote` function**

Add this new function below the existing `matchClaimToReferences` (keep the old one for now — we'll remove it in Task 9):

```javascript
/**
 * Extract a verbatim supporting quote from a full reference document.
 * Used by Matching V2 Tier 2 — sends full reference text and asks AI to find exact quotes.
 *
 * @param {string} claimText - The claim needing substantiation
 * @param {string} referenceText - Full extracted text of the reference document
 * @param {string} referenceName - Display name of the reference
 * @returns {Promise<Object>} - { result: { supported, quotes, reasoning }, usage }
 */
export async function extractSupportingQuote(claimText, referenceText, referenceName) {
  const client = getGeminiClient()

  const prompt = `You are an MLR (Medical, Legal, Regulatory) reviewer verifying whether a reference document supports a specific claim.

CLAIM: "${claimText}"

REFERENCE DOCUMENT (${referenceName}):
${referenceText}

TASK: Find the exact sentence(s) in this reference that substantiate this claim. Quote them VERBATIM — do not paraphrase, do not combine sentences, do not add words.

Return JSON:
{
  "supported": true or false,
  "quotes": [
    {
      "text": "exact verbatim quote copied from the reference above",
      "page_estimate": number or null
    }
  ],
  "reasoning": "1-2 sentence explanation of how the quote supports (or why nothing supports) the claim"
}

Rules:
- Only return supported=true if the reference ACTUALLY contains text that substantiates the claim.
- Quotes must be VERBATIM text from the reference document above. Copy-paste, do not rephrase.
- If the reference contains related but non-substantiating content, return supported=false with reasoning.
- Multiple quotes are allowed if multiple sentences together substantiate the claim.
- If no text supports the claim, return supported=false with empty quotes array.`

  try {
    const matchingModel = 'gemini-2.0-flash'
    const response = await client.models.generateContent({
      model: matchingModel,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0,
        maxOutputTokens: 4096,
        responseMimeType: 'application/json'
      }
    })

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text || response.text
    const parsedResult = parseJsonResponse(text, 'Gemini quote extraction response')
    const usage = extractUsageMetadata(response)
    const cost = calculateCost(matchingModel, usage.inputTokens, usage.outputTokens)

    return {
      result: parsedResult,
      usage: {
        model: matchingModel,
        modelDisplayName: MODEL_DISPLAY_NAMES[matchingModel] || matchingModel,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cost
      }
    }
  } catch (error) {
    logger.error('Quote extraction error:', error)
    throw new Error(`Quote extraction failed: ${error.message}`)
  }
}
```

**Step 2: Commit**

```bash
git add app/src/services/gemini.js
git commit -m "feat: add extractSupportingQuote function for Tier 2 matching"
```

---

### Task 7: Rewrite matchSingleClaim — the core V2 pipeline

**Files:**
- Modify: `app/src/services/referenceMatching.js:508-689`

**Step 1: Add imports**

At top of `referenceMatching.js`, add:

```javascript
import { extractSupportingQuote } from './gemini.js'
import { verifyQuote } from '@/utils/quoteVerifier.js'
```

Update the existing import to keep `matchClaimToReferences` for the keyword fallback:

```javascript
import { matchClaimToReferences, extractSupportingQuote } from './gemini.js'
```

**Step 2: Add Tier 0.5 fact-anchored search function**

Add before `matchSingleClaim`:

```javascript
const FACT_ANCHOR_MIN_SIMILARITY = 0.90
const FACT_ANCHOR_MIN_KEYWORD_OVERLAP = 2

async function factAnchoredSearch(claim, brandId, telemetry) {
  try {
    const response = await api.searchFacts(brandId, claim.text)
    const results = response.results || []
    if (results.length === 0) return null

    const top = results[0]
    if (top.similarity < FACT_ANCHOR_MIN_SIMILARITY) return null

    // Check keyword overlap — need at least 2 shared keywords or 1 shared numeric
    const claimKeywords = extractKeywords(claim.text)
    const claimNumerics = extractNumericTokens(claim.text)
    const factTexts = (top.facts || []).map(f => f.text || '').join(' ').toLowerCase()

    const keywordMatches = claimKeywords.filter(kw => factTexts.includes(kw))
    const numericMatches = claimNumerics.filter(n => factTexts.includes(n))

    if (keywordMatches.length < FACT_ANCHOR_MIN_KEYWORD_OVERLAP && numericMatches.length === 0) {
      return null
    }

    // Find the best matching individual fact
    const bestFact = (top.facts || []).reduce((best, fact) => {
      const factLower = (fact.text || '').toLowerCase()
      const score = claimKeywords.filter(kw => factLower.includes(kw)).length
      return score > (best?.score || 0) ? { ...fact, score } : best
    }, null)

    telemetry.fact_anchored_count = (telemetry.fact_anchored_count || 0) + 1
    return {
      matched: true,
      matchConfidence: top.similarity,
      matchTier: 'fact-anchored',
      reference: {
        id: top.reference_id,
        name: top.display_alias,
        page: bestFact?.page || null,
        excerpt: bestFact?.text || top.facts?.[0]?.text || null
      },
      matchReasoning: `Fact-anchored match (similarity ${(top.similarity * 100).toFixed(0)}%, ${keywordMatches.length} keywords, ${numericMatches.length} numerics)`
    }
  } catch (err) {
    logger.warn('Fact-anchored search failed, falling through:', err.message)
    return null
  }
}
```

**Step 3: Add reference grouping helper**

```javascript
function groupByReference(rerankedResults, maxRefs = 3) {
  const refMap = new Map()
  for (const result of rerankedResults) {
    const refId = result.reference_id
    if (!refMap.has(refId)) {
      refMap.set(refId, {
        reference_id: refId,
        display_alias: result.display_alias,
        bestHybridScore: result.hybrid_score,
        bestSemanticScore: result.semantic_score
      })
    }
  }
  return Array.from(refMap.values())
    .sort((a, b) => b.bestHybridScore - a.bestHybridScore)
    .slice(0, maxRefs)
}
```

**Step 4: Add Tier 2 full-reference extraction function**

```javascript
const TIER2_MAX_REFERENCES = 3

async function fullReferenceExtraction(claim, candidateRefs, allReferences, telemetry) {
  for (const candidateRef of candidateRefs) {
    try {
      // Fetch full reference text
      const refObj = allReferences.find(r => r.id === candidateRef.reference_id)
      if (!refObj) continue

      const textData = await api.fetchReferenceText(candidateRef.reference_id)
      if (!textData?.content_text) continue

      telemetry.extraction_ai_calls = (telemetry.extraction_ai_calls || 0) + 1

      const extractionResult = await extractSupportingQuote(
        claim.text,
        textData.content_text,
        candidateRef.display_alias
      )

      accumulateMatchingUsage(telemetry, extractionResult?.usage)

      const result = extractionResult?.result
      if (!result || !result.supported || !result.quotes?.length) continue

      // Tier 2b: Verify the quote
      const bestQuote = result.quotes[0]
      const verification = verifyQuote(bestQuote.text, textData.content_text)

      if (verification.status === 'unverified') {
        telemetry.unverified_quotes = (telemetry.unverified_quotes || 0) + 1
        // Try a second quote if available
        if (result.quotes.length > 1) {
          const altVerification = verifyQuote(result.quotes[1].text, textData.content_text)
          if (altVerification.status !== 'unverified') {
            const pageEstimate = altVerification.charOffset != null && textData.page_count
              ? Math.floor(altVerification.charOffset / (textData.content_text.length / textData.page_count)) + 1
              : result.quotes[1].page_estimate
            return {
              matched: true,
              matchConfidence: verification.status === 'verified' ? 0.90 : 0.75,
              matchTier: altVerification.status === 'verified' ? 'verified-extraction' : 'partial-extraction',
              reference: {
                id: candidateRef.reference_id,
                name: candidateRef.display_alias,
                page: pageEstimate,
                excerpt: result.quotes[1].text
              },
              matchReasoning: result.reasoning
            }
          }
        }
        continue // All quotes unverified, try next reference
      }

      // Compute page from char offset if we have it
      const pageEstimate = verification.charOffset != null && textData.page_count
        ? Math.floor(verification.charOffset / (textData.content_text.length / textData.page_count)) + 1
        : bestQuote.page_estimate

      telemetry.verified_quotes = (telemetry.verified_quotes || 0) + 1
      return {
        matched: true,
        matchConfidence: verification.status === 'verified' ? 0.95 : 0.80,
        matchTier: verification.status === 'verified' ? 'verified-extraction' : 'partial-extraction',
        reference: {
          id: candidateRef.reference_id,
          name: candidateRef.display_alias,
          page: pageEstimate,
          excerpt: bestQuote.text
        },
        matchReasoning: result.reasoning
      }
    } catch (err) {
      logger.warn(`Extraction failed for ref ${candidateRef.reference_id}:`, err.message)
      continue
    }
  }

  return null // No verified match found
}
```

**Step 5: Rewrite matchSingleClaim**

Replace the entire `matchSingleClaim` function (lines 508-689) with:

```javascript
async function matchSingleClaim(claim, brandId, allReferences, options = {}) {
  const {
    topK = DEFAULT_TOP_K,
    candidatePool = DEFAULT_CANDIDATE_POOL,
    telemetry,
    onStage,
    getFallbackReferencesWithText
  } = options

  const claimStartedAt = Date.now()

  try {
    // Tier 0.5: Fact-anchored search
    onStage?.('facts')
    const factMatch = await factAnchoredSearch(claim, brandId, telemetry)
    if (factMatch) {
      return { ...claim, ...factMatch }
    }

    // Tier 1: Semantic retrieval → narrow to top references
    let searchResults = []
    try {
      telemetry.semantic_search_count++
      onStage?.('retrieve')
      const retrievalTopK = Math.max(topK, candidatePool)
      const response = await api.searchPassages(brandId, claim.text, retrievalTopK, { candidatePool })
      searchResults = (response.results || []).slice(0, candidatePool)
    } catch (err) {
      telemetry.keyword_fallback_count++
      onStage?.('fallback')
      logger.warn(`Semantic search failed for claim ${claim.id}, falling back to keyword matching:`, err.message)
      return keywordFallbackMatch(claim, getFallbackReferencesWithText, telemetry)
    }

    if (searchResults.length === 0) {
      return {
        ...claim,
        matched: false,
        reference: null,
        matchReasoning: 'No similar passages found in reference library'
      }
    }

    // Hybrid rerank
    const rerankedResults = MATCHING_HYBRID_ENABLED
      ? rerankSemanticResults(claim.text, searchResults)
      : enrichSemanticOnlyResults(searchResults)

    // Group by reference — pick top 3
    const candidateRefs = groupByReference(rerankedResults, TIER2_MAX_REFERENCES)

    if (candidateRefs.length === 0) {
      return {
        ...claim,
        matched: false,
        reference: null,
        matchReasoning: 'No candidate references found above threshold'
      }
    }

    // Tier 2 + 2b: Full-reference extraction with quote verification
    onStage?.('extract')
    const extractionMatch = await fullReferenceExtraction(claim, candidateRefs, allReferences, telemetry)
    if (extractionMatch) {
      return { ...claim, ...extractionMatch }
    }

    return {
      ...claim,
      matched: false,
      reference: null,
      matchReasoning: 'No verified supporting quote found in top candidate references'
    }
  } finally {
    telemetry.per_claim_durations_ms.push(Date.now() - claimStartedAt)
  }
}
```

**Step 6: Commit**

```bash
git add app/src/services/referenceMatching.js
git commit -m "feat: rewrite matchSingleClaim with V2 pipeline (fact-anchored + extraction)"
```

---

### Task 8: Update matchAllClaimsToReferences — remove dedup

**Files:**
- Modify: `app/src/services/referenceMatching.js:797-941`

**Step 1: Rewrite matchAllClaimsToReferences**

Replace the function to process every claim individually (no grouping):

```javascript
export async function matchAllClaimsToReferences(claims, references, onProgress, brandId, options = {}) {
  const CONCURRENCY = resolveConcurrency(options.concurrency, DEFAULT_MATCHING_CONCURRENCY)
  const topK = options.topK || DEFAULT_TOP_K
  const candidatePool = Math.max(topK, options.candidatePool || DEFAULT_CANDIDATE_POOL)
  const onClaimResult = typeof options.onClaimResult === 'function'
    ? options.onClaimResult
    : null
  let completed = 0
  const results = new Array(claims.length)
  const startedAt = Date.now()

  const telemetry = {
    total_claims: claims.length,
    matching_total_ms: 0,
    reference_fetch_ms: 0,
    per_claim_durations_ms: [],
    per_claim_match_ms: { count: 0, min: 0, avg: 0, p95: 0, max: 0 },
    semantic_search_count: 0,
    fact_anchored_count: 0,
    extraction_ai_calls: 0,
    verified_quotes: 0,
    unverified_quotes: 0,
    keyword_fallback_count: 0,
    matching_ai_calls: 0,
    matching_ai_input_tokens: 0,
    matching_ai_output_tokens: 0,
    matching_ai_cost: 0,
    concurrency: CONCURRENCY,
    top_k: topK,
    candidate_pool: candidatePool,
    hybrid_enabled: MATCHING_HYBRID_ENABLED
  }

  const getFallbackReferencesWithText = createFallbackReferenceLoader(references, telemetry)

  // Process all claims individually — no dedup (MLR requires each instance annotated)
  for (let start = 0; start < claims.length; start += CONCURRENCY) {
    const batch = []
    for (let i = start; i < Math.min(start + CONCURRENCY, claims.length); i++) {
      batch.push(i)
    }

    const batchPromises = batch.map((claimIndex) => {
      const claim = claims[claimIndex]

      return matchSingleClaim(claim, brandId, references, {
        topK,
        candidatePool,
        telemetry,
        getFallbackReferencesWithText,
        onStage: (stage) => {
          onProgress?.({
            current: completed,
            total: claims.length,
            claim,
            claimIndex: claimIndex + 1,
            stage
          })
        }
      }).then((matchResult) => {
        results[claimIndex] = matchResult
        completed += 1
        const progressPayload = {
          current: completed,
          total: claims.length,
          claim,
          claimIndex: claimIndex + 1,
          stage: 'done'
        }
        onProgress?.(progressPayload)
        onClaimResult?.({ ...progressPayload, claim: matchResult })
      }).catch((error) => {
        logger.error(`Claim matching failed for claim ${claim.id}:`, error)
        results[claimIndex] = {
          ...claim,
          matched: false,
          reference: null,
          matchReasoning: `Matching error: ${error.message}`
        }
        completed += 1
        const progressPayload = {
          current: completed,
          total: claims.length,
          claim,
          claimIndex: claimIndex + 1,
          stage: 'done'
        }
        onProgress?.(progressPayload)
        onClaimResult?.({ ...progressPayload, claim: results[claimIndex] })
        telemetry.failed_claim_count = (telemetry.failed_claim_count || 0) + 1
      })
    })
    await Promise.all(batchPromises)
  }

  telemetry.matching_total_ms = Date.now() - startedAt
  telemetry.per_claim_match_ms = summarizeDurations(telemetry.per_claim_durations_ms)
  delete telemetry.per_claim_durations_ms

  return { claims: results, telemetry }
}
```

**Step 2: Commit**

```bash
git add app/src/services/referenceMatching.js
git commit -m "feat: remove dedup from matchAllClaims — every claim annotated per MLR"
```

---

### Task 9: Clean up dead code

**Files:**
- Modify: `app/src/services/referenceMatching.js` (remove unused functions/constants)

**Step 1: Remove unused code**

Delete these functions and constants that are no longer called:

- `MATCHING_AUTOCONFIRM_ENABLED` and its env var parse (line 27)
- `MATCHING_SKIP_CONFIRM_LOW_CONFIDENCE_ENABLED` and its env var parse (lines 28-31)
- `DEFAULT_AI_CONFIRMATION_CANDIDATES` (line 35)
- `MATCHING_CONFIRM_DIVERSITY_ENABLED` (line 36)
- `DEFAULT_AI_CONFIRM_PER_REFERENCE_CAP` (line 37)
- `AUTO_CONFIRM_MIN_SEMANTIC`, `AUTO_CONFIRM_MIN_HYBRID`, `AUTO_CONFIRM_MIN_MARGIN`, `AUTO_CONFIRM_MIN_KEYWORD` (lines 46-49)
- `SKIP_CONFIRM_MAX_SEMANTIC`, `SKIP_CONFIRM_MAX_HYBRID`, `SKIP_CONFIRM_MAX_KEYWORD` (lines 51-62)
- `normalizeClaimDedupKey()` (lines 126-133)
- `parseReferenceIndex()` (lines 144-171)
- `candidateSelectionKey()` (lines 173-189)
- `selectConfirmationCandidates()` (lines 191-227)
- `evaluateAutoConfirm()` (lines 398-423)
- `evaluateSkipConfirmation()` (lines 425-445)
- `copyMatchToDuplicateClaim()` (lines 447-456)
- `selectAICandidate()` (lines 258-298)
- `buildClaimGroups()` (lines 300-318)

Keep: `truncateForPrompt`, `resolveMatchConfidence`, `accumulateMatchingUsage`, `normalizeAlias`, `extractKeywords`, `extractNumericTokens`, `scoreKeywordOverlap`, `scoreNumericOverlap`, `rerankSemanticResults`, `enrichSemanticOnlyResults`, `keywordFallbackMatch`, `createFallbackReferenceLoader`, `summarizeDurations`, `roundMs`, `clamp`, `resolveConcurrency`, `STOP_WORDS`, `HYBRID_WEIGHTS`.

**Step 2: Remove old `matchClaimToReferences` import if keyword fallback no longer uses it**

Check: keyword fallback still calls `matchClaimToReferences` — keep the import for now. The old function stays in gemini.js for the keyword fallback path.

**Step 3: Run lint to verify no errors**

Run: `cd app && npm run lint`
Expected: No errors (warnings OK).

**Step 4: Run existing tests**

Run: `cd app && npm run test`
Expected: All existing tests pass.

**Step 5: Commit**

```bash
git add app/src/services/referenceMatching.js
git commit -m "refactor: remove dead matching code (auto-confirm, dedup, diversity selection)"
```

---

### Task 10: Run embed-facts for all brands and smoke test

**Step 1: Embed all facts**

Run: `cd backend && node scripts/embed-facts.js`
Expected: Embeds fact sets for all references. Output shows count per reference.

**Step 2: Start both servers**

Run (in separate terminals):
- `cd backend && npm run dev`
- `cd app && npm run dev`

**Step 3: Smoke test in browser**

1. Go to `http://localhost:5173/mkg2`
2. Select a brand with references
3. Upload a test PDF
4. Run analysis with Gemini
5. Check claims tab — verify matches show verbatim quotes as excerpts
6. Verify telemetry in console shows new tier names (`fact-anchored`, `verified-extraction`, `partial-extraction`)

**Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "feat: complete reference matching V2 pipeline integration"
```

---

## Execution Notes

- **Tasks 1-4** are backend work (migration, model, script, endpoint) — can be done together
- **Task 5** is standalone TDD — no dependencies
- **Tasks 6-8** are the core frontend rewrite — sequential, depends on Tasks 4 and 5
- **Task 9** is cleanup after Tasks 7-8
- **Task 10** is integration testing after everything
