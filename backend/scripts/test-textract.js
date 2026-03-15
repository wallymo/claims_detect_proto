/**
 * Quick test: Send page 1 of Marissa's PDF to AWS Textract and see what comes back.
 * Run: node scripts/test-textract.js
 */
import { TextractClient, DetectDocumentTextCommand } from '@aws-sdk/client-textract'
import { readFileSync } from 'fs'
import { execSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import 'dotenv/config'

const PDF_PATH = '/Users/wallymo/Downloads/Marissa_SYN slides for AI testing_V3_no annos-pages (1).pdf'
const PAGE_TO_TEST = 1

// Step 1: Render PDF page to PNG
const pngBase = join(tmpdir(), 'textract-test-page')
execSync(`pdftoppm -png -f ${PAGE_TO_TEST} -l ${PAGE_TO_TEST} -r 200 "${PDF_PATH}" "${pngBase}"`, { stdio: 'pipe' })
const pngPath = `${pngBase}-${PAGE_TO_TEST}.png`
const imageBytes = readFileSync(pngPath)
console.log(`Rendered page ${PAGE_TO_TEST} to PNG (${(imageBytes.length / 1024).toFixed(0)}KB)`)

// Step 2: Verify credentials loaded
console.log(`AWS Region: ${process.env.AWS_REGION}`)
console.log(`AWS Key ID: ${process.env.AWS_ACCESS_KEY_ID?.slice(0, 8)}...`)

// Step 3: Send to Textract
const client = new TextractClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
})

console.log('\nSending to Textract DetectDocumentText...\n')

try {
  const response = await client.send(new DetectDocumentTextCommand({
    Document: { Bytes: imageBytes }
  }))

  const lines = response.Blocks
    .filter(b => b.BlockType === 'LINE')
    .map(b => ({
      text: b.Text,
      confidence: b.Confidence?.toFixed(1),
      top: (b.Geometry.BoundingBox.Top * 100).toFixed(1),
      left: (b.Geometry.BoundingBox.Left * 100).toFixed(1)
    }))

  const slideLines = lines.filter(l => parseFloat(l.top) < 45)
  const notesLines = lines.filter(l => parseFloat(l.top) >= 45)

  console.log('=== SLIDE REGION (from image) ===')
  for (const line of slideLines) {
    console.log(`  [y:${line.top}%, x:${line.left}%] (${line.confidence}%) ${line.text}`)
  }

  console.log(`\n=== SPEAKER NOTES REGION ===`)
  for (const line of notesLines) {
    console.log(`  [y:${line.top}%, x:${line.left}%] (${line.confidence}%) ${line.text}`)
  }

  console.log(`\n--- Summary ---`)
  console.log(`Slide region: ${slideLines.length} lines`)
  console.log(`Notes region: ${notesLines.length} lines`)
} catch (err) {
  console.error('Textract API error:', err.name, '-', err.message)
}
