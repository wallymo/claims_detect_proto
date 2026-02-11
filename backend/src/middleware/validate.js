import { AppError } from './errorHandler.js'

export function validateBrandCreate(req, res, next) {
  const { name } = req.body
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return next(new AppError('Name is required', 400))
  }
  if (name.length > 200) {
    return next(new AppError('Name must be 200 characters or less', 400))
  }
  if (req.body.client && req.body.client.length > 200) {
    return next(new AppError('Client must be 200 characters or less', 400))
  }
  next()
}

export function validateReferenceUpdate(req, res, next) {
  const { display_alias, notes } = req.body
  if (!display_alias && notes === undefined) {
    return next(new AppError('No fields to update', 400))
  }
  if (display_alias !== undefined) {
    if (typeof display_alias !== 'string' || display_alias.trim().length === 0) {
      return next(new AppError('Display alias must be a non-empty string', 400))
    }
    if (display_alias.length > 100) {
      return next(new AppError('Display alias must be 100 characters or less', 400))
    }
  }
  if (notes !== undefined && notes.length > 2000) {
    return next(new AppError('Notes must be 2000 characters or less', 400))
  }
  next()
}

export function validateIdParam(paramName = 'id') {
  return (req, res, next) => {
    const value = req.params[paramName]
    if (!value || isNaN(parseInt(value, 10)) || parseInt(value, 10) < 1) {
      return next(new AppError(`Invalid ${paramName}`, 400))
    }
    next()
  }
}
