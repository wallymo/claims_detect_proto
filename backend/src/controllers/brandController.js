import { Brand } from '../models/Brand.js'
import { AppError } from '../middleware/errorHandler.js'

export const brandController = {
  create(req, res, next) {
    try {
      const { name, client } = req.body
      const brand = Brand.create({ name, client })
      res.status(201).json(brand)
    } catch (err) {
      next(err)
    }
  },

  list(req, res, next) {
    try {
      const { client } = req.query
      const brands = Brand.findAll({ client })
      res.json({ brands })
    } catch (err) {
      next(err)
    }
  },

  get(req, res, next) {
    try {
      const brand = Brand.findById(req.params.id)
      if (!brand) throw new AppError('Brand not found', 404)
      res.json(brand)
    } catch (err) {
      next(err)
    }
  },

  delete(req, res, next) {
    try {
      const brand = Brand.findById(req.params.id)
      if (!brand) throw new AppError('Brand not found', 404)
      const result = Brand.delete(req.params.id)
      res.json({ message: 'Brand deleted', ...result })
    } catch (err) {
      next(err)
    }
  }
}
