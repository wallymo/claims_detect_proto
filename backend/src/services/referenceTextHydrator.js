import fs from 'fs'
import path from 'path'
import { extractText, extractTextByPage } from './textExtractor.js'
import { extractCitationMetadata } from './citationMetadataExtractor.js'

function parseJsonField(value) {
  if (!value) return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizePageBoundaries(value) {
  const parsed = parseJsonField(value)
  return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
}

export function normalizeStoredReference(reference) {
  if (!reference || typeof reference !== 'object') return null

  return {
    ...reference,
    page_boundaries: normalizePageBoundaries(reference.page_boundaries),
    citation_metadata: parseJsonField(reference.citation_metadata)
  }
}

function hasPageBoundaries(reference) {
  return Array.isArray(reference?.page_boundaries) && reference.page_boundaries.length > 0
}

export function shouldHydrateReferenceText(reference) {
  const normalized = normalizeStoredReference(reference)
  if (!normalized?.file_path) return false
  if (!normalized.content_text) return true
  return normalized.doc_type === 'pdf' && !hasPageBoundaries(normalized)
}

export async function hydrateReferenceTextFromFile(reference) {
  const normalized = normalizeStoredReference(reference)
  if (!normalized) return null

  const fullPath = path.resolve(normalized.file_path)
  if (!fs.existsSync(fullPath)) {
    return {
      ...normalized,
      didHydrate: false
    }
  }

  if (!shouldHydrateReferenceText(normalized)) {
    return {
      ...normalized,
      didHydrate: false
    }
  }

  let contentText = normalized.content_text || null
  let pageCount = normalized.page_count || null
  let pageBoundaries = normalized.page_boundaries || null

  if (normalized.doc_type === 'pdf') {
    const extracted = await extractTextByPage(fullPath)
    contentText = extracted.fullText || contentText
    pageCount = extracted.pageCount || pageCount
    if (Array.isArray(extracted.pageBoundaries) && extracted.pageBoundaries.length > 0) {
      pageBoundaries = extracted.pageBoundaries
    }
  } else {
    const extracted = await extractText(fullPath, normalized.doc_type)
    contentText = extracted.text || contentText
    pageCount = extracted.pageCount || pageCount
  }

  const citationMetadata = normalized.citation_metadata || (
    contentText
      ? extractCitationMetadata(
          normalized.filename || normalized.display_alias || '',
          contentText,
          pageBoundaries,
          normalized.display_alias || null
        )
      : null
  )

  return {
    ...normalized,
    content_text: contentText,
    page_count: pageCount,
    page_boundaries: pageBoundaries,
    citation_metadata: citationMetadata,
    didHydrate: Boolean(contentText) && (
      !normalized.content_text ||
      !hasPageBoundaries(normalized) ||
      !normalized.citation_metadata
    )
  }
}
