export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = true
  }
}

export function errorHandler(err, req, res, next) {
  // Multer file-too-large
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum: 50MB' })
  }

  // Multer unexpected field
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: 'Unexpected file field' })
  }

  // Operational error
  if (err.isOperational) {
    return res.status(err.statusCode).json({ error: err.message })
  }

  // Unexpected error
  console.error('Unexpected error:', err)
  res.status(500).json({ error: 'Internal server error' })
}
