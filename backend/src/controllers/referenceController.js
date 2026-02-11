import { Reference } from '../models/Reference.js'
import { Brand } from '../models/Brand.js'
import { ReferenceFact } from '../models/ReferenceFact.js'
import { extractText } from '../services/textExtractor.js'
import { extractFacts } from '../services/factExtractor.js'
import { generateAlias } from '../services/aliasGenerator.js'
import { AppError } from '../middleware/errorHandler.js'
import path from 'path'
import fs from 'fs'

export const referenceController = {
  async upload(req, res, next) {
    try {
      const brandId = parseInt(req.params.brandId, 10)
      const brand = Brand.findById(brandId)
      if (!brand) throw new AppError('Brand not found', 404)

      if (!req.file) throw new AppError('No file uploaded', 400)

      const file = req.file
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '')
      const docType = ext === 'docx' ? 'docx' : ext === 'doc' ? 'doc' : 'pdf'

      const displayAlias = req.body.display_alias?.trim() || generateAlias(file.originalname)

      const { text, pageCount } = await extractText(file.path, docType)

      const ref = Reference.create({
        brand_id: brandId,
        filename: file.filename,
        display_alias: displayAlias,
        file_path: path.relative(process.cwd(), file.path),
        doc_type: docType,
        content_text: text,
        notes: req.body.notes || '',
        page_count: pageCount,
        file_size_bytes: file.size
      })

      // Auto-index: create pending facts row and kick off async extraction
      if (text && process.env.GEMINI_API_KEY) {
        ReferenceFact.createPending(ref.id)
        extractFacts(text)
          .then(facts => {
            ReferenceFact.createOrUpdate(ref.id, facts, 'indexed', 'gemini-2.5-flash')
            console.log(`Auto-indexed ref ${ref.id} (${displayAlias}): ${facts.length} facts`)
          })
          .catch(err => {
            console.error(`Auto-index failed for ref ${ref.id}:`, err.message)
            ReferenceFact.updateStatus(ref.id, 'failed', err.message)
          })
      }

      res.status(201).json(ref)
    } catch (err) {
      next(err)
    }
  },

  list(req, res, next) {
    try {
      const brandId = parseInt(req.params.brandId, 10)
      const brand = Brand.findById(brandId)
      if (!brand) throw new AppError('Brand not found', 404)
      const folderId = req.query.folder_id !== undefined ? parseInt(req.query.folder_id, 10) : undefined
      const references = Reference.findByBrand(brandId, folderId)
      res.json({ references })
    } catch (err) {
      next(err)
    }
  },

  get(req, res, next) {
    try {
      const ref = Reference.findById(req.params.refId)
      if (!ref) throw new AppError('Reference not found', 404)
      res.json(ref)
    } catch (err) {
      next(err)
    }
  },

  update(req, res, next) {
    try {
      const existing = Reference.findById(req.params.refId)
      if (!existing) throw new AppError('Reference not found', 404)
      const updated = Reference.update(req.params.refId, req.body)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  },

  delete(req, res, next) {
    try {
      const existing = Reference.findById(req.params.refId)
      if (!existing) throw new AppError('Reference not found', 404)
      const { filePath } = Reference.delete(req.params.refId)
      if (filePath) {
        const fullPath = path.resolve(filePath)
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath)
        }
      }
      res.json({ message: 'Reference deleted' })
    } catch (err) {
      next(err)
    }
  },

  bulkMove(req, res, next) {
    try {
      const { ids, folder_id } = req.body
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new AppError('ids must be a non-empty array', 400)
      }
      if (folder_id !== null && (folder_id === undefined || isNaN(parseInt(folder_id, 10)))) {
        throw new AppError('folder_id must be a number or null', 400)
      }
      const result = Reference.bulkMove(ids, folder_id)
      res.json(result)
    } catch (err) {
      next(err)
    }
  },

  bulkDelete(req, res, next) {
    try {
      const { ids } = req.body
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new AppError('ids must be a non-empty array', 400)
      }
      const { deleted, filePaths } = Reference.bulkDelete(ids)
      for (const filePath of filePaths) {
        const fullPath = path.resolve(filePath)
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath)
        }
      }
      res.json({ message: `${deleted} references deleted` })
    } catch (err) {
      next(err)
    }
  }
}
