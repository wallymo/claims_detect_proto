import { BrandPattern } from '../models/BrandPattern.js'
import { AppError } from '../middleware/errorHandler.js'

export const brandPatternController = {
  record(req, res, next) {
    try {
      const { brand_id, pattern_type, pattern_json, strength_delta } = req.body || {}
      if (!brand_id) throw new AppError('brand_id is required', 400)
      if (!pattern_type) throw new AppError('pattern_type is required', 400)
      if (!pattern_json) throw new AppError('pattern_json is required', 400)

      const pattern = BrandPattern.upsert({
        brand_id: parseInt(brand_id, 10),
        pattern_type,
        pattern_json,
        strength_delta: strength_delta !== undefined ? parseInt(strength_delta, 10) : 1
      })

      res.status(201).json(pattern)
    } catch (err) {
      next(err)
    }
  },

  listByBrand(req, res, next) {
    try {
      const { brandId } = req.params
      if (!brandId) throw new AppError('brandId is required', 400)

      const minStrength = req.query.min_strength ? parseInt(req.query.min_strength, 10) : 1
      const patterns = BrandPattern.findByBrand(parseInt(brandId, 10), { minStrength })
      res.json({ patterns })
    } catch (err) {
      next(err)
    }
  },

  delete(req, res, next) {
    try {
      const { id } = req.params
      BrandPattern.delete(parseInt(id, 10))
      res.json({ deleted: true })
    } catch (err) {
      next(err)
    }
  },

  clearByBrand(req, res, next) {
    try {
      const { brandId } = req.params
      const result = BrandPattern.clearByBrand(parseInt(brandId, 10))
      res.json(result)
    } catch (err) {
      next(err)
    }
  }
}
