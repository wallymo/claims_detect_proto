import { useState, useRef, useEffect, useCallback } from 'react'
import '../App.css'
import './MKGClaimsDetector.css'

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

// Services
import { analyzeDocument as analyzeWithGemini, checkGeminiConnection, ALL_CLAIMS_PROMPT_USER, MEDICATION_PROMPT_USER, getDocTypeInstructions } from '@/services/gemini'
import { analyzeDocument as analyzeWithOpenAI } from '@/services/openai'
import { analyzeDocument as analyzeWithAnthropic } from '@/services/anthropic'
import { matchAllClaimsToReferences, getMatchingStats } from '@/services/referenceMatching'
import * as api from '@/services/api'

// Utils
import { pdfToImages } from '@/utils/pdfToImages'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`
import { enrichClaimsWithPositions, addGlobalIndices } from '@/utils/textMatcher'
import { logger } from '@/utils/logger'

// Model routing
const MODEL_ANALYZERS = {
  'gemini-3-pro': analyzeWithGemini,
  'claude-opus-4.6': analyzeWithAnthropic,
  'gpt-5.2-codex': analyzeWithOpenAI
}

const MODEL_OPTIONS = [
  { id: 'gemini-3-pro', label: 'Google Gemini 3 Pro' },
  { id: 'claude-opus-4.6', label: 'Claude Opus 4.6' },
  { id: 'gpt-5.2-codex', label: 'OpenAI GPT-5.2 Codex' }
]

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

const ANALYSIS_CACHE_NS = 'claims_analysis_v1'

function makeAnalysisCacheKey(file, model, promptKey, editablePrompt, docType, brandId, refIds) {
  let h = 0
  for (let i = 0; i < editablePrompt.length; i++) {
    h = (Math.imul(31, h) + editablePrompt.charCodeAt(i)) | 0
  }
  // Include a refs fingerprint so detection-only results don't collide with matched results.
  // Sort ref IDs for stable ordering regardless of load order.
  const refsFingerprint = refIds && refIds.length > 0 ? [...refIds].sort().join(',') : 'norefs'
  return `${ANALYSIS_CACHE_NS}|${file.name}|${file.size}|${file.lastModified}|${model}|${promptKey}|${docType}|${brandId || ''}|${h}|${refsFingerprint}`
}

function readAnalysisCache(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null') } catch { return null }
}

function writeAnalysisCache(key, claims) {
  try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), claims })) } catch { /* quota */ }
}

function deleteAnalysisCache(key) {
  try { sessionStorage.removeItem(key) } catch { /* ignore */ }
}

function formatTimeAgo(ts) {
  const d = Date.now() - ts
  if (d < 60000) return 'just now'
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`
  return `${Math.floor(d / 3600000)}h ago`
}

// ===== Fact Inventory =====

const FACT_INVENTORY_MAX_REFERENCES = 14
const FACT_INVENTORY_MAX_FACTS_PER_REFERENCE = 5
const FACT_INVENTORY_MAX_TOTAL_FACTS = 140
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
  const [selectedModel, setSelectedModel] = useState('gemini-3-pro')
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
  const [pendingReanalyzeConfirm, setPendingReanalyzeConfirm] = useState(false)
  const currentCacheKeyRef = useRef(null)

  // Claims state
  const [claims, setClaims] = useState([])
  const [activeClaimId, setActiveClaimId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState('annotation')
  const [showClaimPins, setShowClaimPins] = useState(true)

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
  const [trainingSessions, setTrainingSessions] = useState([])
  const [currentTrainingSessionId, setCurrentTrainingSessionId] = useState(null)
  const [approvedClaimsForSession, setApprovedClaimsForSession] = useState([])
  const [trainingExamples, setTrainingExamples] = useState([])
  const [showTrainingOverlay, setShowTrainingOverlay] = useState(false)

  const claimsListRef = useRef(null)
  const claimsPanelRef = useRef(null)

  // Keep trainingExamples in sync with trainingSessions so prompt examples
  // reflect any approve/reject mutations without needing a brand reload
  useEffect(() => {
    const allApproved = trainingSessions.flatMap(s => s.approved_claims || []).slice(0, 20)
    setTrainingExamples(allApproved)
  }, [trainingSessions])

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

  // Load training sessions and examples when brand changes
  useEffect(() => {
    if (selectedBrandId) {
      loadTrainingSessions(selectedBrandId)
    } else {
      setTrainingSessions([])
      setTrainingExamples([])
    }
  }, [selectedBrandId])

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

  // Ensure claims have global indices
  useEffect(() => {
    setClaims(prev => {
      if (!prev.length) return prev
      const missing = prev.some(c => !c.globalIndex)
      if (!missing) return prev
      return addGlobalIndices(prev)
    })
  }, [])

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

  async function loadTrainingSessions(brandId) {
    try {
      const sessions = await api.getTrainingSessions(brandId)
      setTrainingSessions(sessions)
    } catch (err) {
      logger.warn('Could not load training sessions:', err.message)
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
      setMatchingStats(null)
    }, 500)
  }

  const handleUploadClick = () => fileInputRef.current?.click()

  const handleRemoveDocument = () => {
    setUploadedFile(null)
    setUploadState('empty')
    setClaims([])
    setAnalysisComplete(false)
    setMatchingComplete(false)
    setAnalysisError(null)
    setMatchingStats(null)
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

  const handleAnalyze = async () => {
    if (!uploadedFile) return

    const _promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
    const _refIds = referenceDocuments.map(r => r.id)
    const _cacheKey = makeAnalysisCacheKey(
      uploadedFile, selectedModel, _promptKey, editablePrompt,
      selectedDocType || 'speaker-notes', selectedBrandId, _refIds
    )
    currentCacheKeyRef.current = _cacheKey
    const _cached = readAnalysisCache(_cacheKey)
    if (_cached) {
      setClaims(_cached.claims)
      setCacheHit({ ts: _cached.ts })
      setAnalysisComplete(true)
      setMatchingComplete(true)
      setAnalysisProgress(100)
      setAnalysisStatus('Claims detected')
      setAnalysisError(null)
      setMatchingStats(null)
      setIsAnalyzing(false)
      return
    }
    setCacheHit(null)

    setIsAnalyzing(true)
    setAnalysisComplete(false)
    setMatchingComplete(false)
    setAnalysisError(null)
    setAnalysisProgress(0)
    setAnalysisStatus('Starting...')
    setMatchingStats(null)
    const analysisStartedAt = Date.now()

    try {
      const analyzeDocument = MODEL_ANALYZERS[selectedModel] || analyzeWithGemini
      const promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
      const isGemini = selectedModel === 'gemini-3-pro'

      if (isGemini) {
        setAnalysisProgress(5)
        setAnalysisStatus('Checking connection...')
        const connectionCheck = await checkGeminiConnection()
        if (!connectionCheck.connected) {
          throw new Error(`Gemini API not connected: ${connectionCheck.error}`)
        }
      }

      let pageImages = null
      if (!isGemini) {
        setAnalysisStatus('Rendering pages for vision analysis...')
        setAnalysisProgress(15)
        pageImages = await pdfToImages(uploadedFile)
      }

      // Fetch fact inventory for brand-grounded detection (POC2)
      let factInventory = ''
      const factBrandId = libraryBrandId || selectedBrandId
      if (factBrandId) {
        try {
          const factRefs = await api.fetchFactsSummary(factBrandId)
          const indexedRefs = factRefs.filter(r => r.extraction_status === 'indexed' && r.facts_count > 0)
          if (indexedRefs.length > 0) {
            const candidateRefs = indexedRefs.slice(0, FACT_INVENTORY_MAX_REFERENCES)
            const lines = []
            let totalFacts = 0
            let totalChars = FACT_INVENTORY_HEADER.length
            let truncated = candidateRefs.length < indexedRefs.length

            for (const ref of candidateRefs) {
              if (totalFacts >= FACT_INVENTORY_MAX_TOTAL_FACTS) {
                truncated = true
                break
              }

              // Fetch facts for indexed references, then cap per reference and total prompt size.
              const factsData = await api.fetchFacts(factBrandId, ref.reference_id)
              const facts = Array.isArray(factsData.facts) ? factsData.facts : []
              let perReferenceFacts = 0

              for (const fact of facts) {
                if (perReferenceFacts >= FACT_INVENTORY_MAX_FACTS_PER_REFERENCE) {
                  truncated = true
                  break
                }
                if (totalFacts >= FACT_INVENTORY_MAX_TOTAL_FACTS) {
                  truncated = true
                  break
                }

                const factText = normalizeFactText(fact.text)
                if (!factText) continue

                const category = String(fact.category || '').replace(/\s+/g, ' ').trim()
                const line = `- [${ref.display_alias}] ${factText}${category ? ` | ${category}` : ''}`

                if (totalChars + line.length + 1 > FACT_INVENTORY_MAX_CHARS) {
                  truncated = true
                  break
                }

                lines.push(line)
                perReferenceFacts += 1
                totalFacts += 1
                totalChars += line.length + 1
              }

              if (totalChars >= FACT_INVENTORY_MAX_CHARS) {
                truncated = true
                break
              }
            }

            if (lines.length > 0) {
              factInventory = `${FACT_INVENTORY_HEADER}${lines.join('\n')}`
              if (truncated) {
                factInventory += '\n- [context] Additional indexed facts were omitted for brevity. Treat this inventory as optional background only.'
              }
            }
            logger.info(
              `Loaded ${lines.length} fact lines from up to ${candidateRefs.length}/${indexedRefs.length} indexed references (truncated=${truncated})`
            )
          }
        } catch (err) {
          logger.warn('Could not load fact inventory:', err.message)
        }
      }

      const result = await analyzeDocument(uploadedFile, (progress, status) => {
        setAnalysisProgress(progress)
        setAnalysisStatus(status)
      }, promptKey, editablePrompt, pageImages, selectedDocType || 'speaker-notes', factInventory, trainingExamples)

      if (!result.success) throw new Error(result.error || 'Analysis failed')

      // Process claims
      const claimsNeedingPositions = result.claims.filter(c => !c.position)
      const claimsWithPositions = claimsNeedingPositions.length > 0 && extractedPages.length > 0
        ? enrichClaimsWithPositions(result.claims, extractedPages)
        : result.claims

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

      // Auto-create training session for this analysis run
      setApprovedClaimsForSession([])
      setCurrentTrainingSessionId(null)
      if (selectedBrandId && uploadedFile) {
        api.createTrainingSession({
          brand_id: selectedBrandId,
          label: uploadedFile.name,
          document_name: uploadedFile.name,
          approved_claims: [],
          prompt_text: editablePrompt
        }).then(session => {
          setCurrentTrainingSessionId(session.id)
          setTrainingSessions(prev => [session, ...prev])
        }).catch(err => logger.warn('Could not create training session:', err.message))
      }

      logger.info({
        event: 'mkg2_analysis_summary',
        analysis_total_ms: analysisTotalMs,
        total_claims: indexedClaims.length,
        model: selectedModel,
        doc_type: selectedDocType
      })

      // Step 2: Auto-trigger reference matching (or cache detection-only result)
      if (selectedBrandId && referenceDocuments.length > 0) {
        await runReferenceMatching(indexedClaims, analysisTotalMs)
      } else {
        writeAnalysisCache(currentCacheKeyRef.current, indexedClaims)
      }
    } catch (error) {
      logger.error('Analysis error:', error)
      setAnalysisError(error.message)
      setIsAnalyzing(false)
    }
  }

  const handleForceRerun = () => {
    if (currentCacheKeyRef.current) {
      deleteAnalysisCache(currentCacheKeyRef.current)
      currentCacheKeyRef.current = null
    }
    setCacheHit(null)
    handleAnalyze()
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

  const runReferenceMatching = async (detectedClaims, analysisTotalMs = null) => {
    setIsMatching(true)
    setMatchingProgress('Preparing semantic retrieval...')
    const matchingStartedAt = Date.now()
    const pendingClaimUpdates = new Map()
    let flushHandle = null

    const applyPendingClaimUpdates = () => {
      if (!pendingClaimUpdates.size) return

      const updates = new Map(pendingClaimUpdates)
      pendingClaimUpdates.clear()

      setClaims(prev => {
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

    try {
      if (!detectedClaims.length) {
        setMatchingProgress('No claims detected for matching')
        setIsMatching(false)
        return
      }

      const referencesForMatch = referenceDocuments.map(ref => ({
        id: ref.id,
        display_alias: ref.name
      }))

      if (referencesForMatch.length === 0) {
        setMatchingProgress('No references available for matching')
        setIsMatching(false)
        return
      }

      const matchBrandId = libraryBrandId || selectedBrandId
      if (!matchBrandId) {
        throw new Error('No brand selected for reference matching')
      }

      const { claims: enrichedClaims, telemetry } = await matchAllClaimsToReferences(
        detectedClaims,
        referencesForMatch,
        ({ current, total, claimIndex, stage }) => {
          const claimNumber = stage === 'done'
            ? current
            : claimIndex || Math.min(current + 1, total)

          if (stage === 'retrieve') {
            setMatchingProgress(`Retrieving candidates for claim ${claimNumber} of ${total}...`)
            return
          }

          if (stage === 'confirm') {
            setMatchingProgress(`Confirming support for claim ${claimNumber} of ${total}...`)
            return
          }

          if (stage === 'fallback') {
            setMatchingProgress(`Running fallback matching for claim ${claimNumber} of ${total}...`)
            return
          }

          setMatchingProgress(`Matched claim ${claimNumber} of ${total}...`)
        },
        matchBrandId,
        {
          onClaimResult: ({ claim }) => {
            if (!claim?.id) return
            pendingClaimUpdates.set(claim.id, claim)

            // Flush immediately when enough updates accumulate to keep UI responsive
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
        }
      )

      if (flushHandle) {
        clearTimeout(flushHandle)
        flushHandle = null
      }
      applyPendingClaimUpdates()

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
      if (currentCacheKeyRef.current) {
        writeAnalysisCache(currentCacheKeyRef.current, enrichedClaims)
      }
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
      logger.error('Reference matching error:', error)
      setMatchingProgress(`Matching error: ${error.message}`)
    } finally {
      if (flushHandle) {
        clearTimeout(flushHandle)
      }
      applyPendingClaimUpdates()
      setIsMatching(false)
    }
  }

  // ===== Fallback position enrichment =====

  useEffect(() => {
    if (!analysisComplete || extractedPages.length === 0) return
    setClaims(prev => {
      if (!prev.length) return prev
      const needsReposition = prev.some(c => !c.position || c.position?.source === 'fallback')
      if (!needsReposition) return prev
      const refreshed = enrichClaimsWithPositions(prev, extractedPages)
      const withIndexes = refreshed.map(claim => {
        const existing = prev.find(c => c.id === claim.id)
        return { ...claim, globalIndex: existing?.globalIndex, matched: existing?.matched, reference: existing?.reference }
      })
      const missingIndex = withIndexes.some(c => !c.globalIndex)
      return missingIndex ? addGlobalIndices(withIndexes) : withIndexes
    })
  }, [analysisComplete, extractedPages])

  // ===== Claim Actions =====

  const handleClaimApprove = (claimId) => {
    setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'approved' } : c))
    const claim = claims.find(c => c.id === claimId)
    if (!claim) return

    // Add to training session approved claims
    const trainingClaim = {
      text: claim.text,
      type: 'Claim',
      confidence: claim.confidence,
      reference: claim.reference ? { id: claim.reference.id, name: claim.reference.name } : null
    }
    const nextApproved = [...approvedClaimsForSession.filter(c => c.text !== claim.text), trainingClaim]
    setApprovedClaimsForSession(nextApproved)
    if (currentTrainingSessionId) {
      api.updateTrainingSessionClaims(currentTrainingSessionId, nextApproved)
        .then(updated => {
          setTrainingSessions(prev => prev.map(s => s.id === updated.id ? updated : s))
        })
        .catch(err => logger.warn('Training session update failed:', err.message))
    }

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

    // Update training session — remove false_positives, keep the rest with corrections
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
      const nextApproved = [...approvedClaimsForSession.filter(c => c.text !== claim.text), trainingClaim]
      setApprovedClaimsForSession(nextApproved)
      if (currentTrainingSessionId) {
        api.updateTrainingSessionClaims(currentTrainingSessionId, nextApproved)
          .then(updated => {
            setTrainingSessions(prev => prev.map(s => s.id === updated.id ? updated : s))
          })
          .catch(err => logger.warn('Training session update failed:', err.message))
      }
    } else {
      // false_positive: remove from approved if it was previously added
      const nextApproved = approvedClaimsForSession.filter(c => c.text !== claim.text)
      if (nextApproved.length !== approvedClaimsForSession.length) {
        setApprovedClaimsForSession(nextApproved)
        if (currentTrainingSessionId) {
          api.updateTrainingSessionClaims(currentTrainingSessionId, nextApproved)
            .then(updated => {
              setTrainingSessions(prev => prev.map(s => s.id === updated.id ? updated : s))
            })
            .catch(err => logger.warn('Training session update failed:', err.message))
        }
      }
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
    if (claimId && claimsListRef.current) {
      const cardEl = claimsListRef.current.querySelector(`[data-claim-id="${claimId}"]`)
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
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

  // ===== Training Data Actions =====

  const handleDeleteTrainingSession = async (sessionId) => {
    try {
      await api.deleteTrainingSession(sessionId)
      setTrainingSessions(prev => prev.filter(s => s.id !== sessionId))
      if (currentTrainingSessionId === sessionId) setCurrentTrainingSessionId(null)
    } catch (err) {
      logger.error('Delete training session error:', err)
    }
  }

  const handleClearTrainingSessions = async () => {
    if (!selectedBrandId) return
    try {
      await api.clearTrainingSessions(selectedBrandId)
      setTrainingSessions([])
      setTrainingExamples([])
      setCurrentTrainingSessionId(null)
      setApprovedClaimsForSession([])
    } catch (err) {
      logger.error('Clear training sessions error:', err)
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
  const matchedRateLabel = matchingStats ? `${matchingStats.matchRate}%` : 'N/A'

  const analysisMs = processingTime || 0
  const matchingMs = matchingStats?.matching_total_ms || 0
  const endToEndMs = analysisMs + matchingMs

  const claimDetectionRunCost = lastUsage?.cost || 0
  const referenceMatchingRunCost = matchingStats?.matching_ai_cost || 0
  const totalRunAICost = claimDetectionRunCost + referenceMatchingRunCost

  // Always show all claims — better to over-flag than miss a claim
  const displayedClaims = claims
    .filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (searchQuery && !c.text.toLowerCase().includes(searchQuery.toLowerCase())) return false
      if (sortOrder === 'no-matches' && c.matched) return false
      return true
    })
    .sort((a, b) => {
      if (sortOrder === 'annotation' || sortOrder === 'no-matches') return (a.globalIndex ?? 0) - (b.globalIndex ?? 0)
      if (sortOrder === 'confidence-desc') return b.confidence - a.confidence
      return a.confidence - b.confidence
    })

  const canAnalyze = uploadedFile && !isAnalyzing && !isMatching

  const selectedBrand = brands.find(b => b.id === selectedBrandId)

  return (
    <div className="page">
      <div className="header">
        <div className="headerLeft">
          <div className="titleSection">
            <h1 className="title">Claims Detector</h1>
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
            {trainingSessions.length > 0 && (
              <span className="trainingBadgeDot" />
            )}
          </button>
          <ThemeToggle />
        </div>
      </div>

      <div className="workbenchWrapper">
        <div className="workbench">
          {/* ===== LEFT: Config Panel ===== */}
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
                    <DropdownMenu
                      trigger="button"
                      triggerLabel={MODEL_OPTIONS.find(m => m.id === selectedModel)?.label || 'Select model...'}
                      items={MODEL_OPTIONS.map(item => ({
                        ...item,
                        onClick: () => setSelectedModel(item.id)
                      }))}
                      size="medium"
                    />
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

            {analysisComplete && (
              <Button
                variant="ghost"
                size="small"
                onClick={handleForceRerun}
                disabled={isAnalyzing || isMatching}
              >
                <Icon name="refreshCw" size={14} />
                Re-analyze
              </Button>
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
                        <span className="resultValue">{lastUsage?.modelDisplayName || 'Gemini 3 Pro'}</span>
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
                        <span className="resultValue">{(endToEndMs / 1000).toFixed(1)}s</span>
                      </div>
                      <div className="resultRow">
                        <span className="resultLabel">Claim Detection Time</span>
                        <span className="resultValue">{(analysisMs / 1000).toFixed(1)}s</span>
                      </div>
                      <div className="resultRow">
                        <span className="resultLabel">Reference Matching Time</span>
                        <span className="resultValue">{matchingStats ? `${(matchingMs / 1000).toFixed(1)}s` : 'N/A'}</span>
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
              </>
            )}
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
              activeClaimId={activeClaimId}
              onClaimSelect={handleClaimSelect}
              onTextExtracted={handleTextExtracted}
              claimsPanelRef={claimsPanelRef}
              showPins={showClaimPins}
              onTogglePins={() => setShowClaimPins(prev => !prev)}
            />
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
                  Claims{claims.length > 0 ? ` (${claims.length})` : ''}
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

                    {analysisComplete && displayedClaims.length === 0 && (
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

                    {analysisComplete && displayedClaims.map(claim => (
                      <div key={claim.id} data-claim-id={claim.id}>
                        <MKGClaimCard
                          claim={claim}
                          isActive={activeClaimId === claim.id}
                          onApprove={handleClaimApprove}
                          onReject={handleClaimReject}
                          onSelect={() => handleClaimSelect(claim.id)}
                          onViewSource={() => handleViewSource(claim)}
                          brandReferences={referenceDocuments}
                        />
                      </div>
                    ))}
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
        sessions={trainingSessions}
        onDeleteSession={handleDeleteTrainingSession}
        onClearAll={handleClearTrainingSessions}
        onExport={handleExportTrainingSessions}
        hasActiveBrand={!!selectedBrandId}
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
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const canvasRef = useRef(null)
  const containerRef = useRef(null)

  // Load PDF blob into PDF.js
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
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

        // Find excerpt Y position in this page
        if (excerpt && !cancelled) {
          const textContent = await pdfPage.getTextContent()
          if (cancelled) return

          const items = textContent.items.filter(i => i.str?.trim())
          const pageText = items.map(i => i.str).join(' ').toLowerCase()
          // Use first 60 chars of excerpt as search needle (specific enough to locate the paragraph)
          const needle = excerpt.toLowerCase().trim().slice(0, 60)
          const matchIdx = pageText.indexOf(needle)

          if (matchIdx !== -1) {
            let charCount = 0
            for (const item of items) {
              if (charCount + item.str.length >= matchIdx) {
                // Convert PDF y (bottom-up) to canvas y (top-down)
                const yCanvas = (baseViewport.height - item.transform[5]) * fitScale
                if (!cancelled) setPinY(Math.max(0, yCanvas - item.height * fitScale))
                break
              }
              charCount += item.str.length + 1
            }
          } else {
            if (!cancelled) setPinY(null)
          }
        }
      } catch (err) {
        logger.error('Reference render error:', err)
      }
    }

    renderPage()
    return () => { cancelled = true }
  }, [pdfDoc, currentPage, excerpt])

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
