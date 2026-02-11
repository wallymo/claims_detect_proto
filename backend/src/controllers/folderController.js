import { Folder } from '../models/Folder.js'
import { AppError } from '../middleware/errorHandler.js'

export const folderController = {
  list(req, res, next) {
    try {
      const folders = Folder.getAll()
      res.json({ folders })
    } catch (err) {
      next(err)
    }
  },

  create(req, res, next) {
    try {
      const { name } = req.body
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new AppError('Name is required', 400)
      }
      if (name.length > 200) {
        throw new AppError('Name must be 200 characters or less', 400)
      }
      const folder = Folder.create(name)
      res.status(201).json(folder)
    } catch (err) {
      next(err)
    }
  },

  update(req, res, next) {
    try {
      const folder = Folder.getById(req.params.id)
      if (!folder) throw new AppError('Folder not found', 404)
      const { name } = req.body
      if (!name || typeof name !== 'string' || name.trim().length === 0) {
        throw new AppError('Name is required', 400)
      }
      if (name.length > 200) {
        throw new AppError('Name must be 200 characters or less', 400)
      }
      const updated = Folder.update(req.params.id, name)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  },

  remove(req, res, next) {
    try {
      const folder = Folder.getById(req.params.id)
      if (!folder) throw new AppError('Folder not found', 404)
      Folder.remove(req.params.id)
      res.json({ message: 'Folder deleted' })
    } catch (err) {
      next(err)
    }
  }
}
