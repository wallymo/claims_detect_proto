/**
 * Pre-load reference documents from MKG Knowledge Base into the database.
 * Run once during setup: node scripts/preload-references.js
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDb, getDb, closeDb } from '../src/config/database.js'
import { extractText } from '../src/services/textExtractor.js'
import { generateAlias } from '../src/services/aliasGenerator.js'
import { env } from '../src/config/env.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REFS_SOURCE = path.resolve(__dirname, '../../MKG Knowledge Base/References')
const SUPPORTED_EXTENSIONS = ['.pdf', '.docx', '.doc']

async function main() {
  console.log('=== Pre-loading Reference Documents ===\n')

  // Ensure directories
  fs.mkdirSync(path.resolve('data'), { recursive: true })
  fs.mkdirSync(path.resolve(env.UPLOAD_DIR, 'references'), { recursive: true })

  // Initialize DB
  initDb()
  const db = getDb()

  // Check if already loaded
  const existing = db.prepare('SELECT COUNT(*) as count FROM reference_documents').get()
  if (existing.count > 0) {
    console.log(`Database already has ${existing.count} references. Skipping preload.`)
    console.log('To reload, run: node src/config/database.js --reset && node scripts/preload-references.js')
    closeDb()
    return
  }

  // Create brands
  const brand = db.prepare(
    "INSERT INTO brands (name, client) VALUES (?, ?)"
  ).run('MKG Reference Library', 'MKG')
  const brandId = brand.lastInsertRowid
  console.log(`Created brand: MKG Reference Library (id: ${brandId})`)

  // Seed additional brands
  const additionalBrands = [
    { name: 'Annexon', client: 'Annexon Biosciences' },
    { name: 'XCOPRI', client: 'SK Life Science' },
    { name: 'AI Only', client: 'AI Only' }
  ]
  for (const b of additionalBrands) {
    const result = db.prepare("INSERT INTO brands (name, client) VALUES (?, ?)").run(b.name, b.client)
    console.log(`Created brand: ${b.name} (id: ${result.lastInsertRowid})`)
  }
  console.log()

  // Ensure brand upload directory
  const brandUploadDir = path.resolve(env.UPLOAD_DIR, 'references', String(brandId))
  fs.mkdirSync(brandUploadDir, { recursive: true })

  // Read source directory
  if (!fs.existsSync(REFS_SOURCE)) {
    console.error(`Source directory not found: ${REFS_SOURCE}`)
    closeDb()
    process.exit(1)
  }

  const files = fs.readdirSync(REFS_SOURCE)
    .filter(f => {
      const ext = path.extname(f).toLowerCase()
      return SUPPORTED_EXTENSIONS.includes(ext)
    })
    .sort()

  console.log(`Found ${files.length} supported files\n`)

  let loaded = 0
  let extractionSuccess = 0
  let extractionFailed = 0

  for (let i = 0; i < files.length; i++) {
    const filename = files[i]
    const sourcePath = path.join(REFS_SOURCE, filename)
    const ext = path.extname(filename).toLowerCase()
    const docType = ext === '.docx' ? 'docx' : ext === '.doc' ? 'doc' : 'pdf'

    console.log(`Processing ${i + 1}/${files.length}: ${filename}`)

    // Copy to uploads
    const sanitized = filename
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .toLowerCase()
      .slice(0, 200)
    const destFilename = `${Date.now()}_${sanitized}`
    const destPath = path.join(brandUploadDir, destFilename)
    fs.copyFileSync(sourcePath, destPath)

    // Get file size
    const stats = fs.statSync(destPath)

    // Generate display alias
    const displayAlias = generateAlias(filename)

    // Extract text
    const { text, pageCount } = await extractText(destPath, docType)
    if (text) {
      extractionSuccess++
    } else {
      extractionFailed++
      console.log(`  ⚠ Text extraction failed`)
    }

    // Insert into DB
    const relPath = path.relative(process.cwd(), destPath)
    db.prepare(`
      INSERT INTO reference_documents
        (brand_id, filename, display_alias, file_path, doc_type, content_text, notes, page_count, file_size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      brandId, destFilename, displayAlias, relPath, docType,
      text, '', pageCount, stats.size
    )

    loaded++

    // Small delay to avoid overwhelming the system
    if (i % 10 === 9) {
      console.log(`  ... ${i + 1}/${files.length} processed`)
    }
  }

  console.log('\n=== Pre-load Complete ===')
  console.log(`Total files: ${files.length}`)
  console.log(`Loaded: ${loaded}`)
  console.log(`Text extracted: ${extractionSuccess}`)
  console.log(`Extraction failed: ${extractionFailed}`)

  // Verify
  const count = db.prepare('SELECT COUNT(*) as count FROM reference_documents').get()
  console.log(`\nDatabase now has ${count.count} reference documents`)

  closeDb()
}

main().catch(err => {
  console.error('Preload error:', err)
  closeDb()
  process.exit(1)
})
