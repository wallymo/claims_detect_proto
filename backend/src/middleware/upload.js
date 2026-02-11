import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { env } from '../config/env.js'

const ALLOWED_EXTENSIONS = ['.pdf', '.docx', '.doc']

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const brandId = req.params.brandId
    const dir = path.resolve(env.UPLOAD_DIR, 'references', String(brandId))
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const sanitized = file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .toLowerCase()
      .slice(0, 200)
    cb(null, `${Date.now()}_${sanitized}`)
  }
})

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase()
  if (ALLOWED_EXTENSIONS.includes(ext)) {
    cb(null, true)
  } else {
    cb(new Error('Unsupported file type. Accepted: pdf, docx, doc'), false)
  }
}

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.MAX_FILE_SIZE_MB * 1024 * 1024
  }
})
