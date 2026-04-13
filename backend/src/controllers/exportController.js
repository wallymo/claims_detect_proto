import { execFile } from 'child_process'
import { promisify } from 'util'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { promises as fsPromises } from 'fs'
import { fileURLToPath } from 'url'
import { AppError } from '../middleware/errorHandler.js'
import { AcceptedEvidence } from '../models/AcceptedEvidence.js'
import { buildApprovedExportClaims } from '../services/mlrExport.js'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const TMP_DIR = path.join(PROJECT_ROOT, 'tmp', 'pdfs')
const PYTHON_BIN = path.join(PROJECT_ROOT, 'scripts/.venv/bin/python3')
const EXPORT_SCRIPT = path.join(PROJECT_ROOT, 'scripts/mlr_gutter_export.py')

fs.mkdirSync(TMP_DIR, { recursive: true })

function sanitizeFilename(name) {
  const base = String(name || 'annotations')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  return `${base || 'annotations'}-mlr-export.pdf`
}

function safeUnlink(filePath) {
  if (!filePath) return Promise.resolve()
  return fsPromises.unlink(filePath).catch(() => {})
}

export const exportUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, `mlr_export_${Date.now()}_${file.originalname}`)
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true)
    else cb(new Error('Only PDF files are supported'), false)
  }
}).single('pdf')

export const exportController = {
  async exportMlrPdf(req, res, next) {
    const inputPdfPath = req.file?.path
    let payloadPath = null
    let outputPdfPath = null
    let responseStarted = false

    const cleanup = async () => {
      await Promise.all([
        safeUnlink(inputPdfPath),
        safeUnlink(payloadPath),
        safeUnlink(outputPdfPath),
      ])
    }

    try {
      if (!req.file) {
        throw new AppError('No PDF file provided', 400)
      }

      if (!fs.existsSync(PYTHON_BIN)) {
        throw new AppError('PyMuPDF virtual environment not found. Run: cd scripts && python3 -m venv .venv && pip install -r requirements.txt', 500)
      }

      if (!fs.existsSync(EXPORT_SCRIPT)) {
        throw new AppError('MLR export script not found', 500)
      }

      let rawClaims = []
      try {
        rawClaims = JSON.parse(req.body?.claims_json || '[]')
      } catch {
        throw new AppError('claims_json must be valid JSON', 400)
      }

      if (!Array.isArray(rawClaims)) {
        throw new AppError('claims_json must be an array', 400)
      }

      const exportClaims = buildApprovedExportClaims(rawClaims, {
        getAcceptedEvidenceForPair: (claimId, referenceId) => AcceptedEvidence.findByClaimAndRef(claimId, referenceId)
      })

      if (exportClaims.length === 0) {
        throw new AppError('No approved claims with notation lines available for export', 400)
      }

      const timestamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      payloadPath = path.join(TMP_DIR, `mlr_export_payload_${timestamp}.json`)
      outputPdfPath = path.join(TMP_DIR, `mlr_export_output_${timestamp}.pdf`)

      const payload = {
        document_name: req.body?.document_name || req.file.originalname || 'annotations.pdf',
        annotations: exportClaims,
      }

      await fsPromises.writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf-8')

      const { stderr } = await execFileAsync(
        PYTHON_BIN,
        [EXPORT_SCRIPT, inputPdfPath, payloadPath, outputPdfPath],
        { maxBuffer: 20 * 1024 * 1024, timeout: 60_000 }
      )

      if (stderr) {
        console.warn('MLR export stderr:', stderr)
      }

      const outputStat = await fsPromises.stat(outputPdfPath).catch(() => null)
      if (!outputStat || outputStat.size === 0) {
        throw new AppError('MLR export did not produce a PDF', 500)
      }

      responseStarted = true
      const downloadName = sanitizeFilename(payload.document_name)
      res.download(outputPdfPath, downloadName, async (err) => {
        await cleanup()
        if (err && !res.headersSent) {
          next(err)
        }
      })
    } catch (err) {
      if (err.killed) {
        return next(new AppError('MLR export timed out', 504))
      }
      if (err.code === 'ENOENT') {
        return next(new AppError('MLR export dependencies not found', 500))
      }
      if (err.stderr) {
        return next(new AppError(`MLR export failed: ${String(err.stderr).slice(0, 500)}`, 500))
      }
      next(err)
    } finally {
      if (!responseStarted) {
        await cleanup()
      }
    }
  }
}
