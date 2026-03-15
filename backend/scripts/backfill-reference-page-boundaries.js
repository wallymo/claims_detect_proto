/**
 * Backfill page_boundaries (and missing citation_metadata) for existing PDF references.
 * Run: node scripts/backfill-reference-page-boundaries.js
 *
 * Idempotent: only processes PDF rows that are missing page_boundaries or citation_metadata.
 */
import 'dotenv/config'
import { initDb, getDb, closeDb } from '../src/config/database.js'
import { hydrateReferenceTextFromFile } from '../src/services/referenceTextHydrator.js'

async function main() {
  console.log('=== Reference Page Boundary Backfill ===\n')

  initDb()
  const db = getDb()

  const references = db.prepare(`
    SELECT id, filename, display_alias, file_path, doc_type, content_text, page_count, page_boundaries, citation_metadata
    FROM reference_documents
    WHERE doc_type = 'pdf'
      AND (
        page_boundaries IS NULL
        OR TRIM(page_boundaries) = ''
        OR citation_metadata IS NULL
        OR TRIM(citation_metadata) = ''
      )
    ORDER BY id
  `).all()

  if (references.length === 0) {
    console.log('No PDF references need page-boundary backfill.')
    closeDb()
    return
  }

  console.log(`Found ${references.length} PDF references to backfill\n`)

  const updateStmt = db.prepare(`
    UPDATE reference_documents
    SET content_text = ?, page_count = ?, page_boundaries = ?, citation_metadata = ?
    WHERE id = ?
  `)

  let updated = 0
  for (const ref of references) {
    try {
      const hydrated = await hydrateReferenceTextFromFile(ref)
      if (!hydrated?.content_text || !Array.isArray(hydrated.page_boundaries) || hydrated.page_boundaries.length === 0) {
        console.log(`[SKIP] id=${ref.id} ${ref.display_alias || ref.filename} (no extractable page boundaries)`)
        continue
      }

      updateStmt.run(
        hydrated.content_text,
        hydrated.page_count,
        JSON.stringify(hydrated.page_boundaries),
        hydrated.citation_metadata ? JSON.stringify(hydrated.citation_metadata) : null,
        ref.id
      )
      updated += 1
      console.log(`[${updated}/${references.length}] Backfilled: ${ref.display_alias || ref.filename}`)
    } catch (err) {
      console.error(`[ERROR] id=${ref.id} (${ref.display_alias || ref.filename}): ${err.message}`)
    }
  }

  console.log(`\nDone. Backfilled ${updated} of ${references.length} PDF references.`)
  closeDb()
}

main().catch(err => {
  console.error('Backfill error:', err)
  closeDb()
  process.exit(1)
})
