import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const execAsync = promisify(exec)

/**
 * Convert DOCX/PPTX to PDF using LibreOffice headless
 * @param {string} inputPath - Path to input file
 * @param {string} fileType - File type (docx|pptx)
 * @returns {Promise<string>} Path to converted PDF
 */
export async function convertToPDF(inputPath, fileType) {
  const outputDir = path.dirname(inputPath)

  console.log(`Converting ${fileType} to PDF: ${inputPath}`)

  // LibreOffice headless conversion command
  const cmd = `soffice --headless --convert-to pdf --outdir "${outputDir}" "${inputPath}"`

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: 60000,  // 60 second timeout
      maxBuffer: 10 * 1024 * 1024  // 10MB buffer
    })

    if (stderr) {
      console.warn('LibreOffice stderr:', stderr)
    }
    if (stdout) {
      console.log('LibreOffice stdout:', stdout)
    }
  } catch (error) {
    throw new Error(`LibreOffice conversion failed: ${error.message}`)
  }

  // LibreOffice outputs: input.docx → input.pdf
  const baseName = path.basename(inputPath, path.extname(inputPath))
  const pdfPath = path.join(outputDir, `${baseName}.pdf`)

  // Verify output file exists
  try {
    await fs.access(pdfPath)
  } catch {
    throw new Error('Conversion produced no output file')
  }

  console.log(`Conversion complete: ${pdfPath}`)
  return pdfPath
}

/**
 * Cleanup temporary files
 * @param {string[]} filePaths - Paths to delete
 */
export async function cleanupFiles(filePaths) {
  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath)
      console.log(`Cleaned up: ${filePath}`)
    } catch (error) {
      console.warn(`Failed to cleanup ${filePath}:`, error.message)
    }
  }
}
