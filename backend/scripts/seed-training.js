import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDb, closeDb } from '../src/config/database.js'
import { TrainingSession } from '../src/models/TrainingSession.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_CLAIMS_FILE = path.resolve(__dirname, '../../docs/training/gbs-trifold-claims.json')
const DEFAULT_DOCUMENT_NAME = 'SYN-ANXB-17435 GBS Congress Materials_Tri-Fold_Mv6_ANNOS.pdf'

function parseArgs(argv) {
  const args = {}

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue

    const equalsIndex = arg.indexOf('=')
    if (equalsIndex !== -1) {
      const key = arg.slice(0, equalsIndex)
      const value = arg.slice(equalsIndex + 1)
      args[key] = value
      continue
    }

    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      args[arg] = next
      i++
      continue
    }

    args[arg] = true
  }

  return args
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2))
    const brandIdArg = args['--brand-id']

    if (brandIdArg === undefined || brandIdArg === true || brandIdArg === '') {
      throw new Error('Missing required argument: --brand-id')
    }

    const brandId = Number.parseInt(String(brandIdArg), 10)
    if (!Number.isInteger(brandId) || brandId <= 0) {
      throw new Error(`Invalid --brand-id value: ${brandIdArg}`)
    }

    const claimsFile = args['--claims-file']
      ? path.resolve(String(args['--claims-file']))
      : DEFAULT_CLAIMS_FILE
    const documentName = args['--document-name']
      ? String(args['--document-name'])
      : DEFAULT_DOCUMENT_NAME

    initDb()

    const existing = TrainingSession
      .listActiveByBrand(brandId)
      .find(session => session.document_name === documentName)

    if (existing) {
      console.log(
        `Training session already exists for brand_id=${brandId} and document_name="${documentName}" (session_id=${existing.id}). Skipping.`
      )
      return
    }

    const fileContent = await fs.readFile(claimsFile, 'utf-8')
    const claims = JSON.parse(fileContent)

    if (!Array.isArray(claims)) {
      throw new Error(`Claims file must contain a JSON array: ${claimsFile}`)
    }

    const session = TrainingSession.create({
      brand_id: brandId,
      label: `Seeded: ${documentName}`,
      document_name: documentName,
      approved_claims: claims,
      prompt_text: null
    })

    console.log(
      `Created training session ${session.id} for brand_id=${brandId} with ${claims.length} claims from ${claimsFile}.`
    )
  } catch (err) {
    console.error('seed-training failed:', err)
    process.exitCode = 1
  } finally {
    closeDb()
  }
}

main()
