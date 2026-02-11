/**
 * Batch-index reference documents to extract structured facts via Gemini.
 * Run: node scripts/index-references.js
 * Flags:
 *   --force       Re-index all references (even already indexed)
 *   --brand <name>  Index only one brand's references
 */
import 'dotenv/config'
import { initDb, getDb, closeDb } from '../src/config/database.js'
import { extractFacts } from '../src/services/factExtractor.js'

function parseArgs() {
  const args = process.argv.slice(2)
  const flags = { force: false, brand: null }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') flags.force = true
    if (args[i] === '--brand' && args[i + 1]) {
      flags.brand = args[++i]
    }
  }
  return flags
}

async function main() {
  const flags = parseArgs()
  console.log('=== Reference Fact Indexing ===\n')
  if (flags.force) console.log('Mode: FORCE (re-indexing all)')
  if (flags.brand) console.log(`Brand filter: ${flags.brand}`)
  console.log()

  initDb()
  const db = getDb()

  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY not set. Add it to backend/.env')
    closeDb()
    process.exit(1)
  }

  // Build query for references needing indexing
  let query = `
    SELECT rd.id, rd.display_alias, rd.filename, rd.content_text, b.name as brand_name
    FROM reference_documents rd
    JOIN brands b ON b.id = rd.brand_id
    WHERE rd.content_text IS NOT NULL
  `
  const params = []

  if (!flags.force) {
    query += `
      AND (rd.id NOT IN (SELECT reference_id FROM reference_facts WHERE extraction_status = 'indexed')
           OR rd.id IN (SELECT reference_id FROM reference_facts WHERE extraction_status = 'failed'))
    `
  }

  if (flags.brand) {
    query += ' AND b.name = ?'
    params.push(flags.brand)
  }

  query += ' ORDER BY rd.id'

  const references = db.prepare(query).all(...params)

  if (references.length === 0) {
    console.log('No references need indexing. Use --force to re-index all.')
    closeDb()
    return
  }

  console.log(`Found ${references.length} references to index\n`)

  let indexed = 0
  let failed = 0

  for (let i = 0; i < references.length; i++) {
    const ref = references[i]
    const label = `${i + 1}/${references.length}`
    console.log(`Indexing ${label}: ${ref.display_alias} [${ref.brand_name}]...`)

    try {
      // Mark as extracting
      const existing = db.prepare('SELECT id FROM reference_facts WHERE reference_id = ?').get(ref.id)
      if (existing) {
        db.prepare(
          "UPDATE reference_facts SET extraction_status = 'extracting', updated_at = CURRENT_TIMESTAMP WHERE reference_id = ?"
        ).run(ref.id)
      } else {
        db.prepare(
          "INSERT INTO reference_facts (reference_id, extraction_status) VALUES (?, 'extracting')"
        ).run(ref.id)
      }

      const facts = await extractFacts(ref.content_text)

      // Store results
      db.prepare(`
        UPDATE reference_facts
        SET facts_json = ?, extraction_status = 'indexed', model_used = 'gemini-2.5-flash',
            error_message = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE reference_id = ?
      `).run(JSON.stringify(facts), ref.id)

      console.log(`  ${facts.length} facts extracted`)
      indexed++
    } catch (err) {
      console.error(`  FAILED: ${err.message}`)
      db.prepare(`
        UPDATE reference_facts
        SET extraction_status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE reference_id = ?
      `).run(err.message, ref.id)
      failed++
    }

    // Rate limit: 1 second between requests to avoid Gemini throttling
    if (i < references.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  console.log('\n=== Indexing Complete ===')
  console.log(`Indexed: ${indexed}`)
  console.log(`Failed: ${failed}`)
  console.log(`Total: ${references.length}`)

  // Summary
  const summary = db.prepare(`
    SELECT extraction_status, COUNT(*) as count
    FROM reference_facts
    GROUP BY extraction_status
  `).all()
  console.log('\nOverall status:')
  summary.forEach(s => console.log(`  ${s.extraction_status}: ${s.count}`))

  closeDb()
}

main().catch(err => {
  console.error('Indexing error:', err)
  closeDb()
  process.exit(1)
})
