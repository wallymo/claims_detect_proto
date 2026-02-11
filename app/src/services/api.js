const API_BASE = '/api'

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options
  }

  // Don't set Content-Type for FormData (let browser set multipart boundary)
  if (options.body instanceof FormData) {
    delete config.headers['Content-Type']
  }

  const response = await fetch(url, config)

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(error.error || `API error: ${response.status}`)
  }

  // Handle file responses (blob)
  if (response.headers.get('content-type')?.includes('application/pdf') ||
      response.headers.get('content-type')?.includes('application/octet-stream')) {
    return response.blob()
  }

  return response.json()
}

// ========== Brands ==========

export async function fetchBrands() {
  const data = await request('/brands')
  return data.brands
}

export async function createBrand({ name, client }) {
  return request('/brands', {
    method: 'POST',
    body: JSON.stringify({ name, client })
  })
}

export async function fetchBrand(id) {
  return request(`/brands/${id}`)
}

export async function deleteBrand(id) {
  return request(`/brands/${id}`, { method: 'DELETE' })
}

// ========== References ==========

export async function fetchReferences(brandId) {
  const data = await request(`/brands/${brandId}/references`)
  return data.references
}

export async function fetchAllReferences() {
  // Fetch all brands then all their references
  const brands = await fetchBrands()
  const allRefs = []
  for (const brand of brands) {
    const refs = await fetchReferences(brand.id)
    allRefs.push(...refs)
  }
  return allRefs
}

export async function fetchReference(brandId, refId) {
  return request(`/brands/${brandId}/references/${refId}`)
}

export async function uploadReference(brandId, file, { display_alias, doc_type, notes } = {}) {
  const formData = new FormData()
  formData.append('file', file)
  if (display_alias) formData.append('display_alias', display_alias)
  if (doc_type) formData.append('doc_type', doc_type)
  if (notes) formData.append('notes', notes)

  return request(`/brands/${brandId}/references`, {
    method: 'POST',
    body: formData
  })
}

export async function updateReference(brandId, refId, { display_alias, notes }) {
  return request(`/brands/${brandId}/references/${refId}`, {
    method: 'PATCH',
    body: JSON.stringify({ display_alias, notes })
  })
}

export async function deleteReference(brandId, refId) {
  return request(`/brands/${brandId}/references/${refId}`, {
    method: 'DELETE'
  })
}

// ========== Folders ==========

export async function fetchFolders() {
  const data = await request('/folders')
  return data.folders
}

export async function createFolder(name) {
  return request('/folders', {
    method: 'POST',
    body: JSON.stringify({ name })
  })
}

export async function updateFolder(id, name) {
  return request(`/folders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name })
  })
}

export async function deleteFolder(id) {
  return request(`/folders/${id}`, { method: 'DELETE' })
}

// ========== Bulk Reference Operations ==========

export async function bulkMoveReferences(ids, folderId) {
  return request(`/brands/1/references/bulk-move`, {
    method: 'POST',
    body: JSON.stringify({ ids, folder_id: folderId })
  })
}

export async function bulkDeleteReferences(ids) {
  return request(`/brands/1/references/bulk-delete`, {
    method: 'POST',
    body: JSON.stringify({ ids })
  })
}

// ========== Files ==========

export async function fetchReferenceFile(refId) {
  return request(`/files/references/${refId}`)
}

export async function fetchReferenceText(refId) {
  return request(`/files/references/${refId}/text`)
}

// ========== Facts ==========

export async function fetchFacts(brandId, refId) {
  return request(`/brands/${brandId}/references/${refId}/facts`)
}

export async function triggerFactExtraction(refId) {
  return request(`/references/${refId}/facts/extract`, { method: 'POST' })
}

export async function fetchFactsSummary(brandId) {
  const data = await request(`/brands/${brandId}/facts/summary`)
  return data.references
}

export async function updateFactFeedback(factId, { reference_id, decision }) {
  return request(`/facts/${factId}/feedback`, {
    method: 'PATCH',
    body: JSON.stringify({ reference_id, decision })
  })
}

// ========== Feedback ==========

export async function createFeedback({ claim_id, document_id, reference_doc_id, decision, reason, confidence_score }) {
  return request('/feedback', {
    method: 'POST',
    body: JSON.stringify({ claim_id, document_id, reference_doc_id, decision, reason, confidence_score })
  })
}

export async function fetchFeedback({ claim_id, document_id }) {
  const params = new URLSearchParams()
  if (claim_id) params.set('claim_id', claim_id)
  if (document_id) params.set('document_id', document_id)
  const data = await request(`/feedback?${params}`)
  return data.feedback
}

export async function updateFeedback(id, { decision, reason, reviewer_notes }) {
  return request(`/feedback/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ decision, reason, reviewer_notes })
  })
}
