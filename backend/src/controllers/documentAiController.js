import multer from 'multer'
import { processDocument } from '../services/documentAiService.js'
import { convertDocumentToPages } from '../services/documentAiAdapter.js'
import { AppError } from '../middleware/errorHandler.js'
import { env } from '../config/env.js'

// In-memory upload — Document AI needs the buffer, no disk storage needed.
// 20MB limit matches Document AI's inline processing limit.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true)
    else cb(new Error('Only PDF files are supported'), false)
  }
}).single('file')

export const documentAiController = {
  async extract(req, res, next) {
    try {
      if (!env.DOCUMENT_AI_ENABLED) {
        throw new AppError('Document AI is not enabled', 503)
      }

      if (!req.file) {
        throw new AppError('No PDF file provided', 400)
      }

      const document = await processDocument(req.file.buffer)
      const pages = convertDocumentToPages(document)

      res.json({ pages })
    } catch (err) {
      next(err)
    }
  }
}

export { memoryUpload }
