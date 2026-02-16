# Semantic Reference Matching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the keyword-based claim-to-reference matching pipeline with Gemini embedding-based semantic search + sqlite-vec vector KNN, fixing the 2000-char truncation bug that causes exact 1:1 reference lines to be missed.

**Architecture:** Backend chunks reference documents into ~1000-word passages, embeds each via `gemini-embedding-001`, stores vectors in SQLite via `sqlite-vec`. At match time, the frontend calls a new backend search endpoint that embeds the claim text, runs KNN search across all brand passages, and returns the top 5 most relevant passages. The existing AI confirmation step then verifies the best match using full passage text (not truncated excerpts).

**Tech Stack:** `gemini-embedding-001` (via `@google/genai`), `sqlite-vec` (via npm, loaded into `better-sqlite3`), existing Express + SQLite backend.

**Design doc:** `docs/plans/2026-02-15-semantic-reference-matching-design.md`

---

### Task 1: Install sqlite-vec and verify extension loading

**Files:**
- Modify: `backend/package.json` (add `sqlite-vec` dependency)
- Modify: `backend/src/config/database.js:16-63` (load sqlite-vec extension after DB creation)

**Step 1: Install sqlite-vec**

Run:
```bash
cd backend && npm install sqlite-vec
```

**Step 2: Load sqlite-vec extension in database.js**

In `backend/src/config/database.js`, add the import at top:

```javascript
import * as sqliteVec from 'sqlite-vec'
```

Then in `initDb()`, after `db.pragma('foreign_keys = ON')` (line 22) and before migrations, add:

```javascript
  sqliteVec.load(db)
```

**Step 3: Verify extension loads**

Run:
```bash
cd backend && node -e "
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
const db = new Database(':memory:');
sqliteVec.load(db);
const version = db.prepare('SELECT vec_version()').pluck().get();
console.log('sqlite-vec version:', version);
db.close();
"
```
Expected: Prints version number (e.g. `v0.1.6`)

**Step 4: Verify backend still starts**

Run:
```bash
cd backend && npm run dev
```
Expected: "Database initialized" message, server starts on :3001

**Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/config/database.js
git commit -m "feat: install sqlite-vec and load extension on DB init"
```

---

### Task 2: Create migration for reference_passages table

**Files:**
- Create: `backend/migrations/005_reference_passages.sql`
- Modify: `backend/src/config/database.js` (add migration 005 execution)

**Step 1: Write the migration SQL**

Create `backend/migrations/005_reference_passages.sql`:

```sql
CREATE TABLE IF NOT EXISTS reference_passages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_id INTEGER NOT NULL,
  passage_index INTEGER NOT NULL,
  passage_text TEXT NOT NULL,
  start_char INTEGER,
  end_char INTEGER,
  page_estimate INTEGER,
  embedding BLOB,
  embedding_model TEXT DEFAULT 'gemini-embedding-001',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reference_id) REFERENCES reference_documents(id) ON DELETE CASCADE,
  UNIQUE(reference_id, passage_index)
);

CREATE INDEX IF NOT EXISTS idx_passages_reference_id ON reference_passages(reference_id);
CREATE INDEX IF NOT EXISTS idx_passages_embedding_model ON reference_passages(embedding_model);
```

**Step 2: Register migration in database.js**

In `backend/src/config/database.js`, after the migration 004 block (after line 60), add:

```javascript
  // 005: reference_passages for semantic search embeddings
  const migration005Path = path.resolve(__dirname, '../../migrations/005_reference_passages.sql')
  const migration005 = fs.readFileSync(migration005Path, 'utf-8')
  db.exec(migration005)
```

**Step 3: Verify migration runs**

Run:
```bash
cd backend && npm run dev
```
Expected: Server starts without errors. Then verify the table exists:
```bash
cd backend && node -e "
import { initDb, getDb, closeDb } from './src/config/database.js';
initDb();
const db = getDb();
const info = db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name='reference_passages'\").get();
console.log('Table exists:', !!info);
const cols = db.prepare('PRAGMA table_info(reference_passages)').all();
cols.forEach(c => console.log(c.name, c.type));
closeDb();
"
```
Expected: Table exists with all columns listed

**Step 4: Commit**

```bash
git add backend/migrations/005_reference_passages.sql backend/src/config/database.js
git commit -m "feat: add reference_passages migration for embedding storage"
```

---

### Task 3: Create ReferencePassage model

**Files:**
- Create: `backend/src/models/ReferencePassage.js`

**Step 1: Write the model**

Create `backend/src/models/ReferencePassage.js`:

```javascript
import { getDb } from '../config/database.js'

export const ReferencePassage = {
  findByReferenceId(referenceId) {
    const db = getDb()
    return db.prepare(
      'SELECT * FROM reference_passages WHERE reference_id = ? ORDER BY passage_index'
    ).all(referenceId)
  },

  findByBrandId(brandId) {
    const db = getDb()
    return db.prepare(`
      SELECT rp.*, rd.display_alias, rd.filename
      FROM reference_passages rp
      JOIN reference_documents rd ON rd.id = rp.reference_id
      WHERE rd.brand_id = ?
        AND rd.deleted_at IS NULL
        AND rp.embedding IS NOT NULL
      ORDER BY rd.id, rp.passage_index
    `).all(brandId)
  },

  createPassages(referenceId, passages) {
    const db = getDb()

    // Delete existing passages for this reference first
    db.prepare('DELETE FROM reference_passages WHERE reference_id = ?').run(referenceId)

    const insert = db.prepare(`
      INSERT INTO reference_passages
        (reference_id, passage_index, passage_text, start_char, end_char, page_estimate, embedding, embedding_model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMany = db.transaction((items) => {
      for (const p of items) {
        insert.run(
          referenceId,
          p.passage_index,
          p.passage_text,
          p.start_char,
          p.end_char,
          p.page_estimate,
          p.embedding,       // Buffer (Float32Array.buffer)
          p.embedding_model || 'gemini-embedding-001'
        )
      }
    })

    insertMany(passages)
    return this.findByReferenceId(referenceId)
  },

  deleteByReferenceId(referenceId) {
    const db = getDb()
    const result = db.prepare('DELETE FROM reference_passages WHERE reference_id = ?').run(referenceId)
    return result.changes
  },

  getEmbeddingStatus(brandId) {
    const db = getDb()
    return db.prepare(`
      SELECT
        rd.id as reference_id,
        rd.display_alias,
        COUNT(rp.id) as passage_count,
        SUM(CASE WHEN rp.embedding IS NOT NULL THEN 1 ELSE 0 END) as embedded_count
      FROM reference_documents rd
      LEFT JOIN reference_passages rp ON rp.reference_id = rd.id
      WHERE rd.brand_id = ?
        AND rd.deleted_at IS NULL
      GROUP BY rd.id
      ORDER BY rd.upload_date DESC
    `).all(brandId)
  },

  /**
   * KNN search using sqlite-vec.
   * Finds the top-K most similar passages to the query embedding within a brand.
   *
   * @param {number} brandId - Brand to search within
   * @param {Buffer} queryEmbedding - Float32 buffer of the query vector (768 dims)
   * @param {number} topK - Number of results to return
   * @returns {Array} - Passages sorted by similarity (closest first)
   */
  searchByEmbedding(brandId, queryEmbedding, topK = 5) {
    const db = getDb()

    // Get all passage IDs for this brand that have embeddings
    const brandPassages = db.prepare(`
      SELECT rp.id, rp.passage_text, rp.page_estimate, rp.reference_id,
             rp.embedding, rd.display_alias
      FROM reference_passages rp
      JOIN reference_documents rd ON rd.id = rp.reference_id
      WHERE rd.brand_id = ?
        AND rd.deleted_at IS NULL
        AND rp.embedding IS NOT NULL
    `).all(brandId)

    if (brandPassages.length === 0) return []

    // Compute cosine similarity in JS (sqlite-vec KNN works on virtual tables;
    // for our non-virtual table approach, we use vec_distance_cosine on each row)
    const results = brandPassages.map(row => {
      const distance = cosineSimilarity(queryEmbedding, row.embedding)
      return {
        passage_id: row.id,
        reference_id: row.reference_id,
        display_alias: row.display_alias,
        passage_text: row.passage_text,
        page_estimate: row.page_estimate,
        similarity: distance
      }
    })

    results.sort((a, b) => b.similarity - a.similarity)
    return results.slice(0, topK)
  }
}

/**
 * Compute cosine similarity between two Float32 embedding buffers.
 */
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

**Note:** We use JS cosine similarity rather than `sqlite-vec` virtual tables because our passages are filtered by brand first (which sqlite-vec virtual tables don't natively support). At ~540 passages per brand, the JS loop is fast enough (~5ms). If this needs to scale to 10K+ passages, we'd create per-brand virtual tables.

**Step 2: Verify model loads**

Run:
```bash
cd backend && node -e "
import { initDb, closeDb } from './src/config/database.js';
import { ReferencePassage } from './src/models/ReferencePassage.js';
initDb();
const result = ReferencePassage.findByBrandId(1);
console.log('Query ran, results:', result.length);
closeDb();
"
```
Expected: "Query ran, results: 0" (no passages yet)

**Step 3: Commit**

```bash
git add backend/src/models/ReferencePassage.js
git commit -m "feat: add ReferencePassage model with KNN search"
```

---

### Task 4: Create passageEmbedder service

**Files:**
- Create: `backend/src/services/passageEmbedder.js`

**Step 1: Write the service**

Create `backend/src/services/passageEmbedder.js`:

```javascript
import { GoogleGenAI } from '@google/genai'

const EMBEDDING_MODEL = 'gemini-embedding-001'
const CHUNK_SIZE = 4000    // ~1000 words
const CHUNK_OVERLAP = 800  // ~200 words (20%)
const EMBEDDING_DIMS = 768 // Trimmed via MRL from 3072 default

/**
 * Split text into overlapping chunks of ~1000 words.
 * Tries to break at sentence boundaries when possible.
 */
export function chunkText(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  if (!text || text.length === 0) return []
  if (text.length <= chunkSize) {
    return [{ text, startChar: 0, endChar: text.length }]
  }

  const chunks = []
  let start = 0

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length)

    // Try to break at a sentence boundary (. ! ? followed by space or newline)
    if (end < text.length) {
      const searchStart = Math.max(end - 200, start) // Look back up to 200 chars
      const segment = text.slice(searchStart, end)
      const sentenceEnd = segment.search(/[.!?]\s+(?=[A-Z])/g)
      if (sentenceEnd !== -1 && sentenceEnd > segment.length * 0.5) {
        end = searchStart + sentenceEnd + 1
      }
    }

    chunks.push({
      text: text.slice(start, end),
      startChar: start,
      endChar: end
    })

    // Move forward by (chunkSize - overlap), but at least 1 char
    const step = Math.max(end - start - overlap, 1)
    start = start + step

    // Avoid tiny trailing chunks
    if (text.length - start < overlap) {
      // Extend last chunk to end of text
      if (chunks.length > 0) {
        const last = chunks[chunks.length - 1]
        last.text = text.slice(last.startChar)
        last.endChar = text.length
      }
      break
    }
  }

  return chunks
}

/**
 * Estimate page number from character offset.
 * Average page is ~3000 chars (typical for PDF-extracted text).
 */
export function estimatePage(charOffset, charsPerPage = 3000) {
  return Math.floor(charOffset / charsPerPage) + 1
}

/**
 * Generate embedding for a single text using Gemini embedding API.
 * Returns a Buffer containing the Float32Array data.
 */
export async function embedText(text, options = {}) {
  const apiKey = process.env.VITE_GEMINI_API_KEY
  if (!apiKey) throw new Error('VITE_GEMINI_API_KEY not set in environment')

  const ai = new GoogleGenAI({ apiKey })
  const model = options.model || EMBEDDING_MODEL

  const response = await ai.models.embedContent({
    model,
    contents: text,
    config: {
      outputDimensionality: options.dimensions || EMBEDDING_DIMS
    }
  })

  const values = response.embedding.values
  const float32 = new Float32Array(values)
  return Buffer.from(float32.buffer)
}

/**
 * Chunk and embed a full reference document.
 * Returns array of passage objects ready for ReferencePassage.createPassages().
 */
export async function embedReference(contentText, options = {}) {
  const chunks = chunkText(contentText)

  const passages = []
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    const embedding = await embedText(chunk.text, options)

    passages.push({
      passage_index: i,
      passage_text: chunk.text,
      start_char: chunk.startChar,
      end_char: chunk.endChar,
      page_estimate: estimatePage(chunk.startChar),
      embedding,
      embedding_model: options.model || EMBEDDING_MODEL
    })

    // Brief delay between API calls to respect rate limits
    if (i < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return passages
}
```

**Step 2: Verify embedding generation works**

Run (requires `VITE_GEMINI_API_KEY` in `backend/.env`):
```bash
cd backend && node -e "
import 'dotenv/config';
import { chunkText, embedText } from './src/services/passageEmbedder.js';

// Test chunking
const chunks = chunkText('Hello world. '.repeat(500));
console.log('Chunks:', chunks.length, 'First chunk length:', chunks[0].text.length);

// Test embedding
const buf = await embedText('Drug X reduced seizure frequency by 47%');
const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
console.log('Embedding dims:', arr.length, 'First 5 values:', Array.from(arr.slice(0, 5)).map(v => v.toFixed(4)));
"
```
Expected: Prints chunk count, and 768-dimension embedding vector

**Step 3: Commit**

```bash
git add backend/src/services/passageEmbedder.js
git commit -m "feat: add passageEmbedder service for chunking and embedding"
```

---

### Task 5: Create embed-references batch script

**Files:**
- Create: `backend/scripts/embed-references.js`

**Step 1: Write the batch script**

Create `backend/scripts/embed-references.js`:

```javascript
import 'dotenv/config'
import pLimit from 'p-limit'
import { initDb, getDb, closeDb } from '../src/config/database.js'
import { ReferencePassage } from '../src/models/ReferencePassage.js'
import { embedReference } from '../src/services/passageEmbedder.js'

function parseArgs() {
  const args = process.argv.slice(2)
  const flags = { force: false, brand: null, concurrency: 5 }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') flags.force = true
    if (args[i] === '--brand' && args[i + 1]) flags.brand = args[++i]
    if (args[i] === '--concurrency' && args[i + 1]) flags.concurrency = parseInt(args[++i], 10) || 5
  }
  return flags
}

async function embedWithRetry(contentText, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await embedReference(contentText)
    } catch (err) {
      const isRateLimit = err.message?.includes('429') || err.message?.includes('rate') || err.message?.includes('quota')
      if (isRateLimit && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 2000
        console.log(`  Rate limited, retrying in ${delay / 1000}s...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      } else {
        throw err
      }
    }
  }
}

async function main() {
  const flags = parseArgs()
  console.log('=== Reference Passage Embedding ===\n')
  console.log(`Options: force=${flags.force}, brand=${flags.brand || 'all'}, concurrency=${flags.concurrency}\n`)

  if (!process.env.VITE_GEMINI_API_KEY) {
    console.error('ERROR: VITE_GEMINI_API_KEY not set in backend/.env')
    process.exit(1)
  }

  initDb()
  const db = getDb()

  // Build query to find references that need embedding
  let query = `
    SELECT rd.id, rd.display_alias, rd.content_text, rd.brand_id, b.name as brand_name
    FROM reference_documents rd
    JOIN brands b ON b.id = rd.brand_id
    WHERE rd.deleted_at IS NULL
      AND rd.content_text IS NOT NULL
      AND LENGTH(rd.content_text) > 0
  `
  const params = []

  if (!flags.force) {
    // Skip refs that already have embedded passages
    query += `
      AND rd.id NOT IN (
        SELECT DISTINCT reference_id FROM reference_passages WHERE embedding IS NOT NULL
      )
    `
  }

  if (flags.brand) {
    query += ' AND b.name = ?'
    params.push(flags.brand)
  }

  query += ' ORDER BY rd.id'
  const references = db.prepare(query).all(...params)

  if (references.length === 0) {
    console.log('No references need embedding.')
    closeDb()
    return
  }

  console.log(`Found ${references.length} references to embed.\n`)

  let completed = 0
  let failed = 0

  const limit = pLimit(flags.concurrency)
  const tasks = references.map((ref) =>
    limit(async () => {
      const label = `[${++completed}/${references.length}] ${ref.display_alias}`
      try {
        const passages = await embedWithRetry(ref.content_text)
        ReferencePassage.createPassages(ref.id, passages)
        console.log(`${label}: ${passages.length} passages embedded`)
      } catch (err) {
        failed++
        console.error(`${label}: FAILED - ${err.message}`)
      }
    })
  )

  await Promise.all(tasks)

  console.log(`\n=== Complete ===`)
  console.log(`Embedded: ${completed - failed}/${references.length}`)
  if (failed > 0) console.log(`Failed: ${failed}`)
  closeDb()
}

main().catch(err => {
  console.error('Fatal error:', err)
  closeDb()
  process.exit(1)
})
```

**Step 2: Run the batch embedding**

Run:
```bash
cd backend && node scripts/embed-references.js
```
Expected: Processes all 54 references, creating passages and embeddings for each. Should take ~1-2 minutes.

**Step 3: Verify embeddings were created**

Run:
```bash
cd backend && node -e "
import { initDb, getDb, closeDb } from './src/config/database.js';
initDb();
const db = getDb();
const count = db.prepare('SELECT COUNT(*) as c FROM reference_passages WHERE embedding IS NOT NULL').get();
console.log('Total embedded passages:', count.c);
const byRef = db.prepare('SELECT reference_id, COUNT(*) as passages FROM reference_passages GROUP BY reference_id ORDER BY passages DESC LIMIT 5').all();
console.log('Top 5 refs by passage count:', byRef);
closeDb();
"
```
Expected: Shows total passage count (~540) and distribution per reference

**Step 4: Commit**

```bash
git add backend/scripts/embed-references.js
git commit -m "feat: add batch embed-references script for passage embedding"
```

---

### Task 6: Add backend search endpoint

**Files:**
- Create: `backend/src/controllers/passageController.js`
- Create: `backend/src/routes/passages.js`
- Modify: `backend/src/routes/index.js:1-17` (register new routes)

**Step 1: Write the controller**

Create `backend/src/controllers/passageController.js`:

```javascript
import { ReferencePassage } from '../models/ReferencePassage.js'
import { Brand } from '../models/Brand.js'
import { embedText } from '../services/passageEmbedder.js'
import { AppError } from '../middleware/errorHandler.js'

export const passageController = {
  /**
   * POST /api/brands/:brandId/passages/search
   * Body: { claim_text: string, top_k?: number }
   * Returns top-K most similar passages for a claim.
   */
  async search(req, res, next) {
    try {
      const brandId = parseInt(req.params.brandId, 10)
      const brand = Brand.findById(brandId)
      if (!brand) throw new AppError('Brand not found', 404)

      const { claim_text, top_k = 5 } = req.body
      if (!claim_text || claim_text.trim().length === 0) {
        throw new AppError('claim_text is required', 400)
      }

      // Embed the claim text
      const queryEmbedding = await embedText(claim_text.trim())

      // KNN search across all brand passages
      const results = ReferencePassage.searchByEmbedding(brandId, queryEmbedding, top_k)

      res.json({
        claim_text: claim_text.trim(),
        results,
        count: results.length
      })
    } catch (err) {
      next(err)
    }
  },

  /**
   * GET /api/brands/:brandId/passages/status
   * Returns embedding status for all references in a brand.
   */
  status(req, res, next) {
    try {
      const brandId = parseInt(req.params.brandId, 10)
      const brand = Brand.findById(brandId)
      if (!brand) throw new AppError('Brand not found', 404)

      const statuses = ReferencePassage.getEmbeddingStatus(brandId)
      const totalRefs = statuses.length
      const embeddedRefs = statuses.filter(s => s.embedded_count > 0).length
      const totalPassages = statuses.reduce((sum, s) => sum + (s.passage_count || 0), 0)

      res.json({
        brand_id: brandId,
        total_references: totalRefs,
        embedded_references: embeddedRefs,
        total_passages: totalPassages,
        references: statuses
      })
    } catch (err) {
      next(err)
    }
  }
}
```

**Step 2: Write the routes**

Create `backend/src/routes/passages.js`:

```javascript
import { Router } from 'express'
import { passageController } from '../controllers/passageController.js'

const router = Router({ mergeParams: true })

router.post('/search', passageController.search)
router.get('/status', passageController.status)

export default router
```

**Step 3: Register routes in index.js**

In `backend/src/routes/index.js`, add the import at top:

```javascript
import passageRoutes from './passages.js'
```

And add in `registerRoutes()`:

```javascript
  app.use('/api/brands/:brandId/passages', passageRoutes)
```

**Step 4: Test the search endpoint**

Start the backend (`cd backend && npm run dev`), then test:

```bash
curl -X POST http://localhost:3001/api/brands/1/passages/search \
  -H 'Content-Type: application/json' \
  -d '{"claim_text": "47% reduction in seizure frequency"}'
```

Expected: Returns JSON with top 5 most similar passages, each with reference name, page estimate, and similarity score.

**Step 5: Test the status endpoint**

```bash
curl http://localhost:3001/api/brands/1/passages/status
```

Expected: Returns JSON showing embedding status per reference.

**Step 6: Commit**

```bash
git add backend/src/controllers/passageController.js backend/src/routes/passages.js backend/src/routes/index.js
git commit -m "feat: add passage search and status API endpoints"
```

---

### Task 7: Add frontend API client functions

**Files:**
- Modify: `app/src/services/api.js` (add passage search and status functions)

**Step 1: Add API functions**

In `app/src/services/api.js`, after the `// ========== Facts ==========` section (after line 191), add:

```javascript
// ========== Passages (Semantic Search) ==========

export async function searchPassages(brandId, claimText, topK = 5) {
  return request(`/brands/${brandId}/passages/search`, {
    method: 'POST',
    body: JSON.stringify({ claim_text: claimText, top_k: topK })
  })
}

export async function fetchPassageStatus(brandId) {
  return request(`/brands/${brandId}/passages/status`)
}
```

**Step 2: Commit**

```bash
git add app/src/services/api.js
git commit -m "feat: add passage search and status API client functions"
```

---

### Task 8: Rewrite referenceMatching.js to use semantic search

This is the core change. Replace the keyword-based matching pipeline with embedding-based search.

**Files:**
- Modify: `app/src/services/referenceMatching.js` (full rewrite of matching logic)

**Step 1: Rewrite referenceMatching.js**

Replace the entire contents of `app/src/services/referenceMatching.js`:

```javascript
import { matchClaimToReferences } from './gemini.js'
import * as api from './api.js'

/**
 * Truncate text to a reasonable excerpt length for the AI prompt.
 * Takes first ~3000 chars — enough for ~750 words of context per passage.
 */
function truncateForPrompt(text, maxChars = 3000) {
  if (!text || text.length <= maxChars) return text
  return text.slice(0, maxChars) + '...'
}

/**
 * Match a single claim to references using semantic search.
 *
 * Pipeline:
 * 1. Call backend to embed claim and find top 5 most similar passages (KNN)
 * 2. Send claim + top passages to Gemini for AI confirmation
 * 3. Return match result
 *
 * Falls back to the old keyword matching if the backend search fails
 * (e.g., if embeddings haven't been generated yet).
 */
async function matchSingleClaim(claim, brandId, allReferences) {
  // Step 1: Semantic search via backend
  let searchResults = []
  try {
    const response = await api.searchPassages(brandId, claim.text, 5)
    searchResults = response.results || []
  } catch (err) {
    console.warn(`Semantic search failed for claim ${claim.id}, falling back to keyword matching:`, err.message)
    return keywordFallbackMatch(claim, allReferences)
  }

  if (searchResults.length === 0) {
    return {
      ...claim,
      matched: false,
      reference: null,
      matchReasoning: 'No similar passages found in reference library'
    }
  }

  // Step 2: AI confirmation with full passage text
  const refsForAI = searchResults.map((result, i) => ({
    name: result.display_alias,
    excerpt: truncateForPrompt(result.passage_text),
    page: result.page_estimate,
    similarity: result.similarity
  }))

  try {
    const result = await matchClaimToReferences(claim.text, refsForAI)

    if (result.matched && result.referenceIndex) {
      const matchedResult = searchResults[result.referenceIndex - 1]
      if (matchedResult) {
        // Look up the full reference object to get the ID
        const refObj = allReferences.find(r =>
          r.display_alias === matchedResult.display_alias ||
          r.id === matchedResult.reference_id
        )

        return {
          ...claim,
          matched: true,
          matchConfidence: result.confidence,
          matchTier: 'semantic',
          reference: {
            id: refObj?.id || matchedResult.reference_id,
            name: result.referenceName || matchedResult.display_alias,
            page: result.pageInReference || matchedResult.page_estimate,
            excerpt: result.supportingExcerpt
          },
          matchReasoning: result.reasoning
        }
      }
    }

    return {
      ...claim,
      matched: false,
      reference: null,
      matchReasoning: result.reasoning || 'AI could not confirm a supporting reference'
    }
  } catch (error) {
    console.error(`AI confirmation error for claim ${claim.id}:`, error)
    // If AI fails, use the top semantic result directly if similarity is high enough
    const top = searchResults[0]
    if (top && top.similarity >= 0.85) {
      const refObj = allReferences.find(r => r.id === top.reference_id)
      return {
        ...claim,
        matched: true,
        matchConfidence: top.similarity,
        matchTier: 'semantic-direct',
        reference: {
          id: refObj?.id || top.reference_id,
          name: top.display_alias,
          page: top.page_estimate,
          excerpt: top.passage_text?.slice(0, 300)
        },
        matchReasoning: `High-confidence semantic match (${(top.similarity * 100).toFixed(0)}% similarity)`
      }
    }
    return {
      ...claim,
      matched: false,
      reference: null,
      matchReasoning: `Matching error: ${error.message}`
    }
  }
}

/**
 * Fallback: keyword-based matching for when embeddings aren't available.
 * Simplified version of the old Tier 1 + Tier 2 pipeline.
 */
function extractKeywords(text) {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'can', 'shall', 'this', 'that',
    'these', 'those', 'it', 'its', 'not', 'no', 'than', 'as', 'if',
    'when', 'where', 'which', 'who', 'whom', 'what', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such',
    'only', 'also', 'very', 'just', 'about', 'above', 'after', 'before',
    'between', 'during', 'through', 'into', 'over', 'under', 'again',
    'further', 'then', 'once', 'here', 'there', 'any', 'up', 'out',
    'so', 'we', 'they', 'he', 'she', 'me', 'him', 'her', 'my', 'your',
    'our', 'their', 'us', 'them'
  ])
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .filter((word, i, arr) => arr.indexOf(word) === i)
}

async function keywordFallbackMatch(claim, allReferences) {
  const claimKeywords = extractKeywords(claim.text)

  const scored = allReferences
    .map(ref => {
      if (!ref.content_text || claimKeywords.length === 0) return { ...ref, score: 0 }
      const refLower = ref.content_text.toLowerCase()
      const matches = claimKeywords.filter(kw => refLower.includes(kw))
      return { ...ref, score: matches.length / claimKeywords.length }
    })
    .filter(ref => ref.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  if (scored.length === 0) {
    return {
      ...claim,
      matched: false,
      reference: null,
      matchReasoning: 'No keyword overlap with any reference (fallback mode)'
    }
  }

  const refsForAI = scored.map(ref => ({
    name: ref.display_alias,
    excerpt: ref.content_text?.slice(0, 3000) || ''
  }))

  try {
    const result = await matchClaimToReferences(claim.text, refsForAI)
    if (result.matched && result.referenceIndex) {
      const matched = scored[result.referenceIndex - 1]
      if (matched) {
        return {
          ...claim,
          matched: true,
          matchConfidence: result.confidence,
          matchTier: 'keyword-fallback',
          reference: {
            id: matched.id,
            name: result.referenceName || matched.display_alias,
            page: result.pageInReference,
            excerpt: result.supportingExcerpt
          },
          matchReasoning: result.reasoning + ' (keyword fallback)'
        }
      }
    }
    return { ...claim, matched: false, reference: null, matchReasoning: result.reasoning || 'No match found (fallback)' }
  } catch (error) {
    return { ...claim, matched: false, reference: null, matchReasoning: `Fallback error: ${error.message}` }
  }
}

/**
 * Match all claims to references using semantic search.
 * Processes claims in batches to manage API rate limits.
 *
 * @param {Array} claims - Array of detected claims
 * @param {Array} references - Array of reference objects with { id, display_alias, content_text }
 * @param {Function} onProgress - Progress callback (completed, total, claim)
 * @param {number} brandId - Brand ID for semantic search (new parameter, replaces brandFacts)
 * @returns {Promise<Array>} - Claims enriched with reference data
 */
export async function matchAllClaimsToReferences(claims, references, onProgress, brandId) {
  const CONCURRENCY = 3  // Lower concurrency: each claim now makes 2 API calls (embed + AI)
  let completed = 0
  const results = new Array(claims.length)

  for (let start = 0; start < claims.length; start += CONCURRENCY) {
    const batch = claims.slice(start, start + CONCURRENCY)
    const batchPromises = batch.map((claim, batchIdx) => {
      const idx = start + batchIdx
      return matchSingleClaim(claim, brandId, references).then(enriched => {
        results[idx] = enriched
        completed++
        onProgress?.(completed, claims.length, claim)
      })
    })
    await Promise.all(batchPromises)
  }

  return results
}

/**
 * Get matching stats from enriched claims.
 */
export function getMatchingStats(enrichedClaims) {
  const total = enrichedClaims.length
  const matched = enrichedClaims.filter(c => c.matched).length
  const unmatched = total - matched
  const avgConfidence = matched > 0
    ? enrichedClaims
        .filter(c => c.matched && c.matchConfidence)
        .reduce((sum, c) => sum + c.matchConfidence, 0) / matched
    : 0

  // Count by match tier
  const tiers = {}
  enrichedClaims.filter(c => c.matched && c.matchTier).forEach(c => {
    tiers[c.matchTier] = (tiers[c.matchTier] || 0) + 1
  })

  return {
    total,
    matched,
    unmatched,
    matchRate: total > 0 ? (matched / total * 100).toFixed(1) : '0.0',
    avgConfidence: (avgConfidence * 100).toFixed(1),
    tiers
  }
}
```

**Key changes:**
- `matchAllClaimsToReferences` now takes `brandId` (number) instead of `brandFacts` (array) as the 4th parameter
- `matchSingleClaim` calls the backend `/passages/search` endpoint instead of doing keyword matching
- Falls back to keyword matching if semantic search fails (e.g., embeddings not yet generated)
- Concurrency reduced from 5 to 3 (each claim now makes 2 API calls)
- High-similarity direct matches (>=85%) are accepted even if AI confirmation fails

**Step 2: Commit**

```bash
git add app/src/services/referenceMatching.js
git commit -m "feat: rewrite referenceMatching to use semantic search pipeline"
```

---

### Task 9: Update MKG2ClaimsDetector to pass brandId

**Files:**
- Modify: `app/src/pages/MKG2ClaimsDetector.jsx:580-625` (update matching call)

**Step 1: Update the matching call**

In `MKG2ClaimsDetector.jsx`, find the matching section (around lines 580-625). The current code:

1. Fetches brand facts for Tier 0 matching (lines 583-609)
2. Calls `matchAllClaimsToReferences(detectedClaims, validRefs, onProgress, brandFacts)` (line 611)

Replace the entire matching section. Remove the `brandFacts` fetching block (lines 583-609) and update the `matchAllClaimsToReferences` call to pass `brandId` instead:

```javascript
      setMatchingProgress(`Searching ${validRefs.length} references...`)

      const matchBrandId = libraryBrandId || selectedBrandId

      const enrichedClaims = await matchAllClaimsToReferences(
        detectedClaims,
        validRefs,
        (current, total) => {
          setMatchingProgress(`Matching claim ${current} of ${total}...`)
        },
        matchBrandId
      )
```

This removes the ~25 lines of `brandFacts` fetching and replaces the 4th argument from `brandFacts` array to `matchBrandId` number.

**Step 2: Verify the page still renders**

Run frontend dev server and navigate to `/mkg2`. Verify:
- Brand selection works
- Document upload works
- Claim detection runs
- Matching runs (should use semantic search if embeddings exist, keyword fallback otherwise)

**Step 3: Commit**

```bash
git add app/src/pages/MKG2ClaimsDetector.jsx
git commit -m "feat: update MKG2 to pass brandId for semantic matching"
```

---

### Task 10: Auto-embed on reference upload

**Files:**
- Modify: `backend/src/controllers/referenceController.js:40-52` (add auto-embed after upload)

**Step 1: Add auto-embedding to upload handler**

In `backend/src/controllers/referenceController.js`, add import at top:

```javascript
import { embedReference } from '../services/passageEmbedder.js'
import { ReferencePassage } from '../models/ReferencePassage.js'
```

Then after the existing auto-index block (after line 52, after the `extractFacts` async block), add:

```javascript
      // Auto-embed: create passage embeddings for semantic search
      if (text && process.env.VITE_GEMINI_API_KEY) {
        embedReference(text)
          .then(passages => {
            ReferencePassage.createPassages(ref.id, passages)
            console.log(`Auto-embedded ref ${ref.id} (${displayAlias}): ${passages.length} passages`)
          })
          .catch(err => {
            console.error(`Auto-embed failed for ref ${ref.id}:`, err.message)
          })
      }
```

**Step 2: Verify auto-embedding works**

Upload a new reference PDF via the UI or curl, then check:
```bash
cd backend && node -e "
import { initDb, getDb, closeDb } from './src/config/database.js';
initDb();
const db = getDb();
const recent = db.prepare('SELECT rp.reference_id, rd.display_alias, COUNT(*) as passages FROM reference_passages rp JOIN reference_documents rd ON rd.id = rp.reference_id GROUP BY rp.reference_id ORDER BY rp.created_at DESC LIMIT 3').all();
console.log('Recent embeddings:', recent);
closeDb();
"
```

**Step 3: Commit**

```bash
git add backend/src/controllers/referenceController.js
git commit -m "feat: auto-embed references on upload for semantic search"
```

---

### Task 11: Update CLAUDE.md with new pipeline documentation

**Files:**
- Modify: `CLAUDE.md` (update POC2 Reference Matching Pipeline section)

**Step 1: Update the matching pipeline docs**

In the root `CLAUDE.md`, find the "### POC2 Reference Matching Pipeline (MKG2)" section and update it to reflect the new pipeline:

Replace the existing pipeline steps (1-3) with:

```markdown
### POC2 Reference Matching Pipeline (MKG2)

1. **Step 1:** Detect claims using selected AI model (same as POC1). If brand has indexed facts, a condensed fact inventory is appended to the detection prompt for grounded knowledge.
2. **Step 2:** For each claim, semantic search matching:
   - **Embed claim** via Gemini `gemini-embedding-001` (768-dim, backend endpoint)
   - **KNN search** across all brand reference passages (~1000-word chunks stored in `reference_passages` table)
   - **AI confirmation** via Gemini 2.0 Flash with top 5 most similar passages (full text, not truncated)
   - **Fallback** to keyword matching if embeddings haven't been generated for the brand
3. **All claims always shown** — over-flag principle means we never hide unmatched claims.
```

Also add a new section after "### Reference Fact Indexing":

```markdown
### Reference Passage Embeddings

Pre-chunks reference documents into ~1000-word overlapping passages and embeds each via Gemini `gemini-embedding-001` (768-dim vectors). Stored in `reference_passages` table, searched via cosine similarity for KNN retrieval.

- **Batch embedding:** `node scripts/embed-references.js` processes un-embedded refs (default concurrency: 5, configurable via `--concurrency <n>`)
- **Auto-embed on upload:** New references are automatically chunked and embedded async after upload (non-blocking, requires `VITE_GEMINI_API_KEY`)
- **Search:** `POST /api/brands/:brandId/passages/search` — embeds query text and returns top-K similar passages
- **Status:** `GET /api/brands/:brandId/passages/status` — embedding status per reference
- **Dependencies:** `sqlite-vec` (loaded into better-sqlite3), `gemini-embedding-001` via `@google/genai`
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with semantic matching pipeline"
```

---

### Task 12: End-to-end verification

**Step 1: Ensure backend has embeddings**

```bash
cd backend && node scripts/embed-references.js
```

**Step 2: Start both servers**

Terminal 1:
```bash
cd backend && npm run dev
```
Terminal 2:
```bash
cd app && npm run dev
```

**Step 3: Test the full flow**

1. Navigate to `http://localhost:5173/mkg2`
2. Select a brand (e.g., "MKG Reference Library")
3. Upload a test PDF with known claims
4. Run claim detection
5. Verify matching runs and connects claims to references
6. Check that claims which have exact 1:1 lines in references are now matched correctly
7. Compare match rate against previous runs

**Step 4: Verify fallback behavior**

Test with a brand that has no embeddings:
1. Create a new brand
2. Upload a reference (auto-embed may take a moment)
3. Before embeddings complete, try matching — should fall back to keyword matching
4. After embeddings complete, try again — should use semantic search

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete semantic reference matching pipeline

Replaces keyword-based claim-to-reference matching with embedding-based
semantic search using Gemini gemini-embedding-001 and sqlite-vec.

- References chunked into ~1000-word overlapping passages
- Each passage embedded as 768-dim vector via Gemini embedding API
- KNN cosine similarity search finds top 5 passages per claim
- AI confirmation step receives full passage text (no truncation)
- Graceful fallback to keyword matching when embeddings unavailable
- Auto-embed on upload, batch script for existing references"
```
