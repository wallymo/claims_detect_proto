const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

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

// ========== References ==========

export async function fetchReferences(brandId) {
  const data = await request(`/brands/${brandId}/references`)
  return data.references
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

export async function fetchTrash(brandId) {
  const data = await request(`/brands/${brandId}/references/trash`)
  return data.references
}

export async function restoreReferences(brandId, ids) {
  return request(`/brands/${brandId}/references/restore`, {
    method: 'POST',
    body: JSON.stringify({ ids })
  })
}

export async function permanentDeleteReferences(brandId, ids) {
  return request(`/brands/${brandId}/references/permanent`, {
    method: 'DELETE',
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

export async function fetchReferenceMarkers(refId) {
  return request(`/files/references/${refId}/markers`)
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

// ========== Fact Search ==========

export async function searchFacts(brandId, claimText) {
  return request(`/brands/${brandId}/facts/search`, {
    method: 'POST',
    body: JSON.stringify({ claim_text: claimText })
  })
}

// ========== Passages (Semantic Search) ==========

export async function searchPassages(brandId, claimText, topK = 5, options = {}) {
  const body = { claim_text: claimText, top_k: topK }
  if (Number.isFinite(options.candidatePool) && options.candidatePool > 0) {
    body.candidate_pool = options.candidatePool
  }

  return request(`/brands/${brandId}/passages/search`, {
    method: 'POST',
    body: JSON.stringify(body)
  })
}

// ========== Matching Jobs (Server-Side Async Matching) ==========

export async function startReferenceMatchingJob(brandId, { claims, references, options } = {}) {
  return request(`/brands/${brandId}/matching-jobs`, {
    method: 'POST',
    body: JSON.stringify({ claims, references, options })
  })
}

export async function getReferenceMatchingJob(jobId) {
  return request(`/matching-jobs/${jobId}`)
}

export async function cancelReferenceMatchingJob(jobId) {
  return request(`/matching-jobs/${jobId}`, {
    method: 'DELETE'
  })
}

export function createReferenceMatchingJobEventSource(jobId) {
  const normalizedJobId = encodeURIComponent(String(jobId || '').trim())
  return new EventSource(`${API_BASE}/matching-jobs/${normalizedJobId}/events`)
}

// ========== Persistent Analysis Cache ==========

export async function getAnalysisCache(key) {
  const data = await request(`/analysis-cache?key=${encodeURIComponent(key)}`)
  return data.cache || null
}

export async function upsertAnalysisCache({ key, meta, payload }) {
  return request('/analysis-cache', {
    method: 'POST',
    body: JSON.stringify({ key, meta, payload })
  })
}

// ========== Analysis Runs ==========

export async function createAnalysisRun(data) {
  return request('/analysis-runs', {
    method: 'POST',
    body: JSON.stringify(data)
  })
}

export async function getAnalysisRunsByDocument(documentName, brandId) {
  const params = new URLSearchParams({ document_name: documentName })
  if (brandId) params.set('brand_id', brandId)
  return request(`/analysis-runs/by-document?${params}`)
}

export async function getRecentAnalysisRuns(limit = 20) {
  return request(`/analysis-runs?limit=${limit}`)
}

// ========== Annotation Versions ==========

export async function saveAnnotationVersion({ document_hash, brand_id, document_name, annotations_json, source, parent_version_id }) {
  return request('/versions', {
    method: 'POST',
    body: JSON.stringify({ document_hash, brand_id, document_name, annotations_json, source, parent_version_id })
  })
}

export async function listVersionsByBrand(brandId) {
  const data = await request(`/versions/brand/${brandId}`)
  return data.versions || []
}

export async function getLatestVersion(documentHash, brandId) {
  const params = brandId ? `?brand_id=${brandId}` : ''
  const data = await request(`/versions/${encodeURIComponent(documentHash)}/latest${params}`)
  return data.version || null
}

export async function listVersions(documentHash, brandId) {
  const params = brandId ? `?brand_id=${brandId}` : ''
  const data = await request(`/versions/${encodeURIComponent(documentHash)}${params}`)
  return data.versions || []
}

export async function getVersionByNumber(documentHash, versionNumber, brandId) {
  const params = brandId ? `?brand_id=${brandId}` : ''
  const data = await request(`/versions/${encodeURIComponent(documentHash)}/${versionNumber}${params}`)
  return data.version || null
}

export async function deleteVersionsByHash(documentHash) {
  return request(`/versions/${encodeURIComponent(documentHash)}`, { method: 'DELETE' })
}

export async function deleteAnalysisCacheEntry(key) {
  return request(`/analysis-cache?key=${encodeURIComponent(key)}`, {
    method: 'DELETE'
  })
}

export async function pruneAnalysisCache(maxRows) {
  return request('/analysis-cache/prune', {
    method: 'POST',
    body: JSON.stringify(Number.isFinite(maxRows) ? { max_rows: maxRows } : {})
  })
}

// ========== Brand Patterns ==========

export async function recordBrandPattern({ brand_id, pattern_type, pattern_json, strength_delta }) {
  return request('/brand-patterns', {
    method: 'POST',
    body: JSON.stringify({ brand_id, pattern_type, pattern_json, strength_delta })
  })
}

export async function getBrandPatterns(brandId, minStrength = 1) {
  const data = await request(`/brand-patterns/${brandId}?min_strength=${minStrength}`)
  return data.patterns || []
}

export async function deleteBrandPattern(id) {
  return request(`/brand-patterns/${id}`, { method: 'DELETE' })
}

export async function clearBrandPatterns(brandId) {
  return request(`/brand-patterns/brand/${brandId}`, { method: 'DELETE' })
}

// ========== PyMuPDF Extraction ==========

export async function extractWithPyMuPDF(file, brandId) {
  const formData = new FormData()
  formData.append('pdf', file)
  if (brandId != null) formData.append('brandId', String(brandId))
  return request('/pymupdf-extract', {
    method: 'POST',
    body: formData
  })
}

export async function exportMlrAnnotations({ file, claims, documentName, brandId, documentHash }) {
  const formData = new FormData()
  formData.append('pdf', file)
  formData.append('claims_json', JSON.stringify(Array.isArray(claims) ? claims : []))

  if (documentName) formData.append('document_name', documentName)
  if (brandId != null) formData.append('brand_id', String(brandId))
  if (documentHash) formData.append('document_hash', documentHash)

  return request('/exports/mlr', {
    method: 'POST',
    body: formData
  })
}

// ========== Document Lineage ==========

export async function createDocumentLineage({ document_hash, parent_hash, brand_id, similarity_score }) {
  return request('/document-lineage', {
    method: 'POST',
    body: JSON.stringify({ document_hash, parent_hash, brand_id, similarity_score })
  })
}

export async function getDocumentLineage(documentHash) {
  const data = await request(`/document-lineage/${encodeURIComponent(documentHash)}`)
  return data.lineage || null
}

export async function getDocumentParent(documentHash) {
  const data = await request(`/document-lineage/${encodeURIComponent(documentHash)}/parent`)
  return data.lineage || null
}

// ========== Feedback ==========

export async function createFeedback({ claim_id, document_id, reference_doc_id, decision, reason, confidence_score, rejection_type, corrected_reference_id }) {
  return request('/feedback', {
    method: 'POST',
    body: JSON.stringify({ claim_id, document_id, reference_doc_id, decision, reason, confidence_score, rejection_type, corrected_reference_id })
  })
}

// ========== Training Sessions ==========

export async function createTrainingSession({ brand_id, label, document_name, approved_claims, prompt_text }) {
  return request('/training-sessions', {
    method: 'POST',
    body: JSON.stringify({ brand_id, label, document_name, approved_claims, prompt_text })
  })
}

export async function updateTrainingSessionClaims(id, approved_claims) {
  return request(`/training-sessions/${id}/claims`, {
    method: 'PATCH',
    body: JSON.stringify({ approved_claims })
  })
}

export async function getTrainingSessions(brandId) {
  const data = await request(`/training-sessions?brand_id=${brandId}`)
  return data.sessions
}

export async function deleteTrainingSession(id) {
  return request(`/training-sessions/${id}`, { method: 'DELETE' })
}

export async function clearTrainingSessions(brandId) {
  return request('/training-sessions/clear', {
    method: 'POST',
    body: JSON.stringify({ brand_id: brandId })
  })
}

export async function exportTrainingSessions(brandId) {
  const url = `/api/training-sessions/export?brand_id=${brandId}`
  const a = document.createElement('a')
  a.href = url
  a.download = `training-data-brand-${brandId}.jsonl`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ========== Evidence Suggestions ==========

export async function generateEvidenceSuggestions({ claim_text, claim_id, reference_id }) {
  return request('/evidence/suggestions', {
    method: 'POST',
    body: JSON.stringify({ claim_text, claim_id, reference_id }),
  })
}

export async function fetchAcceptedEvidence(claimId, referenceId) {
  return request(`/evidence/accepted?claim_id=${encodeURIComponent(claimId)}&reference_id=${encodeURIComponent(referenceId)}`)
}

export async function fetchAcceptedEvidenceBatch(claimIds) {
  if (!Array.isArray(claimIds) || claimIds.length === 0) {
    return []
  }

  const data = await request('/evidence/accepted/batch', {
    method: 'POST',
    body: JSON.stringify({ claim_ids: claimIds }),
  })

  return data.evidence || []
}

export async function updateEvidenceSuggestionStatus(suggestionId, status) {
  return request(`/evidence/suggestions/${encodeURIComponent(suggestionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  })
}

export async function updateEvidenceSuggestionLocation(suggestionId, location_annotation) {
  return request(`/evidence/suggestions/${encodeURIComponent(suggestionId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ location_annotation }),
  })
}

export async function createManualEvidence({ claim_id, reference_id, page_number, rects, text }) {
  return request('/evidence/manual', {
    method: 'POST',
    body: JSON.stringify({ claim_id, reference_id, page_number, rects, text }),
  })
}

export async function clearEvidenceSuggestions(claimId, referenceId) {
  return request(`/evidence/suggestions?claim_id=${encodeURIComponent(claimId)}&reference_id=${encodeURIComponent(referenceId)}`, {
    method: 'DELETE',
  })
}

export async function deleteAcceptedEvidence(evidenceId) {
  return request(`/evidence/accepted/${encodeURIComponent(evidenceId)}`, {
    method: 'DELETE',
  })
}

export async function updateAcceptedEvidenceLocation(evidenceId, location_annotation) {
  return request(`/evidence/accepted/${encodeURIComponent(evidenceId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ location_annotation }),
  })
}
