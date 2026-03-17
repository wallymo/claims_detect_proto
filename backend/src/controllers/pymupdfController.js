import { execFile } from 'child_process'
import { promisify } from 'util'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { fileURLToPath } from 'url'
import { AppError } from '../middleware/errorHandler.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Project root is three levels up from controllers/
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_BIN = path.join(PROJECT_ROOT, 'scripts/.venv/bin/python3')
const PYMUPDF_SCRIPT = path.join(PROJECT_ROOT, 'scripts/pymupdf_poc.py')

// Disk-based upload to temp dir — execFile needs a file path
export const pymupdfUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `pymupdf_${Date.now()}_${file.originalname}`)
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true)
    else cb(new Error('Only PDF files are supported'), false)
  }
}).single('pdf')

export const pymupdfController = {
  async extract(req, res, next) {
    const tempPath = req.file?.path
    try {
      if (!req.file) {
        throw new AppError('No PDF file provided', 400)
      }

      // Verify Python env exists
      if (!fs.existsSync(PYTHON_BIN)) {
        throw new AppError('PyMuPDF virtual environment not found. Run: cd scripts && python3 -m venv .venv && pip install pymupdf', 500)
      }

      const { stdout, stderr } = await execFileAsync(
        PYTHON_BIN,
        [PYMUPDF_SCRIPT, tempPath],
        { maxBuffer: 50 * 1024 * 1024, timeout: 60_000 }
      )

      if (stderr) {
        console.warn('PyMuPDF stderr:', stderr)
      }

      const result = JSON.parse(stdout)
      res.json(result)
    } catch (err) {
      if (err.killed) {
        return next(new AppError('PyMuPDF script timed out', 504))
      }
      if (err instanceof SyntaxError) {
        return next(new AppError('PyMuPDF returned invalid JSON', 500))
      }
      if (err.code === 'ENOENT') {
        return next(new AppError('PyMuPDF script not found', 500))
      }
      // execFile failure with stderr
      if (err.stderr) {
        return next(new AppError(`PyMuPDF extraction failed: ${err.stderr.slice(0, 500)}`, 500))
      }
      next(err)
    } finally {
      // Clean up temp file
      if (tempPath) {
        fs.unlink(tempPath, () => {})
      }
    }
  }
}
