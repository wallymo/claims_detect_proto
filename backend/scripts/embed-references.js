import 'dotenv/config'
import pLimit from 'p-limit'
import { initDb, getDb, closeDb } from '../src/config/database.js'
import { ReferencePassage } from '../src/models/ReferencePassage.js'
import { embedReference, chunkText, resolveChunkingOptions, ACTIVE_EMBEDDING_MODEL } from '../src/services/passageEmbedder.js'
import { extractTextByPage } from '../src/services/textExtractor.js'
import fs from 'fs'
import path from 'path'

function parseArgs() {
  const args = process.argv.slice(2)
  const flags = {
    force: false,
    dryRun: false,
    brand: null,
    brandId: null,
    concurrency: 5,
    chunkSize: null,
    chunkOverlap: null,
    limit: null
  }

  const parsePositiveInt = (value, fallback = null) => {
    const parsed = parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') flags.force = true
    if (args[i] === '--dry-run') flags.dryRun = true
    if (args[i] === '--brand' && args[i + 1]) flags.brand = args[++i]
    if (args[i] === '--brand-id' && args[i + 1]) flags.brandId = parsePositiveInt(args[++i], null)
    if (args[i] === '--concurrency' && args[i + 1]) flags.concurrency = parsePositiveInt(args[++i], 5) || 5
    if (args[i] === '--chunk-size' && args[i + 1]) flags.chunkSize = parsePositiveInt(args[++i], null)
    if (args[i] === '--chunk-overlap' && args[i + 1]) flags.chunkOverlap = parsePositiveInt(args[++i], null)
    if (args[i] === '--limit' && args[i + 1]) flags.limit = parsePositiveInt(args[++i], null)
  }
  return flags
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0s'
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  if (min === 0) return `${sec}s`
  return `${min}m ${sec % 60}s`
}

async function embedWithRetry(contentText, embedOptions, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await embedReference(contentText, embedOptions)
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
  const startedAt = Date.now()
  console.log('=== Reference Passage Embedding ===\n')
  console.log(`Embedding model: ${ACTIVE_EMBEDDING_MODEL}`)
  console.log(`Options: force=${flags.force}, dryRun=${flags.dryRun}, brand=${flags.brand || 'all'}, brandId=${flags.brandId || 'any'}, concurrency=${flags.concurrency}, chunkSize=${flags.chunkSize || 'auto'}, chunkOverlap=${flags.chunkOverlap || 'auto'}, limit=${flags.limit || 'none'}\n`)

  if (!flags.dryRun && !process.env.VITE_GEMINI_API_KEY) {
    console.error('ERROR: VITE_GEMINI_API_KEY not set in backend/.env')
    process.exit(1)
  }

  initDb()
  const db = getDb()

  // Build query to find references that need embedding
  let query = `
    SELECT rd.id, rd.display_alias, rd.content_text, rd.brand_id, rd.doc_type, rd.page_count, rd.file_path, b.name as brand_name
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

  if (flags.brandId) {
    query += ' AND b.id = ?'
    params.push(flags.brandId)
  }

  query += ' ORDER BY rd.id'
  if (flags.limit) {
    query += ' LIMIT ?'
    params.push(flags.limit)
  }
  const references = db.prepare(query).all(...params)

  if (references.length === 0) {
    console.log('No references need embedding.')
    closeDb()
    return
  }

  console.log(`Found ${references.length} references to embed.\n`)

  if (flags.force) {
    console.log('Force mode enabled: existing passage embeddings will be replaced.\n')
  }

  const chunkingOptions = {
    chunkSize: flags.chunkSize,
    chunkOverlap: flags.chunkOverlap
  }

  if (flags.dryRun) {
    let totalChars = 0
    let totalChunks = 0

    references.forEach((ref, index) => {
      const contentText = ref.content_text || ''
      const { chunkSize, overlap } = resolveChunkingOptions(contentText.length, chunkingOptions)
      const chunks = chunkText(contentText, chunkSize, overlap)
      totalChars += contentText.length
      totalChunks += chunks.length
      console.log(`[${index + 1}/${references.length}] ${ref.display_alias} (${ref.brand_name})`)
      console.log(`  chars=${contentText.length}, chunk_size=${chunkSize}, overlap=${overlap}, estimated_passages=${chunks.length}`)
    })

    console.log('\n=== Dry Run Summary ===')
    console.log(`References scanned: ${references.length}`)
    console.log(`Total characters: ${totalChars}`)
    console.log(`Estimated passages: ${totalChunks}`)
    console.log(`Estimated avg passages/reference: ${references.length > 0 ? (totalChunks / references.length).toFixed(1) : '0.0'}`)
    closeDb()
    return
  }

  let processed = 0
  let succeeded = 0
  let failed = 0

  const limit = pLimit(flags.concurrency)
  const tasks = references.map((ref) =>
    limit(async () => {
      const label = `${ref.display_alias} (${ref.brand_name})`
      try {
        // Get real page boundaries for PDFs
        let embedOptions = { ...chunkingOptions }
        if (ref.doc_type === 'pdf' && ref.file_path) {
          const fullPath = path.resolve(ref.file_path)
          if (fs.existsSync(fullPath)) {
            try {
              const { pageBoundaries, pageCount } = await extractTextByPage(fullPath)
              embedOptions.pageBoundaries = pageBoundaries
              embedOptions.pageCount = pageCount
            } catch (err) {
              console.warn(`  Could not extract page boundaries for ${label}: ${err.message}`)
            }
          } else {
            console.warn(`  File not found for ${label}, using estimated pages`)
          }
        }
        if ((!embedOptions.pageBoundaries || embedOptions.pageBoundaries.length === 0) && ref.page_count) {
          embedOptions.pageCount = ref.page_count
        }

        const passages = await embedWithRetry(ref.content_text, embedOptions)
        ReferencePassage.createPassages(ref.id, passages)
        succeeded++
        console.log(`${label}: ${passages.length} passages embedded`)
      } catch (err) {
        failed++
        console.error(`${label}: FAILED - ${err.message}`)
      } finally {
        processed++
        console.log(`  Progress ${processed}/${references.length} | ok=${succeeded} failed=${failed} | elapsed ${formatDuration(Date.now() - startedAt)}`)
      }
    })
  )

  await Promise.all(tasks)

  console.log(`\n=== Complete ===`)
  console.log(`Embedded: ${succeeded}/${references.length}`)
  if (failed > 0) console.log(`Failed: ${failed}`)
  console.log(`Elapsed: ${formatDuration(Date.now() - startedAt)}`)
  closeDb()
}

main().catch(err => {
  console.error('Fatal error:', err)
  closeDb()
  process.exit(1)
})
