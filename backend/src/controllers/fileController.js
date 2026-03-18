import { Reference } from '../models/Reference.js'
import { AppError } from '../middleware/errorHandler.js'
import { hydrateReferenceTextFromFile, shouldHydrateReferenceText } from '../services/referenceTextHydrator.js'
import path from 'path'
import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath } from 'url'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '../../..')
const PYTHON_BIN = path.join(PROJECT_ROOT, 'scripts/.venv/bin/python3')
const EXTRACT_MARKERS_SCRIPT = path.join(PROJECT_ROOT, 'scripts/extract_markers.py')

const MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword'
}

export const fileController = {
  serve(req, res, next) {
    try {
      const ref = Reference._findByIdFull(req.params.refId)
      if (!ref) throw new AppError('Reference not found', 404)

      const fullPath = path.resolve(ref.file_path)
      if (!fs.existsSync(fullPath)) {
        throw new AppError('File not found on disk', 404)
      }

      const mimeType = MIME_TYPES[ref.doc_type] || 'application/octet-stream'
      const ext = ref.doc_type === 'docx' ? '.docx' : ref.doc_type === 'doc' ? '.doc' : '.pdf'

      res.setHeader('Content-Type', mimeType)
      res.setHeader('Content-Disposition', `inline; filename="${ref.display_alias}${ext}"`)

      const stream = fs.createReadStream(fullPath)
      stream.pipe(res)
    } catch (err) {
      next(err)
    }
  },

  async getText(req, res, next) {
    try {
      const fullRef = Reference._findByIdFull(req.params.refId)
      if (!fullRef) throw new AppError('Reference not found', 404)

      let ref = Reference.findById(req.params.refId)
      if (shouldHydrateReferenceText(fullRef)) {
        const hydrated = await hydrateReferenceTextFromFile(fullRef)
        if (hydrated?.didHydrate) {
          ref = Reference.updateExtractedContent(fullRef.id, {
            content_text: hydrated.content_text,
            page_count: hydrated.page_count,
            page_boundaries: hydrated.page_boundaries,
            citation_metadata: hydrated.citation_metadata
          })
        } else if (hydrated) {
          ref = {
            ...ref,
            content_text: hydrated.content_text,
            page_count: hydrated.page_count,
            page_boundaries: hydrated.page_boundaries
          }
        }
      }

      if (!ref) throw new AppError('Reference not found', 404)
      if (!ref.content_text) throw new AppError('No extracted text available', 404)

      res.json({
        id: ref.id,
        display_alias: ref.display_alias,
        content_text: ref.content_text,
        page_count: ref.page_count,
        page_boundaries: ref.page_boundaries
      })
    } catch (err) {
      next(err)
    }
  },

  async getMarkers(req, res, next) {
    try {
      const ref = Reference._findByIdFull(req.params.refId)
      if (!ref) throw new AppError('Reference not found', 404)

      const fullPath = path.resolve(ref.file_path)
      if (!fs.existsSync(fullPath)) {
        throw new AppError('File not found on disk', 404)
      }

      if (ref.doc_type !== 'pdf') {
        return res.json({ markers: [] })
      }

      if (!fs.existsSync(PYTHON_BIN)) {
        throw new AppError('PyMuPDF virtual environment not found', 500)
      }

      const { stdout, stderr } = await execFileAsync(
        PYTHON_BIN,
        [EXTRACT_MARKERS_SCRIPT, fullPath],
        { maxBuffer: 10 * 1024 * 1024, timeout: 30_000 }
      )

      if (stderr) {
        console.warn('extract_markers stderr:', stderr)
      }

      const result = JSON.parse(stdout)
      res.json(result)
    } catch (err) {
      if (err.killed) {
        return next(new AppError('Marker extraction timed out', 504))
      }
      if (err instanceof SyntaxError) {
        return next(new AppError('Marker extraction returned invalid JSON', 500))
      }
      if (err.stderr) {
        return next(new AppError(`Marker extraction failed: ${err.stderr.slice(0, 500)}`, 500))
      }
      next(err)
    }
  }
}
