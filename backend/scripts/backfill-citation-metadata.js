/**
 * Backfill citation_metadata for existing reference documents.
 * Run: node scripts/backfill-citation-metadata.js
 *
 * Idempotent: only processes rows where citation_metadata IS NULL and content_text IS NOT NULL.
 */
import 'dotenv/config'
import { initDb, getDb, closeDb } from '../src/config/database.js'
import { extractCitationMetadata } from '../src/services/citationMetadataExtractor.js'

function main() {
  console.log('=== Citation Metadata Backfill ===\n')

  initDb()
  const db = getDb()

  const references = db.prepare(`
    SELECT id, filename, content_text, page_boundaries, display_alias
    FROM reference_documents
    WHERE citation_metadata IS NULL
      AND content_text IS NOT NULL
    ORDER BY id
  `).all()

  if (references.length === 0) {
    console.log('No references need backfilling. All rows already have citation_metadata.')
    closeDb()
    return
  }

  const total = references.length
  console.log(`Found ${total} references to backfill\n`)

  const updateStmt = db.prepare('UPDATE reference_documents SET citation_metadata = ? WHERE id = ?')
  let backfilled = 0

  for (const ref of references) {
    try {
      const metadata = extractCitationMetadata(
        ref.filename,
        ref.content_text,
        ref.page_boundaries,
        ref.display_alias
      )
      updateStmt.run(JSON.stringify(metadata), ref.id)
      backfilled++
      console.log(`[${backfilled}/${total}] Backfilled: ${ref.display_alias || ref.filename}`)
    } catch (err) {
      console.error(`[ERROR] id=${ref.id} (${ref.display_alias || ref.filename}): ${err.message}`)
    }
  }

  console.log(`\nDone. Backfilled ${backfilled} of ${total} references.`)
  closeDb()
}

main()
