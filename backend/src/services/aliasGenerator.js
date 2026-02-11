export function generateAlias(filename) {
  let alias = filename

  // Strip extension
  alias = alias.replace(/\.[^.]+$/, '')

  // Replace separators with spaces
  alias = alias.replace(/[_\-\.]+/g, ' ')

  // Remove common prefixes: dates, version numbers, codes
  alias = alias.replace(/^\d{4}[\s-]\d{2}[\s-]\d{2}\s*/i, '')
  alias = alias.replace(/^v\d+(\.\d+)?\s*/i, '')
  alias = alias.replace(/^[A-Z]{2,4}-[A-Z]{2,4}-\d+\s*/i, '')

  // Remove trailing version/status markers
  alias = alias.replace(/\s*(FINAL|DRAFT|v\d+(\.\d+)?|copy)\s*$/i, '')

  // Collapse whitespace
  alias = alias.replace(/\s+/g, ' ').trim()

  // Title case
  alias = alias.replace(/\b\w/g, c => c.toUpperCase())

  // Truncate
  if (alias.length > 100) {
    alias = alias.slice(0, 100).replace(/\s\w*$/, '')
  }

  return alias || filename
}
