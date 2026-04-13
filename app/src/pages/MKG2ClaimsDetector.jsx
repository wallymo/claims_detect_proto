import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import '../App.css'
import './MKGClaimsDetector.css'
import 'pdfjs-dist/web/pdf_viewer.css'

// Atoms/Molecules
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import Spinner from '@/components/atoms/Spinner/Spinner'
import Badge from '@/components/atoms/Badge/Badge'
import AccordionItem from '@/components/molecules/AccordionItem/AccordionItem'
import Input from '@/components/atoms/Input/Input'
import DropdownMenu from '@/components/molecules/DropdownMenu/DropdownMenu'
import { ThemeToggle } from '@/components/theme'

// MKG Components
import PDFViewer from '@/components/mkg/PDFViewer'
import MKGClaimCard from '@/components/mkg/MKGClaimCard'
import DocumentTypeSelector from '@/components/claims-detector/DocumentTypeSelector'
import LibraryTab from '@/components/claims-detector/LibraryTab'
import TrainingDataOverlay from '@/components/mkg/TrainingDataOverlay/TrainingDataOverlay'
import TrainingStatusBanner from '@/components/mkg/TrainingStatusBanner/TrainingStatusBanner'
import MissedClaimForm from '@/components/mkg/MissedClaimForm/MissedClaimForm'
import Alert from '@/components/molecules/Alert/Alert'

// Services
import { analyzeDocument as analyzeWithGemini, checkGeminiConnection, ALL_CLAIMS_PROMPT_USER, MEDICATION_PROMPT_USER, getDocTypeInstructions, GEMINI_MODEL, MODEL_DISPLAY_NAMES } from '@/services/gemini'
import { getMatchingStats } from '@/services/referenceMatching'
import * as api from '@/services/api'

// Utils
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl
import { enrichClaimsWithPositions, alignClaimsToSlideLayout, addGlobalIndices } from '@/utils/textMatcher'
import { dedupeClaimsByPageAndText, getClaimDedupOptions } from '@/utils/claimDedup'
import { logger } from '@/utils/logger'

const ACTIVE_MODEL_LABEL = MODEL_DISPLAY_NAMES[GEMINI_MODEL] || GEMINI_MODEL
const CLAIM_DEDUP_OPTIONS = getClaimDedupOptions()

const PROMPT_OPTIONS = [
  { id: 'all-claims', label: 'All Claims', promptKey: 'all' },
  { id: 'disease-state', label: 'Disease State', promptKey: 'disease' },
  { id: 'medication', label: 'Medication', promptKey: 'drug' }
]

const PROMPT_DISPLAY_TEXT = {
  'all': ALL_CLAIMS_PROMPT_USER,
  'disease': ALL_CLAIMS_PROMPT_USER,
  'drug': MEDICATION_PROMPT_USER
}

// ===== Analysis Result Cache =====

const ANALYSIS_CACHE_NS = 'claims_analysis_v3'
const ANALYSIS_CACHE_VERSION = String(import.meta.env.VITE_ANALYSIS_CACHE_VERSION || '2026-04-03-facts-v2').trim() || '2026-04-03-facts-v2'
const ANALYSIS_BROWSER_CACHE_NS = `${ANALYSIS_CACHE_NS}:browser`

function parseBooleanEnvFlag(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function parsePositiveIntEnv(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const PERSISTENT_ANALYSIS_CACHE_ENABLED = parseBooleanEnvFlag(
  import.meta.env.VITE_PERSISTENT_ANALYSIS_CACHE_ENABLED,
  true
)
const ANALYSIS_CACHE_STORE_DIAGNOSTICS = parseBooleanEnvFlag(
  import.meta.env.VITE_ANALYSIS_CACHE_STORE_DIAGNOSTICS,
  false
)

const fileShaPromiseCache = new WeakMap()
const analysisCacheMetaByKey = new Map()

function stableStringHash(value) {
  const source = String(value || '')
  let h = 0
  for (let i = 0; i < source.length; i += 1) {
    h = (Math.imul(31, h) + source.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function makeReferenceFingerprint(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return 'norefs'
  return [...refs]
    .map((ref) => {
      const id = Number.isFinite(Number(ref?.id)) ? Number(ref.id) : ''
      const factsCount = Number.isFinite(Number(ref?.facts_count)) ? Number(ref.facts_count) : 0
      const extractionStatus = String(ref?.extraction_status || '')
      return `${id}:${factsCount}:${extractionStatus}`
    })
    .sort()
    .join(',')
}

function rememberAnalysisCacheDescriptor(descriptor) {
  analysisCacheMetaByKey.set(descriptor.key, descriptor)
  if (analysisCacheMetaByKey.size <= 300) return
  const oldest = analysisCacheMetaByKey.keys().next().value
  if (oldest) analysisCacheMetaByKey.delete(oldest)
}

function getAnalysisCacheDescriptor(key) {
  return analysisCacheMetaByKey.get(key) || null
}

function readBrowserAnalysisCache(key) {
  if (!key) return null
  try {
    return JSON.parse(localStorage.getItem(`${ANALYSIS_BROWSER_CACHE_NS}|${key}`) || 'null')
  } catch {
    return null
  }
}

function writeBrowserAnalysisCache(key, payload) {
  if (!key) return
  try {
    localStorage.setItem(`${ANALYSIS_BROWSER_CACHE_NS}|${key}`, JSON.stringify(payload))
  } catch {
    /* quota */
  }
}

function deleteBrowserAnalysisCache(key) {
  if (!key) return
  try { localStorage.removeItem(`${ANALYSIS_BROWSER_CACHE_NS}|${key}`) } catch { /* ignore */ }
}

function normalizePayloadClaims(claims) {
  const normalized = Array.isArray(claims) ? claims : []
  if (ANALYSIS_CACHE_STORE_DIAGNOSTICS) return normalized
  return normalized.map((claim) => {
    if (!claim || typeof claim !== 'object') return claim
    const next = { ...claim }
    delete next.diagnostics
    return next
  })
}

function buildAnalysisCachePayload(claims, extras = {}, existing = null) {
  const base = existing && typeof existing === 'object' ? existing : {}
  const payload = {
    ts: Date.now(),
    cacheVersion: ANALYSIS_CACHE_VERSION,
    claims: normalizePayloadClaims(claims),
    analysisMs: Number.isFinite(extras.analysisMs) ? extras.analysisMs : base.analysisMs,
    usage: extras.usage !== undefined ? extras.usage : base.usage,
    matchingStats: extras.matchingStats !== undefined ? extras.matchingStats : base.matchingStats
  }

  if (ANALYSIS_CACHE_STORE_DIAGNOSTICS && extras.diagnostics !== undefined) {
    payload.diagnostics = extras.diagnostics
  }
  return payload
}

async function sha256Hex(input) {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return `fallback_${stableStringHash(input)}`
  }
  const enc = new TextEncoder()
  const bytes = typeof input === 'string' ? enc.encode(input) : input
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function getFileSha256(file) {
  if (!file) return ''
  if (fileShaPromiseCache.has(file)) return fileShaPromiseCache.get(file)

  const promise = (async () => {
    try {
      const buffer = await file.arrayBuffer()
      return await sha256Hex(buffer)
    } catch {
      return `fallback_${stableStringHash(`${file.name}|${file.size}|${file.lastModified}`)}`
    }
  })()

  fileShaPromiseCache.set(file, promise)
  return promise
}

async function makeAnalysisCacheDescriptor(file, model, promptKey, editablePrompt, docType, brandId, refs) {
  const fileSha = await getFileSha256(file)
  const promptHash = stableStringHash(editablePrompt)
  const referencesFingerprint = makeReferenceFingerprint(refs)
  const normalizedDocType = docType || 'speaker-notes'
  const normalizedBrandId = Number.isFinite(Number(brandId)) ? Number(brandId) : null

  const key = [
    ANALYSIS_CACHE_NS,
    ANALYSIS_CACHE_VERSION,
    fileSha,
    model,
    promptKey,
    normalizedDocType,
    normalizedBrandId || '',
    promptHash,
    referencesFingerprint
  ].join('|')

  const descriptor = {
    key,
    meta: {
      cache_version: ANALYSIS_CACHE_VERSION,
      brand_id: normalizedBrandId,
      file_sha256: fileSha,
      model,
      prompt_key: promptKey,
      prompt_hash: promptHash,
      doc_type: normalizedDocType,
      reference_fingerprint: referencesFingerprint,
      diagnostics_enabled: ANALYSIS_CACHE_STORE_DIAGNOSTICS
    }
  }
  rememberAnalysisCacheDescriptor(descriptor)
  return descriptor
}

async function readAnalysisCache(key) {
  if (!key) return null
  const localPayload = readBrowserAnalysisCache(key)
  if (!PERSISTENT_ANALYSIS_CACHE_ENABLED) return localPayload

  try {
    const cache = await api.getAnalysisCache(key)
    if (cache?.payload) {
      const payload = cache.payload
      if (!payload.ts) {
        const fallbackTs = cache.updated_at || cache.created_at
        payload.ts = fallbackTs ? new Date(fallbackTs).getTime() : Date.now()
      }
      writeBrowserAnalysisCache(key, payload)
      return payload
    }
  } catch (err) {
    logger.warn('Persistent analysis cache read failed, falling back to browser cache:', err.message)
  }

  return localPayload
}

function writeAnalysisCache(key, claims, extras = {}) {
  if (!key) return
  const existing = readBrowserAnalysisCache(key) || null
  const payload = buildAnalysisCachePayload(claims, extras, existing)
  writeBrowserAnalysisCache(key, payload)

  if (!PERSISTENT_ANALYSIS_CACHE_ENABLED) return
  const descriptor = getAnalysisCacheDescriptor(key)
  if (!descriptor) return

  void api.upsertAnalysisCache({
    key,
    meta: descriptor.meta,
    payload
  }).catch((err) => {
    logger.warn('Persistent analysis cache write failed:', err.message)
  })
}

function deleteAnalysisCache(key) {
  if (!key) return
  deleteBrowserAnalysisCache(key)
  if (!PERSISTENT_ANALYSIS_CACHE_ENABLED) return
  void api.deleteAnalysisCacheEntry(key).catch((err) => {
    logger.warn('Persistent analysis cache delete failed:', err.message)
  })
}

function formatTimeAgo(ts) {
  const d = Date.now() - ts
  if (d < 60000) return 'just now'
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  return `${Math.floor(d / 3600000)}h ago`
}

function formatMinutes(ms) {
  return `${(ms / 60000).toFixed(2)} min`
}

function hasMatchingMetadata(claims) {
  return claims.some((claim) => (
    claim
    && (
      Object.prototype.hasOwnProperty.call(claim, 'matched')
      || Object.prototype.hasOwnProperty.call(claim, 'matchConfidence')
      || Object.prototype.hasOwnProperty.call(claim, 'matchTier')
      || !!claim.reference
    )
  ))
}

function normalizeTrainingDocumentKey(documentName) {
  return String(documentName || '').trim().toLowerCase()
}

function normalizeTrainingClaimText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function dedupeTrainingClaims(claims) {
  const seen = new Set()
  const deduped = []
  for (const claim of Array.isArray(claims) ? claims : []) {
    const key = normalizeTrainingClaimText(claim?.text)
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(claim)
  }
  return deduped
}

function toTrainingDocumentRecord(session) {
  const documentName = session?.document_name || session?.label || `Document ${session?.id || 'unknown'}`
  const documentKey = normalizeTrainingDocumentKey(documentName) || `__doc_${session?.id || Date.now()}`
  return {
    ...session,
    label: session?.label || documentName,
    document_name: documentName,
    document_key: documentKey,
    source_session_ids: [session?.id].filter(Boolean),
    approved_claims: dedupeTrainingClaims(session?.approved_claims || [])
  }
}

function mergeTrainingSessionsByDocument(sessions) {
  const grouped = new Map()
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const record = toTrainingDocumentRecord(session)
    const existing = grouped.get(record.document_key)
    if (!existing) {
      grouped.set(record.document_key, record)
      continue
    }

    grouped.set(record.document_key, {
      ...existing,
      source_session_ids: [...new Set([...(existing.source_session_ids || []), ...(record.source_session_ids || [])])],
      approved_claims: dedupeTrainingClaims([...(existing.approved_claims || []), ...(record.approved_claims || [])]),
      prompt_text: existing.prompt_text || record.prompt_text || null
    })
  }

  return [...grouped.values()].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  )
}

// ===== Fact Inventory =====

const FACT_INVENTORY_MAX_CHARS = 18000
const FACT_INVENTORY_FACT_TEXT_MAX_CHARS = 260
const FACT_INVENTORY_HEADER = '\n\nREFERENCE FACT INVENTORY (background context only; do NOT limit extraction to these facts):\n'

function normalizeFactText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  if (normalized.length <= FACT_INVENTORY_FACT_TEXT_MAX_CHARS) return normalized
  return `${normalized.slice(0, FACT_INVENTORY_FACT_TEXT_MAX_CHARS - 3).trimEnd()}...`
}

const MATCHED_CLAIM_FIELDS = ['matched', 'matchConfidence', 'matchTier', 'reference', 'matchReasoning']
const MATCHING_TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const MATCHING_JOB_POLL_INTERVAL_MS = Math.max(
  400,
  Number.parseInt(import.meta.env.VITE_MATCHING_JOB_POLL_INTERVAL_MS || '1000', 10) || 1000
)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function mergeMatchFields(existingClaim, matchedClaim) {
  if (!matchedClaim) return existingClaim

  let changed = false
  const merged = { ...existingClaim }

  for (const field of MATCHED_CLAIM_FIELDS) {
    if (merged[field] !== matchedClaim[field]) {
      merged[field] = matchedClaim[field]
      changed = true
    }
  }

  return changed ? merged : existingClaim
}

export default function MKG2ClaimsDetector() {
  // Document state
  const [uploadedFile, setUploadedFile] = useState(null)
  const [uploadState, setUploadState] = useState('empty')
  const fileInputRef = useRef(null)

  // Settings state
  const selectedModel = GEMINI_MODEL
  const [selectedPrompt, _setSelectedPrompt] = useState('all-claims')
  const [editablePrompt, setEditablePrompt] = useState('')
  const [isEditingPrompt, setIsEditingPrompt] = useState(false)
  const [selectedDocType, setSelectedDocType] = useState('speaker-notes')
  // AI Discovery always on — show all claims, over-flag rather than miss

  // Brand state
  const [brands, setBrands] = useState([])
  const [selectedBrandId, setSelectedBrandId] = useState(null)
  const [libraryBrandId, setLibraryBrandId] = useState(null) // "MKG Reference Library" — shared ref pool
  const [showNewBrandModal, setShowNewBrandModal] = useState(false)
  const [newBrandName, setNewBrandName] = useState('')
  const [newBrandClient, setNewBrandClient] = useState('')
  const [isCreatingBrand, setIsCreatingBrand] = useState(false)
  const [brandModalFiles, setBrandModalFiles] = useState([]) // { file, name, size, status }
  const [brandCreateStep, setBrandCreateStep] = useState(null) // null | 'creating' | 'uploading' | 'done'
  const [brandUploadIndex, setBrandUploadIndex] = useState(0)
  const brandFileInputRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)

  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisComplete, setAnalysisComplete] = useState(false)
  const [analysisError, setAnalysisError] = useState(null)
  const [processingTime, setProcessingTime] = useState(0)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [analysisStatus, setAnalysisStatus] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Reference matching state
  const [isMatching, setIsMatching] = useState(false)
  const [_matchingComplete, setMatchingComplete] = useState(false)
  const [matchingProgress, setMatchingProgress] = useState('')
  const [matchingStats, setMatchingStats] = useState(null)

  // Cache state
  const [cacheHit, setCacheHit] = useState(null)  // { ts: number } | null
  const [hasCachedResult, setHasCachedResult] = useState(false)
  const currentCacheKeyRef = useRef(null)
  const cancelAnalysisRef = useRef(false)
  const matchingJobIdRef = useRef(null)
  const matchingCancelRequestedRef = useRef(false)
  const matchingEventSourceRef = useRef(null)

  // Claims state
  const [claims, setClaims] = useState([])
  const [activeClaimId, setActiveClaimId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState('annotation')
  const [collapsedPages, setCollapsedPages] = useState({})
  const [showClaimPins, setShowClaimPins] = useState(true)
  const [isConfigPanelCollapsed, setIsConfigPanelCollapsed] = useState(false)

  // Missed claim reporting state
  const [missedClaims, setMissedClaims] = useState([])
  const [selectionMode, setSelectionMode] = useState(false)
  const [pendingPinPosition, setPendingPinPosition] = useState(null) // { x, y, page }
  const [missedClaimToast, setMissedClaimToast] = useState(false)
  const [textSelectionMode, setTextSelectionMode] = useState(false)
  const [pendingSupportingText, setPendingSupportingText] = useState('')

  // Combine real missed claims with pending pin so ClaimPinsOverlay renders it immediately
  const displayMissedClaims = useMemo(() => {
    if (!pendingPinPosition) return missedClaims
    return [
      ...missedClaims,
      {
        id: 'pending-missed-claim',
        position: { x: pendingPinPosition.x, y: pendingPinPosition.y },
        page: pendingPinPosition.page,
        status: 'pending'
      }
    ]
  }, [missedClaims, pendingPinPosition])

  // Cost tracking
  const [lastUsage, setLastUsage] = useState(null)
  const [totalCost, setTotalCost] = useState(0)
  const [sessionCost, setSessionCost] = useState(0)

  // Text extraction
  const [extractedPages, setExtractedPages] = useState([])

  // Library state
  const [referenceDocuments, setReferenceDocuments] = useState([])
  const [trashDocuments, setTrashDocuments] = useState([])
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false)
  const [isUploadingRef, setIsUploadingRef] = useState(false)

  // Folder state
  const [folders, setFolders] = useState([])
  const [activeFolderId, setActiveFolderId] = useState(null)

  // Right panel tab: 0 = Claims, 1 = Library
  const [rightPanelTab, setRightPanelTab] = useState(0)

  // Reference viewer overlay
  const [referenceViewerData, setReferenceViewerData] = useState(null)

  // Training data state
  const [trainingDocuments, setTrainingDocuments] = useState([])
  const [ecosystemTrainingExamples, setEcosystemTrainingExamples] = useState([])
  const [showTrainingOverlay, setShowTrainingOverlay] = useState(false)

  const claimsListRef = useRef(null)
  const claimsPanelRef = useRef(null)

  const trainingExamples = useMemo(() => {
    const currentDocumentKey = normalizeTrainingDocumentKey(uploadedFile?.name)
    const currentDocumentClaims = currentDocumentKey
      ? (trainingDocuments.find(doc => doc.document_key === currentDocumentKey)?.approved_claims || [])
      : []

    const brandClaims = trainingDocuments
      .filter(doc => doc.document_key !== currentDocumentKey)
      .flatMap(doc => doc.approved_claims || [])

    return dedupeTrainingClaims([
      ...currentDocumentClaims,
      ...brandClaims,
      ...ecosystemTrainingExamples
    ]).slice(0, 20)
  }, [uploadedFile, trainingDocuments, ecosystemTrainingExamples])

  const ecosystemTrainingBrandCount = useMemo(
    () => new Set(
      ecosystemTrainingExamples
        .map(example => example.source_brand_id)
        .filter(Boolean)
    ).size,
    [ecosystemTrainingExamples]
  )

  const promptInjectionText = useMemo(() => {
    if (!Array.isArray(trainingExamples) || trainingExamples.length === 0) return ''
    const approved = trainingExamples.filter(c => c?.type !== 'MissedClaim' && c?.type !== 'FalsePositive')
    const missed = trainingExamples.filter(c => c?.type === 'MissedClaim')
    const falsePositives = trainingExamples.filter(c => c?.type === 'FalsePositive')
    const blocks = []
    if (approved.length > 0) {
      blocks.push('PRIOR APPROVED EXAMPLES (detect claims like these):\n' + approved.map(c => '- "' + c.text + '"').join('\n'))
    }
    if (missed.length > 0) {
      blocks.push('PREVIOUSLY MISSED CLAIMS (you MUST detect these patterns):\n' + missed.map(c => '- "' + c.text + '"').join('\n'))
    }
    if (falsePositives.length > 0) {
      blocks.push('FALSE POSITIVE PATTERNS (do NOT flag these):\n' + falsePositives.map(c => '- "' + c.text + '"').join('\n'))
    }
    return blocks.join('\n\n')
  }, [trainingExamples])

  const trainingDocumentCount = useMemo(() => trainingDocuments.length, [trainingDocuments])

  const cancelActiveMatchingJob = useCallback(async () => {
    if (matchingEventSourceRef.current) {
      matchingEventSourceRef.current.close()
      matchingEventSourceRef.current = null
    }

    const jobId = matchingJobIdRef.current
    if (!jobId) return

    try {
      await api.cancelReferenceMatchingJob(jobId)
    } catch (err) {
      logger.warn(`Could not cancel matching job ${jobId}:`, err.message)
    }
  }, [])

  // Load brands, references, and folders on mount
  useEffect(() => {
    loadBrands()
    loadFolders()
  }, [])

  // Reload references when brand changes — always load from shared MKG Reference Library
  useEffect(() => {
    if (selectedBrandId && libraryBrandId) {
      loadBrandReferences(libraryBrandId)
    } else {
      setReferenceDocuments([])
    }
  }, [selectedBrandId, libraryBrandId])

  // Load training examples for active brand + ecosystem (other brands)
  useEffect(() => {
    if (!selectedBrandId) {
      setTrainingDocuments([])
      setEcosystemTrainingExamples([])
      return
    }

    let cancelled = false
    const loadTrainingData = async () => {
      try {
        const sessions = await api.getTrainingSessions(selectedBrandId)
        if (!cancelled) {
          setTrainingDocuments(mergeTrainingSessionsByDocument(sessions))
        }
      } catch (err) {
        if (!cancelled) {
          logger.warn('Could not load training documents:', err.message)
        }
      }

      try {
        const otherBrands = brands.filter(brand => brand.id !== selectedBrandId)
        if (otherBrands.length === 0) {
          if (!cancelled) setEcosystemTrainingExamples([])
          return
        }

        const settled = await Promise.allSettled(
          otherBrands.map(async (brand) => {
            const sessions = await api.getTrainingSessions(brand.id)
            const docs = mergeTrainingSessionsByDocument(sessions)
            return docs
              .flatMap(doc => doc.approved_claims || [])
              .map(example => ({ ...example, source_brand_id: brand.id }))
          })
        )

        if (cancelled) return

        const merged = settled
          .filter(result => result.status === 'fulfilled')
          .flatMap(result => result.value)

        setEcosystemTrainingExamples(dedupeTrainingClaims(merged))
      } catch (err) {
        if (!cancelled) {
          logger.warn('Could not load ecosystem training examples:', err.message)
          setEcosystemTrainingExamples([])
        }
      }
    }

    loadTrainingData()
    return () => {
      cancelled = true
    }
  }, [selectedBrandId, brands])

  // Load total cost from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('gemini_total_cost')
    if (saved) setTotalCost(parseFloat(saved))
  }, [])

  // Sync editable prompt — includes doc-type-specific structure + position rules
  useEffect(() => {
    const promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
    const basePrompt = PROMPT_DISPLAY_TEXT[promptKey] || PROMPT_DISPLAY_TEXT['all']
    const { structure, position } = getDocTypeInstructions(selectedDocType || 'speaker-notes')
    setEditablePrompt(structure.trim() + '\n\n' + basePrompt + '\n' + position.trim())
    setIsEditingPrompt(false)
  }, [selectedPrompt, selectedDocType])

  // Track elapsed time during analysis
  useEffect(() => {
    if (!isAnalyzing && !isMatching) {
      setElapsedSeconds(0)
      return
    }
    const interval = setInterval(() => {
      setElapsedSeconds(prev => prev + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [isAnalyzing, isMatching])

  useEffect(() => {
    return () => {
      matchingCancelRequestedRef.current = true
      void cancelActiveMatchingJob()
    }
  }, [cancelActiveMatchingJob])

  // Ensure claims have global indices
  useEffect(() => {
    setClaims(prev => {
      if (!prev.length) return prev
      const missing = prev.some(c => !c.globalIndex)
      if (!missing) return prev
      return addGlobalIndices(prev)
    })
  }, [])

  // Last-line safety net: if any code path reintroduces duplicate claims,
  // collapse them before rendering pins/cards.
  useEffect(() => {
    if (!claims.length) return

    const deduped = dedupeClaimsByPageAndText(claims, CLAIM_DEDUP_OPTIONS)
    if (deduped.duplicateCount === 0) return

    const indexedClaims = addGlobalIndices(deduped.claims)
    logger.info({
      event: 'mkg2_claim_dedupe_guard',
      duplicates_removed: deduped.duplicateCount,
      exact_duplicates_removed: deduped.exactDuplicateCount,
      near_duplicates_removed: deduped.nearDuplicateCount,
      unique_claims: deduped.uniqueCount,
      original_claims: claims.length
    })

    if (activeClaimId && !indexedClaims.some(c => c.id === activeClaimId)) {
      setActiveClaimId(indexedClaims[0]?.id || null)
    }
    setClaims(indexedClaims)
    if (currentCacheKeyRef.current) {
      writeAnalysisCache(currentCacheKeyRef.current, indexedClaims)
    }
  }, [claims, activeClaimId])

  // ===== Data Loading =====

  async function loadBrands() {
    try {
      const allBrands = await api.fetchBrands()
      // Filter out the shared reference hub — it's not a selectable brand
      const selectableBrands = allBrands.filter(b => b.name !== 'MKG Reference Library')
      // Stash the shared library brand ID so we can load its references for any selected brand
      const libraryBrand = allBrands.find(b => b.name === 'MKG Reference Library')
      if (libraryBrand) setLibraryBrandId(libraryBrand.id)
      // Enforce display order: Annexon, XCOPRI, then any user-created brands
      const ORDER = ['Annexon', 'XCOPRI']
      selectableBrands.sort((a, b) => {
        const ai = ORDER.indexOf(a.name)
        const bi = ORDER.indexOf(b.name)
        if (ai !== -1 && bi !== -1) return ai - bi
        if (ai !== -1) return -1
        if (bi !== -1) return 1
        return a.name.localeCompare(b.name)
      })
      setBrands(selectableBrands)
    } catch (err) {
      logger.error('Failed to load brands:', err)
    }
  }

  async function loadBrandReferences(brandId) {
    setIsLoadingLibrary(true)
    try {
      const refs = await api.fetchReferences(brandId)
      setReferenceDocuments(refs.map(ref => ({
        id: ref.id,
        name: ref.display_alias,
        originalName: ref.filename
          ? ref.filename
              .replace(/^\d+_/, '')          // strip multer timestamp prefix
              .replace(/\.[^.]+$/, '')        // strip file extension
              .replace(/_/g, ' ')             // underscores to spaces
              .replace(/\b\w/g, c => c.toUpperCase()) // title case
          : ref.display_alias,
        size: formatFileSize(ref.file_size_bytes),
        uploadedAt: new Date(ref.upload_date).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric'
        }),
        doc_type: ref.doc_type,
        has_content: ref.has_content,
        page_count: ref.page_count,
        brand_id: ref.brand_id,
        folder_id: ref.folder_id || null,
        extraction_status: ref.extraction_status || null,
        facts_count: ref.facts_count || 0
      })))
      // Also load trash for the badge count
      try {
        const trashRefs = await api.fetchTrash(brandId)
        setTrashDocuments(trashRefs.map(ref => ({
          id: ref.id,
          name: ref.display_alias,
          originalName: ref.filename
            ? ref.filename
                .replace(/^\d+_/, '')
                .replace(/\.[^.]+$/, '')
                .replace(/_/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase())
            : ref.display_alias,
          size: formatFileSize(ref.file_size_bytes),
          uploadedAt: new Date(ref.upload_date).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
          }),
          deletedAt: ref.deleted_at,
          doc_type: ref.doc_type,
          has_content: ref.has_content,
          page_count: ref.page_count,
          brand_id: ref.brand_id,
          folder_id: ref.folder_id || null,
          extraction_status: ref.extraction_status || null,
          facts_count: ref.facts_count || 0
        })))
      } catch (err) {
        logger.warn('Failed to load trash:', err)
      }
    } catch (err) {
      logger.error('Failed to load references:', err)
    } finally {
      setIsLoadingLibrary(false)
    }
  }

  async function handleCreateBrand() {
    if (!newBrandName.trim()) return
    setIsCreatingBrand(true)
    setBrandCreateStep('creating')
    try {
      // Step 1: Create the brand
      const newBrand = await api.createBrand({ name: newBrandName.trim(), client: newBrandClient.trim() || newBrandName.trim() })
      const brandId = newBrand.id

      // Step 2: Upload queued files (if any)
      if (brandModalFiles.length > 0) {
        setBrandCreateStep('uploading')
        for (let i = 0; i < brandModalFiles.length; i++) {
          setBrandUploadIndex(i)
          setBrandModalFiles(prev => prev.map((f, idx) =>
            idx === i ? { ...f, status: 'uploading' } : f
          ))
          try {
            await api.uploadReference(brandId, brandModalFiles[i].file)
            setBrandModalFiles(prev => prev.map((f, idx) =>
              idx === i ? { ...f, status: 'done' } : f
            ))
          } catch (err) {
            logger.error(`Failed to upload ${brandModalFiles[i].name}:`, err)
            setBrandModalFiles(prev => prev.map((f, idx) =>
              idx === i ? { ...f, status: 'error' } : f
            ))
          }
        }
      }

      // Step 3: Reload brands and select the new one
      setBrandCreateStep('done')
      await loadBrands()
      setSelectedBrandId(brandId)

      // Close and reset
      setShowNewBrandModal(false)
      setNewBrandName('')
      setNewBrandClient('')
      setBrandModalFiles([])
      setBrandCreateStep(null)
      setBrandUploadIndex(0)
    } catch (err) {
      logger.error('Failed to create brand:', err)
      setBrandCreateStep(null)
    } finally {
      setIsCreatingBrand(false)
    }
  }

  // Brand modal file handlers
  function handleBrandModalFileSelect(e) {
    const files = Array.from(e.target.files || [])
    addFilesToBrandModal(files)
    e.target.value = ''
  }

  function addFilesToBrandModal(files) {
    const validFiles = files.filter(f =>
      f.type === 'application/pdf' ||
      f.name.endsWith('.docx') ||
      f.name.endsWith('.doc')
    )
    const newEntries = validFiles.map(f => ({
      file: f,
      name: f.name,
      size: f.size,
      status: 'queued'
    }))
    setBrandModalFiles(prev => [...prev, ...newEntries])
  }

  function removeBrandModalFile(index) {
    setBrandModalFiles(prev => prev.filter((_, i) => i !== index))
  }

  function handleBrandModalDrop(e) {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files || [])
    addFilesToBrandModal(files)
  }

  function closeBrandModal() {
    if (isCreatingBrand) return
    setShowNewBrandModal(false)
    setNewBrandName('')
    setNewBrandClient('')
    setBrandModalFiles([])
    setBrandCreateStep(null)
    setBrandUploadIndex(0)
    setIsDragging(false)
  }

  async function loadFolders() {
    try {
      const allFolders = await api.fetchFolders()
      setFolders(allFolders)
    } catch (err) {
      logger.error('Failed to load folders:', err)
    }
  }

  function formatFileSize(bytes) {
    if (!bytes && bytes !== 0) return '0 B'
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }

  // ===== File Upload =====

  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') {
      setAnalysisError('Please upload a PDF file')
      return
    }
    setUploadState('uploading')
    setAnalysisError(null)
    setTimeout(() => {
      setUploadedFile(file)
      setUploadState('complete')
      setAnalysisComplete(false)
      setMatchingComplete(false)
      setClaims([])
      setStatusFilter('all')
      setCollapsedPages({})
      setMatchingStats(null)
      setMissedClaims([])
      setSelectionMode(false)
      setPendingPinPosition(null)
    }, 500)
  }

  const handleUploadClick = () => fileInputRef.current?.click()

  const handleRemoveDocument = () => {
    cancelAnalysisRef.current = true
    matchingCancelRequestedRef.current = true
    void cancelActiveMatchingJob()
    matchingJobIdRef.current = null
    setUploadedFile(null)
    setUploadState('empty')
    setClaims([])
    setStatusFilter('all')
    setCollapsedPages({})
    setAnalysisComplete(false)
    setMatchingComplete(false)
    setAnalysisError(null)
    setMatchingStats(null)
    setMissedClaims([])
    setSelectionMode(false)
    setPendingPinPosition(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ===== Text Extraction =====

  const handleTextExtracted = useCallback((pages) => {
    setExtractedPages(pages)
  }, [])

  // ===== Prompt Editing =====

  const getDefaultPrompt = () => {
    const promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
    return PROMPT_DISPLAY_TEXT[promptKey] || PROMPT_DISPLAY_TEXT['all']
  }

  const handleCancelEdit = () => {
    setEditablePrompt(getDefaultPrompt())
    setIsEditingPrompt(false)
  }

  // ===== Analysis =====

  // Proactively check if current file+settings combo has a cached result
  useEffect(() => {
    let cancelled = false

    const checkCachedResult = async () => {
      if (!uploadedFile) {
        if (!cancelled) setHasCachedResult(false)
        return
      }

      try {
        const promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
        const descriptor = await makeAnalysisCacheDescriptor(
          uploadedFile,
          selectedModel,
          promptKey,
          editablePrompt,
          selectedDocType || 'speaker-notes',
          selectedBrandId,
          referenceDocuments
        )
        if (cancelled) return
        const cached = await readAnalysisCache(descriptor.key)
        if (!cancelled) setHasCachedResult(!!cached)
      } catch (err) {
        if (!cancelled) {
          logger.warn('Could not resolve analysis cache status:', err.message)
          setHasCachedResult(false)
        }
      }
    }

    void checkCachedResult()
    return () => {
      cancelled = true
    }
  }, [uploadedFile, selectedModel, selectedPrompt, editablePrompt, selectedDocType, selectedBrandId, referenceDocuments])

  const handleAnalyze = async () => {
    if (!uploadedFile) return
    cancelAnalysisRef.current = false
    matchingCancelRequestedRef.current = false
    matchingJobIdRef.current = null

    const _promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
    const cacheDescriptor = await makeAnalysisCacheDescriptor(
      uploadedFile,
      selectedModel,
      _promptKey,
      editablePrompt,
      selectedDocType || 'speaker-notes',
      selectedBrandId,
      referenceDocuments
    )
    const _cacheKey = cacheDescriptor.key
    currentCacheKeyRef.current = _cacheKey
    const _cached = await readAnalysisCache(_cacheKey)
    if (_cached) {
      const cachedClaims = Array.isArray(_cached.claims) ? _cached.claims : []
      const dedupedCached = dedupeClaimsByPageAndText(cachedClaims, CLAIM_DEDUP_OPTIONS)
      const indexedCachedClaims = addGlobalIndices(dedupedCached.claims)
      if (dedupedCached.duplicateCount > 0) {
        logger.info({
          event: 'mkg2_cached_claim_dedupe',
          duplicates_removed: dedupedCached.duplicateCount,
          exact_duplicates_removed: dedupedCached.exactDuplicateCount,
          near_duplicates_removed: dedupedCached.nearDuplicateCount,
          unique_claims: dedupedCached.uniqueCount,
          original_claims: cachedClaims.length
        })
        writeAnalysisCache(_cacheKey, indexedCachedClaims)
      }

      const restoredMatchingStats = _cached?.matchingStats && typeof _cached.matchingStats === 'object'
        ? _cached.matchingStats
        : (hasMatchingMetadata(indexedCachedClaims) ? getMatchingStats(indexedCachedClaims) : null)
      const hasCachedMatches = !!restoredMatchingStats || hasMatchingMetadata(indexedCachedClaims)
      const shouldRunMatchingFromCache = !hasCachedMatches && !!selectedBrandId && referenceDocuments.length > 0

      setClaims(indexedCachedClaims)
      setCacheHit({ ts: _cached.ts })
      setAnalysisComplete(true)
      setMatchingComplete(hasCachedMatches)
      setAnalysisProgress(100)
      setAnalysisStatus('Claims detected')
      setAnalysisError(null)
      setProcessingTime(Number.isFinite(_cached?.analysisMs) ? _cached.analysisMs : 0)
      setLastUsage(_cached?.usage || null)
      setMatchingStats(restoredMatchingStats)
      setIsMatching(false)
      setIsAnalyzing(false)

      if (shouldRunMatchingFromCache) {
        await runReferenceMatching(
          indexedCachedClaims,
          Number.isFinite(_cached?.analysisMs) ? _cached.analysisMs : null,
          _cached?.usage || null
        )
      }
      return
    }
    setCacheHit(null)

    setIsAnalyzing(true)
    setAnalysisComplete(false)
    setMatchingComplete(false)
    setAnalysisError(null)
    setAnalysisProgress(0)
    setAnalysisStatus('Analyzing document...')
    setMatchingStats(null)
    const analysisStartedAt = Date.now()

    try {
      const promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
      setAnalysisProgress(5)
      setAnalysisStatus('Analyzing document...')
      const connectionCheck = await checkGeminiConnection(selectedModel)
      if (!connectionCheck.connected) {
        throw new Error(`Gemini API not connected: ${connectionCheck.error}`)
      }
      if (cancelAnalysisRef.current) return

      // Fetch fact inventory for brand-grounded detection (POC2)
      let factInventory = ''
      const factBrandId = libraryBrandId || selectedBrandId
      if (factBrandId) {
        try {
          const factRefs = await api.fetchFactsSummary(factBrandId)
          const indexedRefs = factRefs.filter(r => r.extraction_status === 'indexed' && r.facts_count > 0)
          if (indexedRefs.length > 0) {
            const lines = []
            let totalChars = FACT_INVENTORY_HEADER.length
            let truncated = false
            let charLimitReached = false

            for (const ref of indexedRefs) {
              if (charLimitReached) {
                break
              }

              // Fetch all indexed facts until the prompt-size guardrail is hit.
              const factsData = await api.fetchFacts(factBrandId, ref.reference_id)
              if (cancelAnalysisRef.current) return
              const facts = Array.isArray(factsData.facts) ? factsData.facts : []

              for (const fact of facts) {
                const factText = normalizeFactText(fact.text)
                if (!factText) continue

                const category = String(fact.category || '').replace(/\s+/g, ' ').trim()
                const line = `- [${ref.display_alias}] ${factText}${category ? ` | ${category}` : ''}`

                if (totalChars + line.length + 1 > FACT_INVENTORY_MAX_CHARS) {
                  truncated = true
                  charLimitReached = true
                  break
                }

                lines.push(line)
                totalChars += line.length + 1
              }
            }

            if (lines.length > 0) {
              factInventory = `${FACT_INVENTORY_HEADER}${lines.join('\n')}`
              if (truncated) {
                factInventory += '\n- [context] Additional indexed facts were omitted to stay within prompt size limits. Treat this inventory as optional background only.'
              }
            }
            logger.info(
              `Loaded ${lines.length} fact lines from ${indexedRefs.length} indexed references (truncated=${truncated})`
            )
          }
        } catch (err) {
          logger.warn('Could not load fact inventory:', err.message)
        }
      }

      const progressCb = (progress, status) => {
        setAnalysisProgress(progress)
        setAnalysisStatus(status)
      }
      const result = await analyzeWithGemini(uploadedFile, progressCb, promptKey, editablePrompt, null, selectedDocType || 'speaker-notes', factInventory, trainingExamples, { modelOverride: selectedModel })

      if (cancelAnalysisRef.current) return
      if (!result.success) throw new Error(result.error || 'Analysis failed')

      // Process claims
      const rawDetectedClaims = Array.isArray(result.claims) ? result.claims : []
      const dedupedDetected = dedupeClaimsByPageAndText(rawDetectedClaims, CLAIM_DEDUP_OPTIONS)
      if (dedupedDetected.duplicateCount > 0) {
        logger.info({
          event: 'mkg2_detected_claim_dedupe',
          duplicates_removed: dedupedDetected.duplicateCount,
          exact_duplicates_removed: dedupedDetected.exactDuplicateCount,
          near_duplicates_removed: dedupedDetected.nearDuplicateCount,
          unique_claims: dedupedDetected.uniqueCount,
          original_claims: rawDetectedClaims.length,
          model: selectedModel
        })
      }

      const claimsNeedingPositions = dedupedDetected.claims.filter(c => !c.position)
      const claimsWithPositions = claimsNeedingPositions.length > 0 && extractedPages.length > 0
        ? enrichClaimsWithPositions(dedupedDetected.claims, extractedPages)
        : dedupedDetected.claims

      const indexedClaims = addGlobalIndices(claimsWithPositions)
      setClaims(indexedClaims)
      const analysisTotalMs = Date.now() - analysisStartedAt
      setProcessingTime(analysisTotalMs)

      // Track cost
      if (result.usage) {
        setLastUsage(result.usage)
        const runCost = result.usage.cost
        setSessionCost(prev => prev + runCost)
        const newTotal = totalCost + runCost
        setTotalCost(newTotal)
        localStorage.setItem('gemini_total_cost', newTotal.toString())
      }

      setAnalysisProgress(100)
      setAnalysisStatus('Claims detected')
      setAnalysisComplete(true)
      setIsAnalyzing(false)

      // Save analysis run for history tracking
      try {
        await api.createAnalysisRun({
          brand_id: selectedBrandId || null,
          document_name: uploadedFile.name,
          model: selectedModel,
          training_example_count: trainingExamples.length,
          ecosystem_example_count: ecosystemTrainingExamples.length,
          claim_count: indexedClaims.length,
          matched_count: 0,
          avg_confidence: indexedClaims.length > 0 ? indexedClaims.reduce((sum, c) => sum + (c.confidence || 0), 0) / indexedClaims.length : null
        })
      } catch (runErr) {
        logger.warn('Failed to save analysis run:', runErr.message)
      }

      logger.info({
        event: 'mkg2_analysis_summary',
        analysis_total_ms: analysisTotalMs,
        original_claims: rawDetectedClaims.length,
        duplicates_removed: dedupedDetected.duplicateCount,
        exact_duplicates_removed: dedupedDetected.exactDuplicateCount,
        near_duplicates_removed: dedupedDetected.nearDuplicateCount,
        total_claims: indexedClaims.length,
        model: selectedModel,
        doc_type: selectedDocType
      })

      // Step 2: Auto-trigger reference matching (or cache detection-only result)
      if (selectedBrandId && referenceDocuments.length > 0) {
        await runReferenceMatching(indexedClaims, analysisTotalMs, result.usage || null)
        if (cancelAnalysisRef.current) return
      } else {
        writeAnalysisCache(currentCacheKeyRef.current, indexedClaims, {
          analysisMs: analysisTotalMs,
          usage: result.usage || null,
          matchingStats: null
        })
        setHasCachedResult(true)
      }
    } catch (error) {
      logger.error('Analysis error:', error)
      setAnalysisError(error.message)
      setIsAnalyzing(false)
    }
  }

  const handleConfirmReanalyze = async () => {
    if (!uploadedFile) return

    // Compute the key fresh in case currentCacheKeyRef hasn't been set yet
    const _promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
    const descriptor = await makeAnalysisCacheDescriptor(
      uploadedFile,
      selectedModel,
      _promptKey,
      editablePrompt,
      selectedDocType || 'speaker-notes',
      selectedBrandId,
      referenceDocuments
    )
    deleteAnalysisCache(descriptor.key)
    if (currentCacheKeyRef.current) deleteAnalysisCache(currentCacheKeyRef.current)
    currentCacheKeyRef.current = null
    setCacheHit(null)
    setHasCachedResult(false)
    handleAnalyze()
  }

  const handleCancelAnalysis = () => {
    cancelAnalysisRef.current = true
    matchingCancelRequestedRef.current = true
    void cancelActiveMatchingJob()
    matchingJobIdRef.current = null
    setIsAnalyzing(false)
    setIsMatching(false)
    setAnalysisComplete(false)
    setMatchingComplete(false)
    setAnalysisProgress(0)
    setAnalysisStatus('Analyzing document...')
    setClaims([])
    setMatchingStats(null)
    setCacheHit(null)
    setMatchingProgress('')
  }

  const handleResetMatching = () => {
    if (currentCacheKeyRef.current) deleteAnalysisCache(currentCacheKeyRef.current)
    setMatchingComplete(false)
    setMatchingStats(null)
    const stripped = claims.map(c => ({
      ...c,
      matched: false,
      matchConfidence: undefined,
      matchTier: undefined,
      reference: undefined,
      matchReasoning: undefined,
      diagnostics: undefined
    }))
    setClaims(stripped)
    runReferenceMatching(stripped, null)
  }

  // ===== Reference Matching (Step 2) =====

  const runReferenceMatching = async (detectedClaims, analysisTotalMs = null, analysisUsage = null) => {
    setIsMatching(true)
    matchingCancelRequestedRef.current = false
    const totalClaims = detectedClaims.length
    setMatchingProgress(`Reviewing references... 0/${totalClaims} claims`)
    const matchingStartedAt = Date.now()
    let maxShownClaimCount = 0
    let lastClaimUpdateSeq = 0
    const pendingClaimUpdates = new Map()
    let flushHandle = null

    const applyPendingClaimUpdates = () => {
      if (!pendingClaimUpdates.size) return

      const updates = new Map(pendingClaimUpdates)
      pendingClaimUpdates.clear()

      setClaims((prev) => {
        let changed = false
        const merged = prev.map((claim) => {
          const nextMatch = updates.get(claim.id)
          if (!nextMatch) return claim

          const nextClaim = mergeMatchFields(claim, nextMatch)
          if (nextClaim !== claim) changed = true
          return nextClaim
        })
        return changed ? merged : prev
      })
    }

    const scheduleClaimUpdateFlush = () => {
      if (flushHandle) return
      flushHandle = setTimeout(() => {
        flushHandle = null
        applyPendingClaimUpdates()
      }, 120)
    }

    const queueClaimUpdate = (claimUpdate) => {
      if (!claimUpdate?.id) return
      pendingClaimUpdates.set(claimUpdate.id, claimUpdate)

      if (pendingClaimUpdates.size >= 6) {
        if (flushHandle) {
          clearTimeout(flushHandle)
          flushHandle = null
        }
        applyPendingClaimUpdates()
        return
      }
      scheduleClaimUpdateFlush()
    }

    const updateProgressFromJob = (progress, status) => {
      const totalClaimsForProgress = Math.max(0, Number(progress?.total) || totalClaims)
      if (totalClaimsForProgress === 0) {
        setMatchingProgress('Reviewing references...')
      } else {
        const completed = Math.max(0, Math.min(Number(progress?.current) || 0, totalClaimsForProgress))
        const stage = String(progress?.stage || status || '').toLowerCase()
        const inFlightCount = completed < totalClaimsForProgress ? completed + 1 : totalClaimsForProgress
        const shownCount = stage === 'done' ? completed : inFlightCount
        const monotonicCount = Math.max(maxShownClaimCount, shownCount)
        maxShownClaimCount = monotonicCount
        setMatchingProgress(`Reviewing references... ${monotonicCount}/${totalClaimsForProgress} claims`)
      }

      const claimSeq = Number(progress?.latest_claim_result_seq) || 0
      if (claimSeq > lastClaimUpdateSeq && progress?.latest_claim_result) {
        lastClaimUpdateSeq = claimSeq
        queueClaimUpdate(progress.latest_claim_result)
      }
    }

    const closeEventSource = () => {
      if (matchingEventSourceRef.current) {
        matchingEventSourceRef.current.close()
        matchingEventSourceRef.current = null
      }
    }

    const pollUntilTerminal = async (jobId, seedJob) => {
      let terminalJob = seedJob

      while (!MATCHING_TERMINAL_STATUSES.has(terminalJob?.status)) {
        if (cancelAnalysisRef.current || matchingCancelRequestedRef.current) {
          await cancelActiveMatchingJob()
          return terminalJob
        }

        await sleep(MATCHING_JOB_POLL_INTERVAL_MS)
        if (!matchingJobIdRef.current) return terminalJob

        const polled = await api.getReferenceMatchingJob(jobId)
        const nextJob = polled?.job
        if (!nextJob) {
          throw new Error('Matching job status response was empty')
        }

        terminalJob = nextJob
        updateProgressFromJob(terminalJob.progress, terminalJob.status)
      }

      return terminalJob
    }

    const waitForTerminalViaSse = (jobId, initialJob) => new Promise((resolve, reject) => {
      if (typeof EventSource === 'undefined') {
        reject(new Error('EventSource is not supported in this browser'))
        return
      }

      const source = api.createReferenceMatchingJobEventSource(jobId)
      matchingEventSourceRef.current = source
      let settled = false

      const cleanup = () => {
        if (settled) return
        settled = true
        if (matchingEventSourceRef.current === source) {
          matchingEventSourceRef.current = null
        }
        source.close()
      }

      source.onmessage = (event) => {
        let payload = null
        try {
          payload = JSON.parse(event.data)
        } catch {
          return
        }
        const nextJob = payload?.job
        if (!nextJob) return

        updateProgressFromJob(nextJob.progress, nextJob.status)

        if (cancelAnalysisRef.current || matchingCancelRequestedRef.current) {
          cleanup()
          resolve(nextJob)
          return
        }

        if (MATCHING_TERMINAL_STATUSES.has(nextJob.status)) {
          cleanup()
          resolve(nextJob)
        }
      }

      source.onerror = () => {
        if (cancelAnalysisRef.current || matchingCancelRequestedRef.current) {
          cleanup()
          resolve(initialJob)
          return
        }
        cleanup()
        reject(new Error('SSE stream interrupted'))
      }
    })

    try {
      if (!detectedClaims.length) {
        setMatchingProgress('No claims to review')
        setIsMatching(false)
        return
      }

      const referencesForMatch = referenceDocuments.map(ref => ({
        id: ref.id,
        display_alias: ref.name
      }))

      if (referencesForMatch.length === 0) {
        setMatchingProgress('No references available')
        setIsMatching(false)
        return
      }

      const matchBrandId = libraryBrandId || selectedBrandId
      if (!matchBrandId) {
        throw new Error('No brand selected for reference matching')
      }

      const matchingOptions = {}
      const configuredConcurrency = parsePositiveIntEnv(import.meta.env.VITE_MATCHING_CONCURRENCY, null)
      const configuredTopK = parsePositiveIntEnv(import.meta.env.VITE_MATCHING_TOPK, null)
      const configuredCandidatePool = parsePositiveIntEnv(import.meta.env.VITE_MATCHING_CANDIDATE_POOL, null)
      if (configuredConcurrency) matchingOptions.concurrency = configuredConcurrency
      if (configuredTopK) matchingOptions.topK = configuredTopK
      if (configuredCandidatePool) matchingOptions.candidatePool = configuredCandidatePool

      const started = await api.startReferenceMatchingJob(matchBrandId, {
        claims: detectedClaims,
        references: referencesForMatch,
        options: matchingOptions
      })
      const startedJob = started?.job
      if (!startedJob?.job_id) {
        throw new Error('Failed to start matching job')
      }
      matchingJobIdRef.current = startedJob.job_id

      let terminalJob = startedJob
      updateProgressFromJob(terminalJob.progress, terminalJob.status)

      try {
        terminalJob = await waitForTerminalViaSse(startedJob.job_id, startedJob)
      } catch (sseError) {
        if (!cancelAnalysisRef.current && !matchingCancelRequestedRef.current) {
          logger.warn('Matching SSE stream failed; falling back to polling:', sseError.message)
        }
        terminalJob = await pollUntilTerminal(startedJob.job_id, terminalJob)
      }

      if (!MATCHING_TERMINAL_STATUSES.has(terminalJob?.status)) {
        terminalJob = await pollUntilTerminal(startedJob.job_id, terminalJob)
      }

      if (cancelAnalysisRef.current || matchingCancelRequestedRef.current) {
        await cancelActiveMatchingJob()
        return
      }

      if (terminalJob.status === 'cancelled') {
        if (cancelAnalysisRef.current || matchingCancelRequestedRef.current) return
        setMatchingProgress('Matching cancelled')
        return
      }
      if (terminalJob.status === 'failed') {
        throw new Error(terminalJob.error || 'Matching job failed')
      }

      const enrichedClaims = Array.isArray(terminalJob.result?.claims) ? terminalJob.result.claims : []
      const telemetry = terminalJob.result?.telemetry || null
      if (cancelAnalysisRef.current || matchingCancelRequestedRef.current) return

      const matchingTotalMs = Date.now() - matchingStartedAt
      setClaims(prev => {
        if (!prev.length) return enrichedClaims

        const enrichedById = new Map(enrichedClaims.map(claim => [claim.id, claim]))
        let changed = false

        const merged = prev.map((claim) => {
          const finalMatch = enrichedById.get(claim.id)
          if (!finalMatch) return claim

          const nextClaim = mergeMatchFields(claim, finalMatch)
          if (nextClaim !== claim) changed = true
          return nextClaim
        })

        return changed ? merged : prev
      })
      const stats = getMatchingStats(enrichedClaims)
      const enrichedStats = {
        ...stats,
        matching_total_ms: telemetry?.matching_total_ms ?? matchingTotalMs,
        reference_fetch_ms: telemetry?.reference_fetch_ms ?? 0,
        per_claim_match_ms: telemetry?.per_claim_match_ms,
        concurrency: telemetry?.concurrency,
        top_k: telemetry?.top_k,
        retrieval_top_k: telemetry?.retrieval_top_k,
        candidate_pool: telemetry?.candidate_pool,
        unique_claims: telemetry?.unique_claims,
        duplicate_claims: telemetry?.duplicate_claims,
        autoconfirm_count: telemetry?.autoconfirm_count,
        confirmation_count: telemetry?.confirmation_count,
        ai_candidates_total: telemetry?.ai_candidates_total,
        ai_candidates_pre_diversity_total: telemetry?.ai_candidates_pre_diversity_total,
        ai_diversity_pruned_total: telemetry?.ai_diversity_pruned_total,
        ai_diversity_replacements_total: telemetry?.ai_diversity_replacements_total,
        matching_ai_calls: telemetry?.matching_ai_calls,
        matching_ai_input_tokens: telemetry?.matching_ai_input_tokens,
        matching_ai_output_tokens: telemetry?.matching_ai_output_tokens,
        matching_ai_cost: telemetry?.matching_ai_cost,
        confirmation_skipped_count: telemetry?.confirmation_skipped_count,
        confirmation_skipped_low_confidence_count: telemetry?.confirmation_skipped_low_confidence_count,
        hybrid_enabled: telemetry?.hybrid_enabled,
        autoconfirm_enabled: telemetry?.autoconfirm_enabled,
        skip_confirm_low_confidence_enabled: telemetry?.skip_confirm_low_confidence_enabled,
        skip_confirm_max_semantic: telemetry?.skip_confirm_max_semantic,
        skip_confirm_max_hybrid: telemetry?.skip_confirm_max_hybrid,
        skip_confirm_max_keyword: telemetry?.skip_confirm_max_keyword,
        confirm_diversity_enabled: telemetry?.confirm_diversity_enabled,
        ai_confirm_per_reference_cap: telemetry?.ai_confirm_per_reference_cap,
        pipeline_summary: telemetry?.pipeline_summary,
        fact_anchored_count: telemetry?.fact_anchored_count,
        extraction_ai_calls: telemetry?.extraction_ai_calls,
        verified_quotes: telemetry?.verified_quotes,
        unverified_quotes: telemetry?.unverified_quotes,
        semantic_search_count: telemetry?.semantic_search_count
      }
      if (currentCacheKeyRef.current) {
        writeAnalysisCache(currentCacheKeyRef.current, enrichedClaims, {
          analysisMs: analysisTotalMs,
          usage: analysisUsage,
          matchingStats: enrichedStats
        })
        setHasCachedResult(true)
      }
      setMatchingStats(enrichedStats)
      setMatchingComplete(true)
      setMatchingProgress('')
      logger.info({
        event: 'mkg2_matching_summary',
        analysis_total_ms: analysisTotalMs,
        matching_total_ms: enrichedStats.matching_total_ms,
        reference_fetch_ms: enrichedStats.reference_fetch_ms,
        per_claim_match_ms: enrichedStats.per_claim_match_ms,
        concurrency: enrichedStats.concurrency,
        top_k: enrichedStats.top_k,
        retrieval_top_k: enrichedStats.retrieval_top_k,
        candidate_pool: enrichedStats.candidate_pool,
        unique_claims: enrichedStats.unique_claims,
        duplicate_claims: enrichedStats.duplicate_claims,
        autoconfirm_count: enrichedStats.autoconfirm_count,
        confirmation_count: enrichedStats.confirmation_count,
        ai_candidates_total: enrichedStats.ai_candidates_total,
        ai_candidates_pre_diversity_total: enrichedStats.ai_candidates_pre_diversity_total,
        ai_diversity_pruned_total: enrichedStats.ai_diversity_pruned_total,
        ai_diversity_replacements_total: enrichedStats.ai_diversity_replacements_total,
        matching_ai_calls: enrichedStats.matching_ai_calls,
        matching_ai_input_tokens: enrichedStats.matching_ai_input_tokens,
        matching_ai_output_tokens: enrichedStats.matching_ai_output_tokens,
        matching_ai_cost: enrichedStats.matching_ai_cost,
        confirmation_skipped_count: enrichedStats.confirmation_skipped_count,
        confirmation_skipped_low_confidence_count: enrichedStats.confirmation_skipped_low_confidence_count,
        hybrid_enabled: enrichedStats.hybrid_enabled,
        autoconfirm_enabled: enrichedStats.autoconfirm_enabled,
        skip_confirm_low_confidence_enabled: enrichedStats.skip_confirm_low_confidence_enabled,
        skip_confirm_max_semantic: enrichedStats.skip_confirm_max_semantic,
        skip_confirm_max_hybrid: enrichedStats.skip_confirm_max_hybrid,
        skip_confirm_max_keyword: enrichedStats.skip_confirm_max_keyword,
        confirm_diversity_enabled: enrichedStats.confirm_diversity_enabled,
        ai_confirm_per_reference_cap: enrichedStats.ai_confirm_per_reference_cap,
        total_claims: stats.total,
        matched_count: stats.matched,
        unmatched_count: stats.unmatched,
        tier_breakdown: stats.tiers,
        pipeline_summary: telemetry?.pipeline_summary,
        fact_anchored_count: telemetry?.fact_anchored_count,
        extraction_ai_calls: telemetry?.extraction_ai_calls,
        verified_quotes: telemetry?.verified_quotes,
        unverified_quotes: telemetry?.unverified_quotes,
        semantic_search_count: telemetry?.semantic_search_count
      })

      // V2 diagnostics: log per-claim pipeline traces for debugging
      if (telemetry?.pipeline_summary) {
        logger.info({ event: 'mkg2_pipeline_summary', ...telemetry.pipeline_summary })
      }
      const unmatchedWithDiag = enrichedClaims
        .filter(c => !c.matched && c.diagnostics)
        .map(c => ({ id: c.id, text: c.text?.slice(0, 100), diagnostics: c.diagnostics }))
      if (unmatchedWithDiag.length > 0) {
        logger.info({ event: 'mkg2_unmatched_diagnostics', claims: unmatchedWithDiag })
      }

      // Save full diagnostics to disk for analysis
      fetch('/api/diagnostics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          pipeline_summary: telemetry?.pipeline_summary,
          telemetry: { ...telemetry, pipeline_summary: undefined },
          stats,
          claims: enrichedClaims.map(c => ({
            id: c.id,
            text: c.text?.slice(0, 200),
            matched: c.matched,
            matchTier: c.matchTier,
            matchConfidence: c.matchConfidence,
            referenceName: c.reference?.name,
            matchReasoning: c.matchReasoning,
            diagnostics: c.diagnostics
          }))
        })
      }).catch(() => { /* best-effort */ })
    } catch (error) {
      if (cancelAnalysisRef.current || matchingCancelRequestedRef.current) return
      logger.error('Reference matching error:', error)
      setMatchingProgress(`Matching error: ${error.message}`)
    } finally {
      closeEventSource()
      if (flushHandle) {
        clearTimeout(flushHandle)
      }
      applyPendingClaimUpdates()
      matchingJobIdRef.current = null
      setIsMatching(false)
    }
  }

  // ===== Position refinement =====

  useEffect(() => {
    if (!analysisComplete || extractedPages.length === 0) return
    setClaims(prev => {
      if (!prev.length) return prev
      const needsFallbackPosition = prev.some(c => !c.position || c.position?.source === 'fallback')
      const hasSlideClaims = prev.some(c => c.region === 'slide' && !c.globalSpot)
      if (!needsFallbackPosition && !hasSlideClaims) return prev

      const withRecoveredPositions = needsFallbackPosition
        ? enrichClaimsWithPositions(prev, extractedPages)
        : prev
      const refreshed = hasSlideClaims
        ? alignClaimsToSlideLayout(withRecoveredPositions, extractedPages)
        : withRecoveredPositions

      if (refreshed === prev) return prev

      const withIndexes = refreshed.map(claim => {
        const existing = prev.find(c => c.id === claim.id)
        return { ...claim, globalIndex: existing?.globalIndex, matched: existing?.matched, reference: existing?.reference }
      })
      const missingIndex = withIndexes.some(c => !c.globalIndex)
      return missingIndex ? addGlobalIndices(withIndexes) : withIndexes
    })
  }, [analysisComplete, extractedPages])

  // ===== Claim Actions =====

  const persistTrainingDocumentClaims = async (nextApprovedClaims) => {
    if (!selectedBrandId || !uploadedFile?.name) return

    const documentName = uploadedFile.name
    const documentKey = normalizeTrainingDocumentKey(documentName)
    const normalizedClaims = dedupeTrainingClaims(nextApprovedClaims)
    const existingDoc = trainingDocuments.find(doc => doc.document_key === documentKey)

    if (existingDoc) {
      const sourceIds = existingDoc.source_session_ids?.length
        ? existingDoc.source_session_ids
        : [existingDoc.id]

      const updates = await Promise.allSettled(
        sourceIds.map(id => api.updateTrainingSessionClaims(id, normalizedClaims))
      )
      const hasSuccess = updates.some(result => result.status === 'fulfilled')
      if (!hasSuccess) throw new Error('Training document update failed')

      setTrainingDocuments(prev => prev.map(doc => (
        doc.document_key === documentKey
          ? { ...doc, approved_claims: normalizedClaims, prompt_text: editablePrompt || doc.prompt_text }
          : doc
      )))
      return
    }

    const created = await api.createTrainingSession({
      brand_id: selectedBrandId,
      label: documentName,
      document_name: documentName,
      approved_claims: normalizedClaims,
      prompt_text: editablePrompt
    })

    const createdRecord = toTrainingDocumentRecord(created)
    setTrainingDocuments(prev => [
      createdRecord,
      ...prev.filter(doc => doc.document_key !== createdRecord.document_key)
    ])
  }

  const handleClaimApprove = (claimId) => {
    setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'approved' } : c))
    const claim = claims.find(c => c.id === claimId)
    if (!claim) return

    // Persist approved claim for the current document (brand-scoped).
    const trainingClaim = {
      text: claim.text,
      type: 'Claim',
      confidence: claim.confidence,
      reference: claim.reference ? { id: claim.reference.id, name: claim.reference.name } : null
    }
    const docKey = normalizeTrainingDocumentKey(uploadedFile?.name)
    const currentApproved = trainingDocuments.find(doc => doc.document_key === docKey)?.approved_claims || []
    const nextApproved = [
      ...currentApproved.filter(c => normalizeTrainingClaimText(c.text) !== normalizeTrainingClaimText(claim.text)),
      trainingClaim
    ]
    persistTrainingDocumentClaims(nextApproved)
      .catch(err => logger.warn('Training document update failed:', err.message))

    // Fire-and-forget feedback to backend
    api.createFeedback({
      claim_id: claimId,
      document_id: uploadedFile?.name,
      reference_doc_id: claim.reference?.id || null,
      decision: 'approved',
      confidence_score: claim.confidence
    }).catch(err => logger.error('Feedback save error:', err))
  }

  const handleClaimReject = (claimId, { rejectionType, correctedReferenceId } = {}) => {
    const correctedRef = correctedReferenceId
      ? referenceDocuments.find(r => r.id === correctedReferenceId)
      : null

    setClaims(prev => prev.map(c =>
      c.id === claimId
        ? {
            ...c,
            status: 'rejected',
            rejectionType: rejectionType || 'false_positive',
            correctedReferenceName: correctedRef?.name || null
          }
        : c
    ))

    const claim = claims.find(c => c.id === claimId)
    if (!claim) return

    const docKey = normalizeTrainingDocumentKey(uploadedFile?.name)
    const currentApproved = trainingDocuments.find(doc => doc.document_key === docKey)?.approved_claims || []

    // Update document-level training — remove false_positives, keep corrected examples.
    if (rejectionType !== 'false_positive') {
      const trainingClaim = {
        text: claim.text,
        type: 'Claim',
        confidence: claim.confidence,
        reference: correctedRef
          ? { id: correctedRef.id, name: correctedRef.name }
          : claim.reference
            ? { id: claim.reference.id, name: claim.reference.name }
            : null,
        correction: rejectionType
      }
      const nextApproved = [
        ...currentApproved.filter(c => normalizeTrainingClaimText(c.text) !== normalizeTrainingClaimText(claim.text)),
        trainingClaim
      ]
      persistTrainingDocumentClaims(nextApproved)
        .catch(err => logger.warn('Training document update failed:', err.message))
    } else {
      // false_positive: remove from approved set and add as FalsePositive training example
      const fpTrainingClaim = {
        text: claim.text,
        type: 'FalsePositive',
        confidence: claim.confidence
      }
      const nextApproved = [
        ...currentApproved.filter(c => normalizeTrainingClaimText(c.text) !== normalizeTrainingClaimText(claim.text)),
        fpTrainingClaim
      ]
      persistTrainingDocumentClaims(nextApproved)
        .catch(err => logger.warn('Training document update failed:', err.message))
    }

    // Fire-and-forget feedback to backend
    api.createFeedback({
      claim_id: claimId,
      document_id: uploadedFile?.name,
      reference_doc_id: claim.reference?.id || null,
      decision: 'rejected',
      rejection_type: rejectionType || 'false_positive',
      corrected_reference_id: correctedReferenceId || null,
      confidence_score: claim.confidence
    }).catch(err => logger.error('Feedback save error:', err))
  }

  const handleClaimSelect = (claimId) => {
    setActiveClaimId(claimId)
    if (claimId) {
      const selectedClaim = claims.find(c => c.id === claimId)
      const selectedPage = Math.max(1, Number(selectedClaim?.page) || 1)
      if (selectedClaim && collapsedPages[selectedPage]) {
        setCollapsedPages(prev => ({ ...prev, [selectedPage]: false }))
      }
    }
    if (claimId && claimsListRef.current) {
      // Wait a frame so collapsed groups can expand before scrolling to card.
      requestAnimationFrame(() => {
        const cardEl = claimsListRef.current?.querySelector(`[data-claim-id="${claimId}"]`)
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      })
    }
  }

  const handleViewSource = (claim) => {
    if (claim.reference?.id) {
      setReferenceViewerData({
        referenceId: claim.reference.id,
        page: claim.reference.page,
        excerpt: claim.reference.excerpt
      })
    }
  }

  // ===== Missed Claim Reporting =====

  const handlePinPlace = (position) => {
    setPendingPinPosition(position)
    setSelectionMode(false)
    setTextSelectionMode(true)
  }

  const handleTextSelected = (text) => {
    setPendingSupportingText(text)
    setTextSelectionMode(false)
  }

  const handleClearSupportingText = () => {
    setPendingSupportingText('')
    setTextSelectionMode(true)
  }

  const handleMissedClaimSubmit = (formData) => {
    if (!pendingPinPosition) return

    const missedClaim = {
      id: `missed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: formData.text,
      position: { x: pendingPinPosition.x, y: pendingPinPosition.y },
      page: pendingPinPosition.page,
      referenceId: formData.referenceId,
      referenceName: formData.referenceName,
      supportingText: formData.supportingText,
      status: 'missed'
    }

    setMissedClaims(prev => [...prev, missedClaim])
    setPendingPinPosition(null)
    setPendingSupportingText('')
    setTextSelectionMode(false)

    // Show success toast
    setMissedClaimToast(true)
    setTimeout(() => setMissedClaimToast(false), 3000)

    // Fire-and-forget feedback to backend
    api.createFeedback({
      claim_id: missedClaim.id,
      document_id: uploadedFile?.name,
      reference_doc_id: formData.referenceId || null,
      decision: 'missed',
      reason: formData.supportingText || '',
      confidence_score: null
    }).catch(err => logger.error('Missed claim feedback save error:', err))

    // Add to training data for future runs
    const trainingClaim = {
      text: formData.text,
      type: 'MissedClaim',
      confidence: 1.0,
      reference: formData.referenceId ? { id: formData.referenceId, name: formData.referenceName } : null,
      supportingText: formData.supportingText
    }
    const docKey = normalizeTrainingDocumentKey(uploadedFile?.name)
    const currentApproved = trainingDocuments.find(doc => doc.document_key === docKey)?.approved_claims || []
    const nextApproved = [
      ...currentApproved.filter(c => normalizeTrainingClaimText(c.text) !== normalizeTrainingClaimText(formData.text)),
      trainingClaim
    ]
    persistTrainingDocumentClaims(nextApproved)
      .catch(err => logger.warn('Training document update for missed claim failed:', err.message))
  }

  const handleMissedClaimCancel = () => {
    setPendingPinPosition(null)
    setPendingSupportingText('')
    setTextSelectionMode(false)
  }

  const handleRemoveMissedClaim = (missedClaimId) => {
    setMissedClaims(prev => prev.filter(mc => mc.id !== missedClaimId))
  }

  // ===== Training Data Actions =====

  const handleDeleteTrainingSession = async (sessionId) => {
    try {
      const target = trainingDocuments.find(doc =>
        doc.id === sessionId || doc.source_session_ids?.includes(sessionId)
      )
      if (!target) return

      const deleteIds = target.source_session_ids?.length
        ? target.source_session_ids
        : [target.id]

      const deletions = await Promise.allSettled(
        deleteIds.map(id => api.deleteTrainingSession(id))
      )
      const hasSuccess = deletions.some(result => result.status === 'fulfilled')
      if (!hasSuccess) throw new Error('Delete training document failed')

      setTrainingDocuments(prev =>
        prev.filter(doc => doc.document_key !== target.document_key)
      )
    } catch (err) {
      logger.error('Delete training document error:', err)
    }
  }

  const handleDeleteClaimFromSession = async (sessionId, claimIndex) => {
    try {
      const target = trainingDocuments.find(doc =>
        doc.id === sessionId || doc.source_session_ids?.includes(sessionId)
      )
      if (!target) return

      const nextClaims = target.approved_claims.filter((_, i) => i !== claimIndex)
      const updateIds = target.source_session_ids?.length
        ? target.source_session_ids
        : [target.id]

      if (nextClaims.length === 0) {
        await Promise.allSettled(updateIds.map(id => api.deleteTrainingSession(id)))
        setTrainingDocuments(prev => prev.filter(doc => doc.document_key !== target.document_key))
      } else {
        await Promise.allSettled(updateIds.map(id => api.updateTrainingSessionClaims(id, nextClaims)))
        setTrainingDocuments(prev => prev.map(doc =>
          doc.document_key === target.document_key ? { ...doc, approved_claims: nextClaims } : doc
        ))
      }
    } catch (err) {
      logger.error('Delete claim from session error:', err)
    }
  }

  const handleClearTrainingSessions = async () => {
    if (!selectedBrandId) return
    try {
      await api.clearTrainingSessions(selectedBrandId)
      setTrainingDocuments([])
    } catch (err) {
      logger.error('Clear training documents error:', err)
    }
  }

  const handleExportTrainingSessions = () => {
    if (!selectedBrandId) return
    api.exportTrainingSessions(selectedBrandId)
  }

  // ===== Library Actions =====

  const handleReferenceUpload = async (file) => {
    if (!file) return
    // Always upload to the shared MKG Reference Library
    const brandId = libraryBrandId || selectedBrandId || brands[0]?.id
    if (!brandId) {
      logger.error('No brand available for upload')
      return
    }
    setIsUploadingRef(true)
    try {
      await api.uploadReference(brandId, file)
      await loadBrandReferences(libraryBrandId || brandId)
    } catch (err) {
      logger.error('Reference upload error:', err)
    } finally {
      setIsUploadingRef(false)
    }
  }

  const handleReferenceRename = async (docId, newName) => {
    const doc = referenceDocuments.find(d => d.id === docId)
    const brandId = doc?.brand_id || selectedBrandId
    if (!brandId) return
    try {
      await api.updateReference(brandId, docId, { display_alias: newName })
      setReferenceDocuments(prev =>
        prev.map(d => d.id === docId ? { ...d, name: newName } : d)
      )
    } catch (err) {
      logger.error('Reference rename error:', err)
    }
  }

  const handleReferenceDelete = async (docId) => {
    const doc = referenceDocuments.find(d => d.id === docId)
    const brandId = doc?.brand_id || selectedBrandId
    if (!brandId) return
    try {
      await api.deleteReference(brandId, docId)
      const deleted = referenceDocuments.find(d => d.id === docId)
      setReferenceDocuments(prev => prev.filter(d => d.id !== docId))
      if (deleted) {
        setTrashDocuments(prev => [{ ...deleted, deletedAt: new Date().toISOString() }, ...prev])
      }
    } catch (err) {
      logger.error('Reference delete error:', err)
    }
  }

  const handleRetryIndex = async (docId) => {
    try {
      await api.triggerFactExtraction(docId)
      // Update local state to show extracting
      setReferenceDocuments(prev => prev.map(d =>
        d.id === docId ? { ...d, extraction_status: 'extracting' } : d
      ))
    } catch (err) {
      logger.error('Fact extraction retry error:', err)
    }
  }

  const handleBulkDelete = async (ids) => {
    try {
      await api.bulkDeleteReferences(ids)
      const deleted = referenceDocuments.filter(doc => ids.includes(doc.id))
      setReferenceDocuments(prev => prev.filter(doc => !ids.includes(doc.id)))
      setTrashDocuments(prev => [...deleted.map(d => ({ ...d, deletedAt: new Date().toISOString() })), ...prev])
    } catch (err) {
      logger.error('Bulk delete error:', err)
    }
  }

  const handleBulkMove = async (ids, folderId) => {
    try {
      await api.bulkMoveReferences(ids, folderId)
      setReferenceDocuments(prev =>
        prev.map(doc => ids.includes(doc.id) ? { ...doc, folder_id: folderId } : doc)
      )
    } catch (err) {
      logger.error('Bulk move error:', err)
    }
  }

  const handleRestore = async (ids) => {
    try {
      const brandId = libraryBrandId || selectedBrandId
      await api.restoreReferences(brandId, ids)
      const restored = trashDocuments.filter(doc => ids.includes(doc.id))
      setTrashDocuments(prev => prev.filter(doc => !ids.includes(doc.id)))
      setReferenceDocuments(prev => [...prev, ...restored.map(d => ({ ...d, deletedAt: undefined, folder_id: null }))])
    } catch (err) {
      logger.error('Restore error:', err)
    }
  }

  const handlePermanentDelete = async (ids) => {
    try {
      const brandId = libraryBrandId || selectedBrandId
      await api.permanentDeleteReferences(brandId, ids)
      setTrashDocuments(prev => prev.filter(doc => !ids.includes(doc.id)))
    } catch (err) {
      logger.error('Permanent delete error:', err)
    }
  }

  const handleFolderCreate = async (name) => {
    try {
      const folder = await api.createFolder(name)
      await loadFolders()
      return folder
    } catch (err) {
      logger.error('Folder create error:', err)
    }
  }

  const handleFolderDelete = async (folderId) => {
    try {
      await api.deleteFolder(folderId)
      if (activeFolderId === folderId) setActiveFolderId(null)
      await loadFolders()
      if (libraryBrandId) await loadBrandReferences(libraryBrandId)
    } catch (err) {
      logger.error('Folder delete error:', err)
    }
  }

  const handleFolderRename = async (folderId, newName) => {
    try {
      await api.updateFolder(folderId, newName)
      await loadFolders()
    } catch (err) {
      logger.error('Folder rename error:', err)
    }
  }

  // ===== Computed Values =====

  const pendingCount = claims.filter(c => c.status === 'pending').length
  const approvedCount = claims.filter(c => c.status === 'approved').length
  const rejectedCount = claims.filter(c => c.status === 'rejected').length
  const highConfidenceClaims = claims.filter(c => c.confidence >= 0.9)
  const mediumConfidenceClaims = claims.filter(c => c.confidence >= 0.7 && c.confidence < 0.9)
  const lowConfidenceClaims = claims.filter(c => c.confidence < 0.7)
  const missedCount = missedClaims.length

  // ===== Validation Scorecard Metrics =====
  const validationMetrics = useMemo(() => {
    const reviewed = claims.filter(c => c.status === 'approved' || c.status === 'rejected')
    const approved = claims.filter(c => c.status === 'approved').length
    const falsePositives = claims.filter(c => c.status === 'rejected' && c.rejectionType === 'false_positive').length
    const correctedRejections = claims.filter(c =>
      c.status === 'rejected' && c.rejectionType && c.rejectionType !== 'false_positive'
    ).length
    const missed = missedClaims.length

    const reviewedCount = reviewed.length
    const totalClaims = claims.length

    // Precision: approved / (approved + false_positives)
    const precisionDenom = approved + falsePositives
    const precision = precisionDenom > 0 ? (approved / precisionDenom) * 100 : null

    // Recall: (approved + corrected_rejections) / (approved + corrected_rejections + missed)
    const recallDenom = approved + correctedRejections + missed
    const recall = recallDenom > 0 ? ((approved + correctedRejections) / recallDenom) * 100 : null

    // Mapping accuracy: approved / (approved + wrong_reference + wrong_location + missing_reference)
    const mappingDenom = approved + correctedRejections
    const mappingAccuracy = mappingDenom > 0 ? (approved / mappingDenom) * 100 : null

    return {
      reviewedCount,
      totalClaims,
      missed,
      approved,
      falsePositives,
      correctedRejections,
      precision,
      recall,
      mappingAccuracy
    }
  }, [claims, missedClaims])
  const matchedRateLabel = matchingStats ? `${matchingStats.matchRate}%` : 'N/A'

  const analysisMs = processingTime || 0
  const matchingMs = matchingStats?.matching_total_ms || 0
  const endToEndMs = analysisMs + matchingMs

  const claimDetectionRunCost = lastUsage?.cost || 0
  const referenceMatchingRunCost = matchingStats?.matching_ai_cost || 0
  const totalRunAICost = claimDetectionRunCost + referenceMatchingRunCost

  const pageOptions = useMemo(() => {
    const uniquePages = new Set()
    claims.forEach((claim) => {
      uniquePages.add(Math.max(1, Number(claim.page) || 1))
    })
    return Array.from(uniquePages).sort((a, b) => a - b)
  }, [claims])

  // When page options change, initialize any new pages (default expanded)
  useEffect(() => {
    setCollapsedPages(prev => {
      const next = {}
      let changed = Object.keys(prev).length !== pageOptions.length

      pageOptions.forEach((page) => {
        if (prev[page] === undefined) changed = true
        next[page] = prev[page] ?? false
      })

      return changed ? next : prev
    })
  }, [pageOptions])

  // Always show all claims — better to over-flag than miss a claim
  const displayedClaims = statusFilter === 'missed' ? [] : claims
    .filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (searchQuery && !c.text.toLowerCase().includes(searchQuery.toLowerCase())) return false
      if (sortOrder === 'no-matches' && c.matched) return false
      return true
    })
    .sort((a, b) => {
      if (sortOrder === 'page') {
        const pageA = Math.max(1, Number(a.page) || 1)
        const pageB = Math.max(1, Number(b.page) || 1)
        if (pageA !== pageB) return pageA - pageB
        return (a.globalIndex ?? 0) - (b.globalIndex ?? 0)
      }
      if (sortOrder === 'annotation' || sortOrder === 'no-matches') return (a.globalIndex ?? 0) - (b.globalIndex ?? 0)
      if (sortOrder === 'confidence-desc') return b.confidence - a.confidence
      return a.confidence - b.confidence
    })

  const claimsByPage = useMemo(() => {
    const grouped = new Map()
    displayedClaims.forEach((claim) => {
      const page = Math.max(1, Number(claim.page) || 1)
      if (!grouped.has(page)) grouped.set(page, [])
      grouped.get(page).push(claim)
    })

    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([page, pageClaims]) => ({ page, pageClaims }))
  }, [displayedClaims])

  const canAnalyze = uploadedFile && !isAnalyzing && !isMatching

  const selectedBrand = brands.find(b => b.id === selectedBrandId)

  return (
    <div className="page">
      <div className="header">
        <div className="headerLeft">
          <div className="titleSection">
            <h1 className="title">Annotation Activation</h1>
            <Badge variant="info">POC2</Badge>
          </div>
          <p className="subtitle">
            AI-powered claim detection and reference matching for MLR submissions
          </p>
        </div>
        <div className="headerRight">
          <button
            className="trainingIconBtn"
            onClick={() => setShowTrainingOverlay(prev => !prev)}
            title="Training Data"
            style={{ position: 'relative' }}
          >
            <Icon name="flask" size={18} />
            {(trainingDocuments.length > 0 || ecosystemTrainingExamples.length > 0) && (
              <span className="trainingBadgeDot" />
            )}
          </button>
          <ThemeToggle />
        </div>
      </div>

      <div className="workbenchWrapper">
        <div className={`workbench ${isConfigPanelCollapsed ? 'configCollapsed' : ''}`}>
          {/* ===== LEFT: Config Panel ===== */}
          <div className={`configPanelShell ${isConfigPanelCollapsed ? 'collapsed' : ''}`}>
            <div className="configPanel">
              <AccordionItem
                title="Document"
                defaultOpen={true}
                size="small"
                content={
                  <div className="uploadSection">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf"
                      onChange={handleFileSelect}
                      style={{ display: 'none' }}
                    />
                    {uploadState === 'empty' && (
                      <div className="dropZone" onClick={handleUploadClick}>
                        <div className="dropZoneIcon">
                          <Icon name="upload" size={24} />
                        </div>
                        <p className="dropZoneText">
                          Drop file here or <strong>browse</strong>
                        </p>
                        <p className="dropZoneHint">PDF only</p>
                      </div>
                    )}
                    {uploadState === 'uploading' && (
                      <div className="uploadProgress">
                        <Spinner size="small" />
                        <span>Uploading...</span>
                      </div>
                    )}
                    {uploadState === 'complete' && uploadedFile && (
                      <div className="uploadedFile">
                        <Icon name="fileText" size={20} />
                        <span className="fileName">{uploadedFile.name}</span>
                        <button className="removeFile" onClick={handleRemoveDocument}>
                          <Icon name="x" size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                }
              />

              <AccordionItem
                title="Settings"
                defaultOpen={true}
                size="small"
                content={
                  <div className="settingsContent">
                    {/* Brand Selector */}
                    <div className="settingItem">
                      <label className="settingLabel">Brand</label>
                      <DropdownMenu
                        trigger="button"
                        triggerLabel={selectedBrand?.name || 'Select brand'}
                        items={[
                          ...brands.map(brand => ({
                            label: brand.name,
                            onClick: () => setSelectedBrandId(brand.id)
                          })),
                          { divider: true },
                          {
                            label: 'Add New Brand...',
                            icon: 'plus',
                            onClick: () => setShowNewBrandModal(true)
                          }
                        ]}
                        size="medium"
                      />
                    </div>

                    {/* Document Type */}
                    <DocumentTypeSelector
                      selectedType={selectedDocType}
                      onTypeSelect={setSelectedDocType}
                    />

                    {/* AI Model */}
                    <div className="settingItem">
                      <label className="settingLabel">AI Model</label>
                      <span className="settingValue">{ACTIVE_MODEL_LABEL}</span>
                    </div>
                  </div>
                }
              />

              <AccordionItem
                title="Master Prompt"
                defaultOpen={false}
                size="small"
                content={
                  <div className="masterPromptContent">
                    <div className="promptHeader">
                      {!isEditingPrompt ? (
                        <button className="promptIconBtn" onClick={() => setIsEditingPrompt(true)} title="Edit prompt">
                          <Icon name="edit" size={14} />
                        </button>
                      ) : (
                        <div className="promptEditActions">
                          <button className="promptIconBtn promptSaveBtn" onClick={() => setIsEditingPrompt(false)} title="Save">
                            <Icon name="check" size={14} />
                          </button>
                          <button className="promptIconBtn promptCancelBtn" onClick={handleCancelEdit} title="Cancel">
                            <Icon name="x" size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="promptBody">
                      {isEditingPrompt ? (
                        <textarea
                          className="promptTextarea"
                          value={editablePrompt}
                          onChange={(e) => setEditablePrompt(e.target.value)}
                          rows={16}
                          autoFocus
                        />
                      ) : (
                        <pre className="promptPreview">{editablePrompt}</pre>
                      )}
                    </div>
                  </div>
                }
              />

              <Button
                variant="primary"
                size="large"
                onClick={handleAnalyze}
                disabled={!canAnalyze}
              >
                {isAnalyzing || isMatching ? (
                  <>
                    <Spinner size="small" />
                    {isMatching ? 'Matching...' : 'Analyzing...'}
                  </>
                ) : (
                  <>
                    <Icon name="zap" size={18} />
                    Analyze Document
                  </>
                )}
              </Button>
              {hasCachedResult && !isAnalyzing && !isMatching && (
                <button className="reanalyzeLink" onClick={handleConfirmReanalyze}>
                  Re-analyze from scratch
                </button>
              )}

              {analysisError && (
                <div className="analysisError">
                  <Icon name="alertCircle" size={16} />
                  <span>{analysisError}</span>
                </div>
              )}

              {!selectedBrandId && (
                <div className="analysisError analysisWarning">
                  <Icon name="alertCircle" size={16} />
                  <span>Select a brand to enable reference matching</span>
                </div>
              )}

              {analysisComplete && (
                <>
                  <AccordionItem
                    title="Results Summary"
                    defaultOpen={true}
                    size="small"
                    content={
                      <div className="resultsSummary">
                        <div className="resultRow">
                          <span className="resultLabel">Claims Detected</span>
                          <span className="resultValue">{claims.length}</span>
                        </div>
                        <div className="divider" />
                        <div className="resultRow highConf">
                          <span className="resultLabel">High Confidence (90-100%)</span>
                          <span className="resultValue">{highConfidenceClaims.length}</span>
                        </div>
                        <div className="resultRow medConf">
                          <span className="resultLabel">Medium (70-89%)</span>
                          <span className="resultValue">{mediumConfidenceClaims.length}</span>
                        </div>
                        <div className="resultRow lowConf">
                          <span className="resultLabel">Low (&lt;70%)</span>
                          <span className="resultValue">{lowConfidenceClaims.length}</span>
                        </div>
                        {matchingStats && (
                          <>
                            <div className="divider" />
                            <div className="resultRow matched">
                              <span className="resultLabel">Matched to References</span>
                              <span className="resultValue">{matchingStats.matched} ({matchingStats.matchRate}%)</span>
                            </div>
                            <div className="resultRow unmatched">
                              <span className="resultLabel">Unmatched</span>
                              <span className="resultValue">{matchingStats.unmatched}</span>
                            </div>
                            <div className="resultRow">
                              <span className="resultLabel">Avg Match Confidence</span>
                              <span className="resultValue">{matchingStats.avgConfidence}%</span>
                            </div>
                          </>
                        )}
                        {missedClaims.length > 0 && (
                          <>
                            <div className="divider" />
                            <div className="resultRow missed">
                              <span className="resultLabel">Missed Claims</span>
                              <span className="resultValue">{missedClaims.length}</span>
                            </div>
                          </>
                        )}
                      </div>
                    }
                  />
                  <AccordionItem
                    title="Model Performance"
                    defaultOpen={false}
                    size="small"
                    content={
                      <div className="modelPerformance">
                        <div className="resultRow">
                          <span className="resultLabel">Model</span>
                          <span className="resultValue">{lastUsage?.modelDisplayName || ACTIVE_MODEL_LABEL}</span>
                        </div>
                        <div className="resultRow">
                          <span className="resultLabel">Claims Detected</span>
                          <span className="resultValue">{claims.length}</span>
                        </div>
                        <div className="resultRow">
                          <span className="resultLabel">Matched to References</span>
                          <span className="resultValue">{matchedRateLabel}</span>
                        </div>
                        <div className="divider" />
                        <div className="resultRow">
                          <span className="resultLabel">End-to-End Time</span>
                          <span className="resultValue">{formatMinutes(endToEndMs)}</span>
                        </div>
                        <div className="resultRow">
                          <span className="resultLabel">Claim Detection Time</span>
                          <span className="resultValue">{formatMinutes(analysisMs)}</span>
                        </div>
                        <div className="resultRow">
                          <span className="resultLabel">Reference Matching Time</span>
                          <span className="resultValue">{matchingStats ? formatMinutes(matchingMs) : 'N/A'}</span>
                        </div>
                        <div className="divider" />
                        <div className="resultRow">
                          <span className="resultLabel">Claim Detection Cost</span>
                          <span className="resultValue">${claimDetectionRunCost.toFixed(4)}</span>
                        </div>
                        <div className="resultRow">
                          <span className="resultLabel">Reference Matching Cost</span>
                          <span className="resultValue">{matchingStats ? `$${referenceMatchingRunCost.toFixed(4)}` : 'N/A'}</span>
                        </div>
                        <div className="resultRow">
                          <span className="resultLabel">Total Run AI Cost</span>
                          <span className="resultValue">${totalRunAICost.toFixed(4)}</span>
                        </div>
                        <div className="resultRow">
                          <span className="resultLabel">Session Cost (Detection)</span>
                          <span className="resultValue">${sessionCost.toFixed(4)}</span>
                        </div>
                      </div>
                    }
                  />
                  {(validationMetrics.reviewedCount > 0 || validationMetrics.missed > 0) && (
                    <AccordionItem
                      title="Validation Scorecard"
                      defaultOpen={true}
                      size="small"
                      content={
                        <div className="validationScorecard">
                          <div className="resultRow">
                            <span className="resultLabel">Reviewed</span>
                            <span className="resultValue">{validationMetrics.reviewedCount} of {validationMetrics.totalClaims} claims</span>
                          </div>
                          {validationMetrics.missed > 0 && (
                            <div className="resultRow missed">
                              <span className="resultLabel">Missed Claims</span>
                              <span className="resultValue">{validationMetrics.missed}</span>
                            </div>
                          )}
                          <div className="divider" />
                          <div className="resultRow">
                            <span className="resultLabel">Detection Precision</span>
                            <span className={`resultValue ${validationMetrics.precision !== null && validationMetrics.precision >= 90 ? 'scoreGreen' : validationMetrics.precision !== null && validationMetrics.precision < 70 ? 'scoreRed' : 'scoreAmber'}`}>
                              {validationMetrics.precision !== null ? `${validationMetrics.precision.toFixed(1)}%` : '--'}
                            </span>
                          </div>
                          <div className="resultRow">
                            <span className="resultLabel">Detection Recall</span>
                            <span className={`resultValue ${validationMetrics.recall !== null && validationMetrics.recall >= 90 ? 'scoreGreen' : validationMetrics.recall !== null && validationMetrics.recall < 70 ? 'scoreRed' : 'scoreAmber'}`}>
                              {validationMetrics.recall !== null ? `${validationMetrics.recall.toFixed(1)}%` : '--'}
                            </span>
                          </div>
                          <div className="resultRow">
                            <span className="resultLabel">Mapping Accuracy</span>
                            <span className={`resultValue ${validationMetrics.mappingAccuracy !== null && validationMetrics.mappingAccuracy >= 70 ? 'scoreGreen' : validationMetrics.mappingAccuracy !== null && validationMetrics.mappingAccuracy < 50 ? 'scoreRed' : 'scoreAmber'}`}>
                              {validationMetrics.mappingAccuracy !== null ? `${validationMetrics.mappingAccuracy.toFixed(1)}%` : '--'}
                            </span>
                          </div>
                          <div className="divider" />
                          <div className="scorecardLegend">
                            <span className="legendItem"><span className="legendDot scoreGreen" /> On target</span>
                            <span className="legendItem"><span className="legendDot scoreAmber" /> Below target</span>
                            <span className="legendItem"><span className="legendDot scoreRed" /> Needs work</span>
                          </div>
                        </div>
                      }
                    />
                  )}
                </>
              )}
            </div>
            <button
              className="configPanelToggle"
              type="button"
              onClick={() => setIsConfigPanelCollapsed(prev => !prev)}
              aria-label={isConfigPanelCollapsed ? 'Expand settings panel' : 'Collapse settings panel'}
              title={isConfigPanelCollapsed ? 'Expand settings panel' : 'Collapse settings panel'}
            >
              <Icon name={isConfigPanelCollapsed ? 'chevronRight' : 'chevronLeft'} size={12} />
            </button>
          </div>

          {/* ===== CENTER: PDF Viewer ===== */}
          <div className="documentPanel">
            <PDFViewer
              file={uploadedFile}
              onClose={handleRemoveDocument}
              isAnalyzing={isAnalyzing}
              analysisProgress={analysisProgress}
              analysisStatus={isMatching ? matchingProgress : analysisStatus}
              elapsedSeconds={elapsedSeconds}
              onScanComplete={() => {}}
              claims={claims}
              missedClaims={displayMissedClaims}
              activeClaimId={activeClaimId}
              onClaimSelect={handleClaimSelect}
              onTextExtracted={handleTextExtracted}
              claimsPanelRef={claimsPanelRef}
              showPins={showClaimPins}
              onTogglePins={() => setShowClaimPins(prev => !prev)}
              onCancelAnalysis={handleCancelAnalysis}
              selectionMode={selectionMode}
              onSelectionModeToggle={setSelectionMode}
              onPinPlace={analysisComplete ? handlePinPlace : undefined}
              textSelectionMode={textSelectionMode}
              onTextSelected={handleTextSelected}
            />
            {pendingPinPosition && !textSelectionMode && (
              <div className="missedClaimFormOverlay">
                <MissedClaimForm
                  position={pendingPinPosition}
                  referenceDocuments={referenceDocuments}
                  onSubmit={handleMissedClaimSubmit}
                  onCancel={handleMissedClaimCancel}
                  supportingText={pendingSupportingText}
                  onClearSupportingText={handleClearSupportingText}
                />
              </div>
            )}
            {missedClaimToast && (
              <div className="missedClaimToast">
                <Alert
                  type="success"
                  message="Missed Claim successfully added"
                  layout="toast"
                  size="small"
                  dismissible
                  onDismiss={() => setMissedClaimToast(false)}
                />
              </div>
            )}
          </div>

          {/* ===== RIGHT: Claims + Library ===== */}
          <div className="claimsPanel" ref={claimsPanelRef}>
            <div className="claimsPanelHeader">
              <div className="segmentedControl">
                <div
                  className="segmentedPill"
                  style={{ transform: `translateX(${rightPanelTab * 100}%)` }}
                />
                <button
                  className={`segmentedBtn ${rightPanelTab === 0 ? 'active' : ''}`}
                  onClick={() => setRightPanelTab(0)}
                >
                  Claims{claims.length > 0 ? ` (${claims.length}${missedCount > 0 ? `+${missedCount}` : ''})` : ''}
                </button>
                <button
                  className={`segmentedBtn ${rightPanelTab === 1 ? 'active' : ''}`}
                  onClick={() => setRightPanelTab(1)}
                >
                  Library{referenceDocuments.length > 0 ? ` (${referenceDocuments.length})` : ''}
                </button>
              </div>
            </div>

            <div className="claimsPanelBody">
              {rightPanelTab === 0 ? (
                <>
                  {/* Matching status bar */}
                  {isMatching ? (
                    <div className="matchingStatusBar">
                      <Spinner size="small" />
                      <span>{matchingProgress}</span>
                    </div>
                  ) : analysisComplete ? (
                    <div className="matchingStatusBar">
                      {matchingStats ? (
                        <>
                          <Icon name="gitCompare" size={14} />
                          <span>Matched {matchingStats.matched} of {matchingStats.total} claims</span>
                          {cacheHit && (
                            <span
                              className="matchingCacheBadge"
                              title="Match metrics restored from cached analysis"
                            >
                              Cached match
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <Icon name="zap" size={14} />
                          <span>{cacheHit ? `Cached · ${formatTimeAgo(cacheHit.ts)}` : `${claims.length} claims detected`}</span>
                        </>
                      )}
                      <div className="matchingStatusActions">
                        {matchingStats && (
                          <button className="matchingResetBtn" onClick={handleResetMatching}>Re-match</button>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {/* Training Status Banner */}
                  {analysisComplete && (
                    <TrainingStatusBanner
                      trainingExamples={trainingExamples}
                      ecosystemExampleCount={ecosystemTrainingExamples.length}
                      ecosystemBrandCount={ecosystemTrainingBrandCount}
                      trainingDocumentCount={trainingDocumentCount}
                      analysisComplete={analysisComplete}
                    />
                  )}

                  {analysisComplete && (
                    <div className="claimsFilterBar">
                      <div className="statusToggleGroup">
                        <button
                          className={`statusToggleBtn ${statusFilter === 'all' ? 'active' : ''}`}
                          onClick={() => setStatusFilter('all')}
                        >
                          All ({claims.length})
                        </button>
                        <button
                          className={`statusToggleBtn ${statusFilter === 'pending' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
                        >
                          Pending ({pendingCount})
                        </button>
                        <button
                          className={`statusToggleBtn approved ${statusFilter === 'approved' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'approved' ? 'all' : 'approved')}
                        >
                          Approved ({approvedCount})
                        </button>
                        <button
                          className={`statusToggleBtn rejected ${statusFilter === 'rejected' ? 'active' : ''}`}
                          onClick={() => setStatusFilter(statusFilter === 'rejected' ? 'all' : 'rejected')}
                        >
                          Rejected ({rejectedCount})
                        </button>
                        {missedClaims.length > 0 && (
                          <button
                            className={`statusToggleBtn missed ${statusFilter === 'missed' ? 'active' : ''}`}
                            onClick={() => setStatusFilter(statusFilter === 'missed' ? 'all' : 'missed')}
                          >
                            Missed ({missedClaims.length})
                          </button>
                        )}
                      </div>
                      <div className="claimsSearchSort">
                        <Input
                          placeholder="Search claims..."
                          size="small"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <select
                          className="sortSelect"
                          value={sortOrder}
                          onChange={(e) => setSortOrder(e.target.value)}
                        >
                          <option value="annotation">Annotation #</option>
                          <option value="page">Page</option>
                          <option value="confidence-desc">Confidence ↓</option>
                          <option value="confidence-asc">Confidence ↑</option>
                          <option value="no-matches">No matches</option>
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="claimsList" ref={claimsListRef}>
                    {!analysisComplete && !isAnalyzing && (
                      <div className="claimsEmptyState">
                        <Icon name="fileSearch" size={48} />
                        <h3>No Claims Yet</h3>
                        <p>Upload a document and click Analyze to detect claims</p>
                      </div>
                    )}

                    {isAnalyzing && !analysisComplete && (
                      <div className="claimsLoadingState">
                        <Spinner size="large" />
                        <p>Detecting claims...</p>
                      </div>
                    )}

                    {analysisComplete && displayedClaims.length === 0 && !(statusFilter === 'missed' && missedClaims.length > 0) && (
                      <div className="claimsEmptyState">
                        <Icon name="search" size={48} />
                        <p>
                          {statusFilter === 'all'
                            ? 'No claims found'
                            : `No ${statusFilter} claims`
                          }
                        </p>
                      </div>
                    )}

                    {analysisComplete && sortOrder === 'page' && claimsByPage.map(({ page, pageClaims }) => {
                      const isCollapsed = !!collapsedPages[page]
                      return (
                        <div key={`page-${page}`} className="claimsPageGroup">
                          <button
                            type="button"
                            className="claimsPageGroupHeader"
                            aria-expanded={!isCollapsed}
                            onClick={() => setCollapsedPages(prev => ({ ...prev, [page]: !prev[page] }))}
                          >
                            <span className="claimsPageGroupTitle">
                              <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={14} />
                              Page {page}
                            </span>
                            <Badge variant="neutral" size="small">{pageClaims.length}</Badge>
                          </button>

                          {!isCollapsed && (
                            <div className="claimsPageGroupBody">
                              {pageClaims.map(claim => (
                                <div key={claim.id} data-claim-id={claim.id}>
                                  <MKGClaimCard
                                    claim={claim}
                                    isActive={activeClaimId === claim.id}
                                    onApprove={handleClaimApprove}
                                    onReject={handleClaimReject}
                                    onSelect={() => handleClaimSelect(claim.id)}
                                    onViewSource={() => handleViewSource(claim)}
                                    brandReferences={referenceDocuments}
                                    trainingExamples={trainingExamples}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {analysisComplete && sortOrder !== 'page' && displayedClaims.map(claim => (
                      <div key={claim.id} data-claim-id={claim.id}>
                        <MKGClaimCard
                          claim={claim}
                          isActive={activeClaimId === claim.id}
                          onApprove={handleClaimApprove}
                          onReject={handleClaimReject}
                          onSelect={() => handleClaimSelect(claim.id)}
                          onViewSource={() => handleViewSource(claim)}
                          brandReferences={referenceDocuments}
                          trainingExamples={trainingExamples}
                        />
                      </div>
                    ))}

                    {/* Missed claim cards */}
                    {missedClaims.length > 0 && (statusFilter === 'all' || statusFilter === 'missed') && (() => {
                      const filteredMissed = missedClaims.filter(mc =>
                        !searchQuery || mc.text?.toLowerCase().includes(searchQuery.toLowerCase())
                      )
                      if (filteredMissed.length === 0) return null
                      return (
                        <div className="missedClaimsSection">
                          <div className="missedClaimsSectionHeader">
                            <Icon name="alertCircle" size={14} />
                            <span>Missed Claims ({filteredMissed.length})</span>
                          </div>
                          {filteredMissed.map((mc, idx) => (
                            <div key={mc.id} data-claim-id={mc.id}>
                              <MKGClaimCard
                                claim={{
                                  ...mc,
                                  status: 'missed',
                                  confidence: 1.0,
                                  matched: !!mc.referenceName,
                                  missedIndex: idx + 1,
                                  reference: mc.referenceName ? { name: mc.referenceName } : null
                                }}
                                isActive={activeClaimId === mc.id}
                                onSelect={() => handleClaimSelect(mc.id)}
                                onRemove={handleRemoveMissedClaim}
                                brandReferences={referenceDocuments}
                                trainingExamples={trainingExamples}
                              />
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                </>
              ) : (
                <LibraryTab
                  documents={referenceDocuments}
                  trashDocuments={trashDocuments}
                  folders={folders}
                  activeFolderId={activeFolderId}
                  selectedBrand={selectedBrand}
                  onFolderSelect={setActiveFolderId}
                  onFolderCreate={handleFolderCreate}
                  onFolderDelete={handleFolderDelete}
                  onFolderRename={handleFolderRename}
                  onUpload={handleReferenceUpload}
                  onRename={handleReferenceRename}
                  onDelete={handleReferenceDelete}
                  onBulkDelete={handleBulkDelete}
                  onBulkMove={handleBulkMove}
                  onRestore={handleRestore}
                  onPermanentDelete={handlePermanentDelete}
                  onView={(refId) => setReferenceViewerData({ referenceId: refId })}
                  onRetryIndex={handleRetryIndex}
                  isLoading={isLoadingLibrary}
                  isUploading={isUploadingRef}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reference Viewer Overlay */}
      {referenceViewerData && (
        <div className="modalOverlay" onClick={() => setReferenceViewerData(null)}>
          <div className="modalContent" onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', width: '1100px', height: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className="modalHeader">
              <h2>Reference Document</h2>
              <Button variant="ghost" size="small" onClick={() => setReferenceViewerData(null)}>
                <Icon name="x" size={20} />
              </Button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <ReferenceViewerContent
                referenceId={referenceViewerData.referenceId}
                page={referenceViewerData.page}
                excerpt={referenceViewerData.excerpt}
              />
            </div>
          </div>
        </div>
      )}

      {/* Training Data Overlay */}
      <TrainingDataOverlay
        isOpen={showTrainingOverlay}
        onClose={() => setShowTrainingOverlay(false)}
        sessions={trainingDocuments}
        onDeleteSession={handleDeleteTrainingSession}
        onDeleteClaim={handleDeleteClaimFromSession}
        onClearAll={handleClearTrainingSessions}
        onExport={handleExportTrainingSessions}
        hasActiveBrand={!!selectedBrandId}
        ecosystemBrandCount={ecosystemTrainingBrandCount}
        ecosystemExampleCount={ecosystemTrainingExamples.length}
        promptInjectionText={promptInjectionText}
      />

      {/* New Brand Modal */}
      {showNewBrandModal && (
        <div className="modalOverlay" onClick={closeBrandModal}>
          <div className="modalContent" onClick={e => e.stopPropagation()} style={{ maxWidth: '560px' }}>
            <div className="modalHeader">
              <h2>Add New Brand</h2>
              <Button variant="ghost" size="small" onClick={closeBrandModal} disabled={isCreatingBrand}>
                <Icon name="x" size={20} />
              </Button>
            </div>
            <div className="modalBody">
              {/* Section 1: Brand Info */}
              <div className="brandModalSection">
                <div className="sectionHeader">
                  <Icon name="zap" size={14} />
                  Brand Info
                </div>
                <div className="settingItem">
                  <label className="settingLabel">Brand Name</label>
                  <Input
                    placeholder="e.g., Annexon, XCOPRI..."
                    value={newBrandName}
                    onChange={(e) => setNewBrandName(e.target.value)}
                    size="medium"
                    autoFocus
                    disabled={isCreatingBrand}
                  />
                </div>
                <div className="settingItem">
                  <label className="settingLabel">Client / Company</label>
                  <Input
                    placeholder="e.g., Annexon Biosciences"
                    value={newBrandClient}
                    onChange={(e) => setNewBrandClient(e.target.value)}
                    size="medium"
                    disabled={isCreatingBrand}
                  />
                </div>
              </div>

              {/* Section 2: Reference Library */}
              <div className="brandModalSection">
                <div className="sectionHeader">
                  <Icon name="fileText" size={14} />
                  Reference Library
                </div>
                <input
                  ref={brandFileInputRef}
                  type="file"
                  accept=".pdf,.docx,.doc"
                  multiple
                  onChange={handleBrandModalFileSelect}
                  hidden
                />
                <div
                  className={`dropZone ${isDragging ? 'dropZoneActive' : ''}`}
                  onClick={() => !isCreatingBrand && brandFileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleBrandModalDrop}
                >
                  <div className="dropZoneIcon">
                    <Icon name="upload" size={24} />
                  </div>
                  <p className="dropZoneText">
                    Drop files here or <strong>browse</strong>
                  </p>
                  <p className="dropZoneHint">PDF, DOCX, DOC</p>
                </div>
                {brandModalFiles.length > 0 && (
                  <div className="brandFileList">
                    {brandModalFiles.map((f, i) => (
                      <div key={i} className="brandFileItem">
                        <Icon name="file" size={14} style={{ flexShrink: 0, color: 'var(--color-text-tertiary)' }} />
                        <span className="brandFileName">{f.name}</span>
                        <span className="brandFileSize">{formatFileSize(f.size)}</span>
                        {f.status === 'uploading' && <Spinner size="small" />}
                        {f.status === 'done' && (
                          <span className="brandFileStatus"><Icon name="check" size={14} /></span>
                        )}
                        {f.status === 'error' && (
                          <Icon name="alertCircle" size={14} style={{ color: 'var(--color-status-error)' }} />
                        )}
                        {f.status === 'queued' && (
                          <button className="brandFileRemove" onClick={() => removeBrandModalFile(i)}>
                            <Icon name="x" size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Section 3: Team Access (placeholder) */}
              <div className="brandModalSection" style={{ position: 'relative' }}>
                <div className="sectionHeader">
                  <Icon name="user" size={14} />
                  Team Access
                </div>
                <span className="comingSoonBadge">Coming Soon</span>
                <div className="teamPlaceholder">
                  <div className="teamRow">
                    <Input
                      placeholder="Email address"
                      size="medium"
                      disabled
                    />
                    <select className="teamRoleSelect" disabled>
                      <option>Reviewer</option>
                      <option>Admin</option>
                      <option>Viewer</option>
                    </select>
                    <Button variant="secondary" size="medium" disabled>
                      Invite
                    </Button>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="modalActions">
                <Button variant="secondary" size="medium" onClick={closeBrandModal} disabled={isCreatingBrand}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="medium"
                  onClick={handleCreateBrand}
                  disabled={!newBrandName.trim() || isCreatingBrand}
                >
                  {!isCreatingBrand
                    ? (brandModalFiles.length > 0
                        ? `Create Brand & Upload ${brandModalFiles.length} File${brandModalFiles.length > 1 ? 's' : ''}`
                        : 'Create Brand')
                    : brandCreateStep === 'creating'
                      ? <><Spinner size="small" /> Creating brand...</>
                      : brandCreateStep === 'uploading'
                        ? <><Spinner size="small" /> Uploading {brandUploadIndex + 1}/{brandModalFiles.length}...</>
                        : <><Spinner size="small" /> Finishing...</>
                  }
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Reference Viewer Content - renders reference PDF with PDF.js canvas and a pin marker at the excerpt location
 */
function ReferenceViewerContent({ referenceId, page, excerpt }) {
  const [pdfDoc, setPdfDoc] = useState(null)
  const [currentPage, setCurrentPage] = useState(page || 1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pinY, setPinY] = useState(null)
  const [highlightRects, setHighlightRects] = useState([])
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const canvasRef = useRef(null)
  const textLayerRef = useRef(null)
  const containerRef = useRef(null)

  function normalizeForSearch(text) {
    return String(text || '')
      .replace(/\ufb01/g, 'fi')
      .replace(/\ufb02/g, 'fl')
      .replace(/\ufb00/g, 'ff')
      .replace(/\ufb03/g, 'ffi')
      .replace(/\ufb04/g, 'ffl')
      .replace(/\u00AD/g, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  }

  useEffect(() => {
    if (Number.isFinite(page) && page > 0) {
      setCurrentPage(Math.max(1, Math.floor(page)))
    }
  }, [page])

  // Load PDF blob into PDF.js
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        setError(null)
        setPinY(null)
        setHighlightRects([])
        const blob = await api.fetchReferenceFile(referenceId)
        if (cancelled) return
        const arrayBuffer = await blob.arrayBuffer()
        const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        if (cancelled) return
        setPdfDoc(doc)
        setTotalPages(doc.numPages)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [referenceId])

  // Render page to canvas and locate excerpt
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return
    let cancelled = false

    async function renderPage() {
      try {
        const pdfPage = await pdfDoc.getPage(currentPage)
        const containerWidth = containerRef.current?.clientWidth || 800
        const baseViewport = pdfPage.getViewport({ scale: 1 })
        const fitScale = Math.min(2.0, (containerWidth - 48) / baseViewport.width)
        const viewport = pdfPage.getViewport({ scale: fitScale })

        if (cancelled) return
        const canvas = canvasRef.current
        canvas.width = viewport.width
        canvas.height = viewport.height
        setCanvasSize({ width: viewport.width, height: viewport.height })

        await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        const textLayerDiv = textLayerRef.current

        // Render pdf.js text layer for DOM-based highlighting
        if (textLayerDiv) {
          textLayerDiv.innerHTML = ''
          textLayerDiv.style.width = `${viewport.width}px`
          textLayerDiv.style.height = `${viewport.height}px`
          const textLayer = new TextLayer({
            textContentSource: pdfPage.streamTextContent(),
            container: textLayerDiv,
            viewport,
          })
          await textLayer.render()
        }
        if (cancelled) return

        // Find excerpt Y position in this page
        if (excerpt && !cancelled) {
          async function findExcerptOnPage(pageNum) {
            const searchPage = await pdfDoc.getPage(pageNum)
            const textContent = await searchPage.getTextContent()
            const items = textContent.items.filter(i => i.str?.trim() && Array.isArray(i.transform))
            const pageText = normalizeForSearch(items.map(i => i.str).join(' '))
            const normalizedExcerpt = normalizeForSearch(excerpt)
            const candidateNeedles = [
              normalizedExcerpt.slice(0, 180),
              normalizedExcerpt.slice(0, 140),
              normalizedExcerpt.slice(0, 90),
            ].filter((candidate, index, arr) => candidate.length >= 24 && arr.indexOf(candidate) === index)

            let matchIdx = -1
            let matchedNeedle = ''
            for (const candidate of candidateNeedles) {
              const idx = pageText.indexOf(candidate)
              if (idx !== -1) {
                matchIdx = idx
                matchedNeedle = candidate
                break
              }
            }

            return { items, matchIdx, matchedNeedle, textContent, searchPage }
          }

          let searchResult = await findExcerptOnPage(currentPage)
          if (cancelled) return

          let actualPage = currentPage
          if (searchResult.matchIdx === -1 && !cancelled) {
            const pagesToTry = []
            if (currentPage > 1) pagesToTry.push(currentPage - 1)
            if (currentPage < totalPages) pagesToTry.push(currentPage + 1)

            for (const tryPage of pagesToTry) {
              const result = await findExcerptOnPage(tryPage)
              if (cancelled) return
              if (result.matchIdx !== -1) {
                searchResult = result
                actualPage = tryPage
                if (actualPage !== currentPage) {
                  setPinY(null)
                  setHighlightRects([])
                  setCurrentPage(actualPage)
                  return
                }
                break
              }
            }
          }

          const { items, matchIdx, matchedNeedle } = searchResult

          if (matchIdx !== -1) {
            // DOM-based highlighting via text layer spans
            if (textLayerDiv) {
              const spans = Array.from(textLayerDiv.querySelectorAll('span'))
              let charCount = 0
              const matchEnd = matchIdx + matchedNeedle.length
              let firstHighlightTop = null

              for (const span of spans) {
                const spanNormalized = normalizeForSearch(span.textContent || '')
                const itemStart = charCount
                const itemEnd = charCount + spanNormalized.length

                if (itemEnd > matchIdx && itemStart < matchEnd) {
                  span.style.backgroundColor = 'rgba(255, 193, 7, 0.35)'
                  span.style.borderRadius = '2px'
                  if (firstHighlightTop === null) {
                    firstHighlightTop = span.offsetTop
                  }
                }

                charCount += spanNormalized.length + 1
              }

              if (!cancelled) {
                setHighlightRects([])
                setPinY(firstHighlightTop)
              }
            } else {
              // Fallback: rect-based highlighting if text layer unavailable
              let charCount = 0
              const matchEnd = matchIdx + matchedNeedle.length
              const nextRects = []

              for (const item of items) {
                const itemStart = charCount
                const itemEnd = itemStart + item.str.length
                const overlaps = itemEnd >= matchIdx && itemStart <= matchEnd

                if (overlaps) {
                  const width = Math.max(6, (item.width || 0) * fitScale)
                  const height = Math.max(10, (item.height || 0) * fitScale)
                  const left = item.transform[4] * fitScale
                  const top = (baseViewport.height - item.transform[5]) * fitScale - height
                  nextRects.push({
                    left: Math.max(0, left),
                    top: Math.max(0, top),
                    width,
                    height
                  })
                }

                charCount += item.str.length + 1
              }

              if (!cancelled) {
                setHighlightRects(nextRects)
                setPinY(nextRects.length > 0 ? nextRects[0].top : null)
              }
            }
          } else {
            if (!cancelled) {
              setPinY(null)
              setHighlightRects([])
            }
          }
        } else if (!cancelled) {
          setPinY(null)
          setHighlightRects([])
        }
      } catch (err) {
        logger.error('Reference render error:', err)
      }
    }

    renderPage()
    return () => { cancelled = true }
  }, [pdfDoc, currentPage, excerpt, totalPages])

  // Scroll pin into view when located
  useEffect(() => {
    if (pinY !== null && containerRef.current) {
      containerRef.current.scrollTop = Math.max(0, pinY - containerRef.current.clientHeight / 3)
    }
  }, [pinY, canvasSize])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spinner size="large" />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--red-7)' }}>
        <Icon name="alertCircle" size={32} />
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Excerpt banner */}
      {excerpt && (
        <div style={{
          padding: '10px 16px',
          background: 'var(--gray-9)',
          borderBottom: '1px solid var(--gray-8)',
          fontSize: '13px',
          color: 'var(--gray-1)',
          display: 'flex',
          gap: 8,
          alignItems: 'baseline',
          lineHeight: 1.5,
        }}>
          <Icon name="mapPin" size={13} />
          <span style={{ opacity: 0.7, flexShrink: 0 }}>Supporting text:</span>
          <span style={{ fontStyle: 'italic' }}>&ldquo;{excerpt}&rdquo;</span>
        </div>
      )}

      {/* PDF canvas + pin overlay */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'auto', background: 'var(--gray-3)', padding: '16px 40px 16px 16px' }}
      >
        <div style={{ position: 'relative', width: canvasSize.width, margin: '0 auto' }}>
          <canvas ref={canvasRef} style={{ display: 'block', boxShadow: '0 2px 12px rgba(0,0,0,0.18)' }} />
          <div
            ref={textLayerRef}
            className='textLayer'
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              opacity: 0.3,
              lineHeight: 1,
            }}
          />

          {/* Text highlight overlay for matched supporting excerpt */}
          {highlightRects.length > 0 && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {highlightRects.map((rect, idx) => (
                <div
                  key={`${rect.left}-${rect.top}-${idx}`}
                  style={{
                    position: 'absolute',
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                    background: 'rgba(255, 193, 7, 0.28)',
                    border: '1px solid rgba(255, 152, 0, 0.7)',
                    borderRadius: 2,
                  }}
                />
              ))}
            </div>
          )}

          {/* Amber pin marker in the left margin */}
          {pinY !== null && (
            <div
              title={excerpt}
              style={{
                position: 'absolute',
                top: pinY,
                left: -30,
                width: 18,
                height: 18,
                background: 'var(--amber-5)',
                border: '2px solid var(--amber-7)',
                borderRadius: '50% 50% 50% 0',
                transform: 'rotate(-45deg)',
                boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                cursor: 'default',
              }}
            />
          )}
        </div>
      </div>

      {/* Page navigation */}
      {totalPages > 1 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: '8px 16px',
          borderTop: '1px solid var(--gray-3)',
          fontSize: 13,
          color: 'var(--gray-8)',
        }}>
          <Button variant="ghost" size="small" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}>
            <Icon name="chevronLeft" size={14} />
          </Button>
          <span>Page {currentPage} of {totalPages}</span>
          <Button variant="ghost" size="small" onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}>
            <Icon name="chevronRight" size={14} />
          </Button>
        </div>
      )}
    </div>
  )
}
