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
