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

// Services
import { analyzeDocument as analyzeWithGemini, checkGeminiConnection, ALL_CLAIMS_PROMPT_USER, MEDICATION_PROMPT_USER, getDocTypeInstructions } from '@/services/gemini'
import { analyzeDocument as analyzeWithOpenAI } from '@/services/openai'
import { analyzeDocument as analyzeWithAnthropic } from '@/services/anthropic'
import { matchAllClaimsToReferences, getMatchingStats } from '@/services/referenceMatching'
import * as api from '@/services/api'

// Utils
import { pdfToImages } from '@/utils/pdfToImages'
import { enrichClaimsWithPositions, addGlobalIndices } from '@/utils/textMatcher'
import { logger } from '@/utils/logger'

// Model routing
const MODEL_ANALYZERS = {
  'gemini-3-pro': analyzeWithGemini,
  'claude-sonnet-4.5': analyzeWithAnthropic,
  'gpt-4o': analyzeWithOpenAI
}

const MODEL_OPTIONS = [
  { id: 'gemini-3-pro', label: 'Google Gemini 3 Pro' },
  { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { id: 'gpt-4o', label: 'OpenAI GPT-4o' }
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

export default function MKG2ClaimsDetector() {
  // Document state
  const [uploadedFile, setUploadedFile] = useState(null)
  const [uploadState, setUploadState] = useState('empty')
  const fileInputRef = useRef(null)

  // Settings state
  const [selectedModel, setSelectedModel] = useState('gemini-3-pro')
  const [selectedPrompt, setSelectedPrompt] = useState('all-claims')
  const [editablePrompt, setEditablePrompt] = useState('')
  const [isEditingPrompt, setIsEditingPrompt] = useState(false)
  const [selectedDocType, setSelectedDocType] = useState('speaker-notes')
  // AI Discovery always on — show all claims, over-flag rather than miss

  // Brand state
  const [brands, setBrands] = useState([])
  const [selectedBrandId, setSelectedBrandId] = useState(null)
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
  const [matchingComplete, setMatchingComplete] = useState(false)
  const [matchingProgress, setMatchingProgress] = useState('')
  const [matchingStats, setMatchingStats] = useState(null)

  // Claims state
  const [claims, setClaims] = useState([])
  const [activeClaimId, setActiveClaimId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState('high-low')
  const [showClaimPins, setShowClaimPins] = useState(true)

  // Cost tracking
  const [lastUsage, setLastUsage] = useState(null)
  const [totalCost, setTotalCost] = useState(0)
  const [sessionCost, setSessionCost] = useState(0)

  // Text extraction
  const [extractedPages, setExtractedPages] = useState([])

  // Library state
  const [referenceDocuments, setReferenceDocuments] = useState([])
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false)
  const [isUploadingRef, setIsUploadingRef] = useState(false)

  // Folder state
  const [folders, setFolders] = useState([])
  const [activeFolderId, setActiveFolderId] = useState(null)

  // Right panel tab: 0 = Claims, 1 = Library
  const [rightPanelTab, setRightPanelTab] = useState(0)

  // Reference viewer overlay
  const [referenceViewerData, setReferenceViewerData] = useState(null)

  const claimsListRef = useRef(null)
  const claimsPanelRef = useRef(null)

  // Load brands, references, and folders on mount
  useEffect(() => {
    loadBrands()
    loadFolders()
  }, [])

  // Reload references when brand changes — library is brand-scoped
  useEffect(() => {
    if (selectedBrandId) {
      loadBrandReferences(selectedBrandId)
    } else {
      setReferenceDocuments([])
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
      // Filter out the internal reference library — it's not a selectable brand
      const selectableBrands = allBrands.filter(b => b.name !== 'MKG Reference Library' && b.name !== 'AI Only')
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

    setIsAnalyzing(true)
    setAnalysisComplete(false)
    setMatchingComplete(false)
    setAnalysisError(null)
    setAnalysisProgress(0)
    setAnalysisStatus('Starting...')
    setMatchingStats(null)
    const startTime = Date.now()

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
      if (selectedBrandId) {
        try {
          const factRefs = await api.fetchFactsSummary(selectedBrandId)
          const indexedRefs = factRefs.filter(r => r.extraction_status === 'indexed' && r.facts_count > 0)
          if (indexedRefs.length > 0) {
            const lines = []
            for (const ref of indexedRefs) {
              // Fetch full facts for each indexed reference
              const factsData = await api.fetchFacts(selectedBrandId, ref.reference_id)
              if (factsData.facts?.length > 0) {
                for (const fact of factsData.facts) {
                  lines.push(`- [${ref.display_alias}] ${fact.text} | ${fact.category}`)
                }
              }
            }
            if (lines.length > 0) {
              factInventory = `\n\nREFERENCE FACT INVENTORY (use these known facts to identify substantiable claims):\n${lines.join('\n')}`
            }
            logger.info(`Loaded ${lines.length} facts from ${indexedRefs.length} indexed references`)
          }
        } catch (err) {
          logger.warn('Could not load fact inventory:', err.message)
        }
      }

      const result = await analyzeDocument(uploadedFile, (progress, status) => {
        setAnalysisProgress(progress)
        setAnalysisStatus(status)
      }, promptKey, editablePrompt, pageImages, selectedDocType || 'speaker-notes', factInventory)

      if (!result.success) throw new Error(result.error || 'Analysis failed')

      // Process claims
      const claimsNeedingPositions = result.claims.filter(c => !c.position)
      const claimsWithPositions = claimsNeedingPositions.length > 0 && extractedPages.length > 0
        ? enrichClaimsWithPositions(result.claims, extractedPages)
        : result.claims

      const indexedClaims = addGlobalIndices(claimsWithPositions)
      setClaims(indexedClaims)
      setProcessingTime(Date.now() - startTime)

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

      // Step 2: Auto-trigger reference matching
      if (selectedBrandId && referenceDocuments.length > 0) {
        await runReferenceMatching(indexedClaims)
      }
    } catch (error) {
      logger.error('Analysis error:', error)
      setAnalysisError(error.message)
      setIsAnalyzing(false)
    }
  }

  // ===== Reference Matching (Step 2) =====

  const runReferenceMatching = async (detectedClaims) => {
    setIsMatching(true)
    setMatchingProgress('Loading reference texts...')

    try {
      // Fetch full text for all references
      const refsWithText = await Promise.all(
        referenceDocuments.map(async (ref) => {
          try {
            const textData = await api.fetchReferenceText(ref.id)
            return {
              id: ref.id,
              display_alias: ref.name,
              content_text: textData.content_text
            }
          } catch {
            return {
              id: ref.id,
              display_alias: ref.name,
              content_text: null
            }
          }
        })
      )

      const validRefs = refsWithText.filter(r => r.content_text)
      if (validRefs.length === 0) {
        setMatchingProgress('No reference texts available for matching')
        setIsMatching(false)
        return
      }

      setMatchingProgress(`Matching claims to ${validRefs.length} references...`)

      // Fetch brand facts for Tier 0 matching
      let brandFacts = []
      if (selectedBrandId) {
        try {
          const factRefs = await api.fetchFactsSummary(selectedBrandId)
          const indexedRefIds = factRefs
            .filter(r => r.extraction_status === 'indexed' && r.facts_count > 0)
            .map(r => r.reference_id)

          if (indexedRefIds.length > 0) {
            const factsResults = await Promise.all(
              indexedRefIds.map(refId => api.fetchFacts(selectedBrandId, refId))
            )
            brandFacts = factsResults.map(r => ({
              reference_id: r.reference_id,
              display_alias: validRefs.find(v => v.id === r.reference_id)?.display_alias || '',
              facts: r.facts || [],
              confirmed_count: r.confirmed_count || 0,
              rejected_count: r.rejected_count || 0
            }))
            logger.info(`Loaded facts from ${brandFacts.length} refs for Tier 0 matching`)
          }
        } catch (err) {
          logger.warn('Could not load brand facts for matching:', err.message)
        }
      }

      const enrichedClaims = await matchAllClaimsToReferences(
        detectedClaims,
        validRefs,
        (current, total) => {
          setMatchingProgress(`Matching claim ${current} of ${total}...`)
        },
        brandFacts
      )

      setClaims(enrichedClaims)
      const stats = getMatchingStats(enrichedClaims)
      setMatchingStats(stats)
      setMatchingComplete(true)
      setMatchingProgress('')
    } catch (error) {
      logger.error('Reference matching error:', error)
      setMatchingProgress(`Matching error: ${error.message}`)
    } finally {
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
    // Fire-and-forget to backend
    const claim = claims.find(c => c.id === claimId)
    if (claim) {
      api.createFeedback({
        claim_id: claimId,
        document_id: uploadedFile?.name,
        reference_doc_id: claim.reference?.id || null,
        decision: 'approved',
        confidence_score: claim.confidence
      }).catch(err => logger.error('Feedback save error:', err))
    }
  }

  const handleClaimReject = (claimId, feedback) => {
    setClaims(prev => prev.map(c => c.id === claimId ? { ...c, status: 'rejected', feedback } : c))
    const claim = claims.find(c => c.id === claimId)
    if (claim) {
      api.createFeedback({
        claim_id: claimId,
        document_id: uploadedFile?.name,
        reference_doc_id: claim.reference?.id || null,
        decision: 'rejected',
        reason: feedback,
        confidence_score: claim.confidence
      }).catch(err => logger.error('Feedback save error:', err))
    }
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

  // ===== Library Actions =====

  const handleReferenceUpload = async (file) => {
    if (!file) return
    // Use first available brand for POC, or selected brand
    const brandId = selectedBrandId || brands[0]?.id
    if (!brandId) {
      logger.error('No brand available for upload')
      return
    }
    setIsUploadingRef(true)
    try {
      await api.uploadReference(brandId, file)
      await loadBrandReferences(brandId)
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
      setReferenceDocuments(prev => prev.filter(d => d.id !== docId))
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
      setReferenceDocuments(prev => prev.filter(doc => !ids.includes(doc.id)))
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
      if (selectedBrandId) await loadBrandReferences(selectedBrandId)
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

  // Always show all claims — better to over-flag than miss a claim
  const displayedClaims = claims
    .filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (searchQuery && !c.text.toLowerCase().includes(searchQuery.toLowerCase())) return false
      return true
    })
    .sort((a, b) => sortOrder === 'high-low'
      ? b.confidence - a.confidence
      : a.confidence - b.confidence
    )

  const canAnalyze = uploadedFile && !isAnalyzing && !isMatching

  const selectedBrand = brands.find(b => b.id === selectedBrandId)

  return (
    <div className="page">
      <div className="header">
        <div className="headerLeft">
          <div className="titleSection">
            <h1 className="title">MKG Claims Detector</h1>
            <Badge variant="info">POC2</Badge>
          </div>
          <p className="subtitle">
            AI-powered claim detection and reference matching for MLR submissions
          </p>
        </div>
        <div className="headerRight">
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

            {analysisError && (
              <div className="analysisError">
                <Icon name="alertCircle" size={16} />
                <span>{analysisError}</span>
              </div>
            )}

            {!selectedBrandId && (
              <div className="analysisError" style={{ background: 'var(--amber-1)', borderColor: 'var(--amber-6)', color: 'var(--amber-9)' }}>
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
                        <span className="resultLabel">Latency</span>
                        <span className="resultValue">{(processingTime / 1000).toFixed(1)}s</span>
                      </div>
                      <div className="divider" />
                      <div className="resultRow">
                        <span className="resultLabel">Run Cost</span>
                        <span className="resultValue">${lastUsage?.cost?.toFixed(4) || '0.0000'}</span>
                      </div>
                      <div className="resultRow">
                        <span className="resultLabel">Session</span>
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
                  {/* Matching progress */}
                  {isMatching && (
                    <div style={{
                      padding: '12px 16px',
                      background: 'var(--blue-1)',
                      borderBottom: '1px solid var(--blue-3)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      color: 'var(--blue-8)'
                    }}>
                      <Spinner size="small" />
                      <span>{matchingProgress}</span>
                    </div>
                  )}

                  {analysisComplete && (
                    <div className="claimsFilterBar">
                      <div className="statusToggleGroup">
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
                        <button
                          className="sortToggle"
                          onClick={() => setSortOrder(prev => prev === 'high-low' ? 'low-high' : 'high-low')}
                        >
                          Confidence {sortOrder === 'high-low' ? '↓' : '↑'}
                        </button>
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
                        />
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <LibraryTab
                  documents={referenceDocuments}
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
 * Reference Viewer Content - renders reference PDF in the overlay
 */
function ReferenceViewerContent({ referenceId, page, excerpt }) {
  const [pdfUrl, setPdfUrl] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let revoked = false
    async function loadPdf() {
      try {
        setLoading(true)
        const blob = await api.fetchReferenceFile(referenceId)
        if (revoked) return
        const url = URL.createObjectURL(blob)
        setPdfUrl(url)
      } catch (err) {
        if (!revoked) setError(err.message)
      } finally {
        if (!revoked) setLoading(false)
      }
    }
    loadPdf()
    return () => {
      revoked = true
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [referenceId])

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

  // Use browser's native PDF viewer via iframe
  const pageParam = page ? `#page=${page}` : ''
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {excerpt && (
        <div style={{
          padding: '12px 16px',
          background: 'var(--green-1)',
          borderBottom: '1px solid var(--green-3)',
          fontSize: '13px',
          color: 'var(--green-9)'
        }}>
          <strong>Supporting text:</strong> "{excerpt}"
          {page && <span style={{ marginLeft: '8px', color: 'var(--green-7)' }}>(Page {page})</span>}
        </div>
      )}
      <iframe
        src={`${pdfUrl}${pageParam}`}
        style={{ flex: 1, border: 'none', width: '100%' }}
        title="Reference PDF"
      />
    </div>
  )
}
