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
import MissedClaimForm from '@/components/mkg/MissedClaimForm/MissedClaimForm'
import Alert from '@/components/molecules/Alert/Alert'

// Services
import { MEDICATION_PROMPT_USER, getDocTypeInstructions, GEMINI_MODEL, MODEL_DISPLAY_NAMES, AI_QA_PROMPT_USER } from '@/services/gemini'
import * as api from '@/services/api'

// Utils
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl
import { addGlobalIndices } from '@/utils/textMatcher'
import { dedupeClaimsByPageAndText } from '@/utils/claimDedup'
import { summarizeAnnotationClaims } from '@/utils/annotationSummary'
import { logger } from '@/utils/logger'
import { charOffsetToPage, resolveCitationPdfPage } from '@/utils/referenceViewerHints'

const ACTIVE_MODEL_LABEL = MODEL_DISPLAY_NAMES[GEMINI_MODEL] || GEMINI_MODEL

const PROMPT_OPTIONS = [
  { id: 'all-claims', label: 'All Claims', promptKey: 'all' },
  { id: 'disease-state', label: 'Disease State', promptKey: 'disease' },
  { id: 'medication', label: 'Medication', promptKey: 'drug' }
]

const ANNOTATION_POSITIONING_DISPLAY = `--- PYMUPDF ANNOTATION ENGINE ---

Step 1: PyMuPDF extracts text spans, superscripts, and coordinates from the PDF (deterministic, no AI)
Step 2: Parser splits each page into slide and speaker-notes regions and builds page-local reference pools:
  - Slide footnotes at the bottom of the slide
  - Notes references after the "References" header
Step 3: Each superscript-backed statement resolves only against its own region's pool
  - Slide candidates → same-page slide footnotes
  - Notes candidates → same-page notes references
Step 4: Orphan references become global annotations for that page and region
Step 5: Sort (page → region → y → x), re-index, return

No AI call for annotation positioning. Instant, free, deterministic.

[Pre-identified annotations are inserted here dynamically from PyMuPDF extraction]
[Reference pools are inserted here dynamically]

CRITICAL: Include ALL annotations listed above. If you cannot locate one visually, use your best estimate for position. NEVER drop an annotation.

--- AI QA PROMPT (optional, when enabled) ---

${AI_QA_PROMPT_USER}`

const PROMPT_DISPLAY_TEXT = {
  'all': ANNOTATION_POSITIONING_DISPLAY,
  'disease': ANNOTATION_POSITIONING_DISPLAY,
  'drug': MEDICATION_PROMPT_USER
}

const fileShaPromiseCache = new WeakMap()

function stableStringHash(value) {
  const source = String(value || '')
  let h = 0
  for (let i = 0; i < source.length; i += 1) {
    h = (Math.imul(31, h) + source.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
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

function formatMinutes(ms) {
  return `${(ms / 60000).toFixed(2)} min`
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

function transformPyMuPDFResults(data) {
  const annotations = []
  if (!data?.pages) return annotations
  for (const page of data.pages) {
    const mapClaim = (claim, idx, region, prefix) => ({
      id: `pymupdf-${prefix}-${page.page}-${idx}`,
      text: claim.text,
      claim: claim.text,
      statement: claim.text,
      region,
      refNumbers: claim.superscripts || [],
      superscripts: claim.superscripts || [],
      references: (claim.references || []).map(r => ({ number: r.number, text: r.text, missing: false })),
      source: 'pymupdf',
      matched: (claim.references || []).length > 0,
      matchTier: 'on-page',
      confidence: 100,
      page: page.page,
      position: claim.position || null,
      globalSpot: false,
      status: 'pending',
    })
    for (const [idx, claim] of (page.slide_claims || []).entries()) {
      annotations.push(mapClaim(claim, idx, 'slide', 's'))
    }
    for (const [idx, claim] of (page.notes_claims || []).entries()) {
      annotations.push(mapClaim(claim, idx, 'notes', 'n'))
    }
    for (const [idx, u] of (page.unresolved_superscripts || []).entries()) {
      annotations.push({
        id: `pymupdf-u-${page.page}-${idx}`,
        text: u.claim_text || `Unresolved superscript ${u.superscript}`,
        claim: u.claim_text || `Unresolved superscript ${u.superscript}`,
        statement: u.claim_text || `Unresolved superscript ${u.superscript}`,
        region: u.region || 'slide',
        refNumbers: [u.superscript],
        superscripts: [u.superscript],
        references: [],
        source: 'pymupdf',
        matched: false,
        matchTier: 'unresolved',
        confidence: 100,
        page: page.page,
        position: null,
        globalSpot: true,
        globalReason: 'unresolved-superscript',
        status: 'pending',
      })
    }
    // Global annotations for orphan references (no superscripts in region)
    for (const [idx, g] of (page.global_annotations || []).entries()) {
      const region = (g.global_reason || '').includes('slide') ? 'slide' : 'notes'
      annotations.push({
        id: `pymupdf-g-${page.page}-${idx}`,
        text: g.text,
        claim: g.text,
        statement: g.text,
        region,
        refNumbers: g.superscripts || [],
        superscripts: g.superscripts || [],
        references: (g.references || []).map(r => ({ number: r.number, text: r.text, missing: false })),
        source: 'pymupdf',
        matched: true,
        matchTier: 'on-page',
        confidence: 100,
        page: page.page,
        position: g.position || null,
        globalSpot: true,
        globalReason: g.global_reason || 'orphan-page-reference',
        status: 'pending',
      })
    }
  }
  return annotations
}

export default function MKG3ClaimsDetector() {
  // Document state
  const [uploadedFile, setUploadedFile] = useState(null)
  const [uploadState, setUploadState] = useState('empty')
  const fileInputRef = useRef(null)

  // Settings state
  const [selectedPrompt, _setSelectedPrompt] = useState('all-claims')
  const [editablePrompt, setEditablePrompt] = useState('')
  const [isEditingPrompt, setIsEditingPrompt] = useState(false)
  const [selectedDocType, setSelectedDocType] = useState('speaker-notes')

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

  const cancelAnalysisRef = useRef(false)
  const [matchingStats, setMatchingStats] = useState(null)

  // Claims state
  const [claims, setClaims] = useState([])
  const [activeClaimId, setActiveClaimId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState('annotation')
  const [collapsedPages, setCollapsedPages] = useState({})
  const [showClaimPins, setShowClaimPins] = useState(true)
  const [currentVersion, setCurrentVersion] = useState(null)
  const [versionList, setVersionList] = useState([])
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [documentHash, setDocumentHash] = useState(null)
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
  const [enableAiQa, setEnableAiQa] = useState(false)

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

  // Sync editable prompt — annotation prompts are self-contained (no doc-type scaffold needed)
  useEffect(() => {
    const promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
    const basePrompt = PROMPT_DISPLAY_TEXT[promptKey] || PROMPT_DISPLAY_TEXT['all']
    if (promptKey === 'drug') {
      // Claims detection mode — prepend doc-type structure + position rules
      const { structure, position } = getDocTypeInstructions(selectedDocType || 'speaker-notes')
      setEditablePrompt(structure.trim() + '\n\n' + basePrompt + '\n' + position.trim())
    } else {
      // Annotation mode — prompts are self-contained with region-specific instructions
      setEditablePrompt(basePrompt)
    }
    setIsEditingPrompt(false)
  }, [selectedPrompt, selectedDocType])

  // Track elapsed time during analysis
  useEffect(() => {
    if (!isAnalyzing) {
      setElapsedSeconds(0)
      return
    }
    const interval = setInterval(() => {
      setElapsedSeconds(prev => prev + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [isAnalyzing])

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

    const deduped = dedupeClaimsByPageAndText(claims, { strategy: 'exact' })
    if (deduped.duplicateCount === 0) return

    const indexedClaims = addGlobalIndices(deduped.claims)
    logger.info({
      event: 'mkg3_claim_dedupe_guard',
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
        facts_count: ref.facts_count || 0,
        citationMetadata: ref.citation_metadata ? (typeof ref.citation_metadata === 'string' ? JSON.parse(ref.citation_metadata) : ref.citation_metadata) : null
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
    setUploadedFile(null)
    setUploadState('empty')
    setClaims([])
    setStatusFilter('all')
    setCollapsedPages({})
    setAnalysisComplete(false)
    setAnalysisError(null)
    setMatchingStats(null)
    setMissedClaims([])
    setSelectionMode(false)
    setPendingPinPosition(null)
    setCurrentVersion(null)
    setVersionList([])
    setHasUnsavedChanges(false)
    setDocumentHash(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

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
    cancelAnalysisRef.current = false

    setIsAnalyzing(true)
    setAnalysisComplete(false)
    setAnalysisError(null)
    setAnalysisProgress(0)
    setAnalysisStatus('Reading document...')
    setMatchingStats(null)
    setClaims([])
    setHasUnsavedChanges(false)
    const analysisStartedAt = Date.now()

    try {
      setAnalysisProgress(20)
      setAnalysisStatus('Extracting annotations (PyMuPDF)...')

      const pymupdfData = await api.extractWithPyMuPDF(uploadedFile)
      if (cancelAnalysisRef.current) return

      setAnalysisProgress(70)
      setAnalysisStatus('Processing results...')

      const transformed = transformPyMuPDFResults(pymupdfData)
      const indexed = addGlobalIndices(transformed)
      logger.info({ event: 'pymupdf_extraction_complete', annotations: indexed.length })

      let nextClaims = indexed

      try {
        const fileHash = await getFileSha256(uploadedFile)
        setDocumentHash(fileHash)

        {
          const existingVersion = await api.getLatestVersion(fileHash, selectedBrandId)
          if (existingVersion) {
            const savedAnnotations = JSON.parse(existingVersion.annotations_json)
            const statusMap = new Map()
            for (const annotation of savedAnnotations) {
              if (annotation.status && annotation.status !== 'pending') {
                statusMap.set(`${annotation.page}-${annotation.text?.slice(0, 60)}`, annotation.status)
              }
            }

            if (statusMap.size > 0) {
              nextClaims = indexed.map((annotation) => {
                const key = `${annotation.page}-${annotation.text?.slice(0, 60)}`
                const savedStatus = statusMap.get(key)
                return savedStatus ? { ...annotation, status: savedStatus } : annotation
              })
            }
          }
        }

        setClaims(nextClaims)

        const saved = await api.saveAnnotationVersion({
          document_hash: fileHash,
          brand_id: selectedBrandId || null,
          document_name: uploadedFile.name,
          annotations_json: JSON.stringify(nextClaims),
          source: 'pymupdf'
        })
        setCurrentVersion(saved)
        setVersionList(await api.listVersions(fileHash, selectedBrandId))
        logger.info({ event: 'version_saved', hash: fileHash, claims: nextClaims.length })
      } catch (versionErr) {
        setClaims(nextClaims)
        logger.error('Version save error:', versionErr)
      }

      const analysisTotalMs = Date.now() - analysisStartedAt
      setProcessingTime(analysisTotalMs)
      setLastUsage({ inputTokens: 0, outputTokens: 0, cost: 0, model: 'pymupdf', modelDisplayName: 'PyMuPDF' })

      const summary = summarizeAnnotationClaims(nextClaims)
      setMatchingStats({
        total: summary.total,
        matched: summary.onPageCount,
        unmatched: summary.aiFindCount,
        on_page_count: summary.onPageCount,
        ai_find_count: summary.aiFindCount,
        global_annotation_count: summary.globalAnnotationCount,
        matching_total_ms: analysisTotalMs
      })

      setAnalysisProgress(100)
      setAnalysisStatus('Annotations complete')
      setAnalysisComplete(true)

      logger.info({
        event: 'mkg3_annotation_summary',
        total_ms: analysisTotalMs,
        on_page_annotations: summary.onPageCount,
        ai_finds: summary.aiFindCount,
        global_annotations: summary.globalAnnotationCount,
        model: 'pymupdf'
      })
    } catch (error) {
      logger.error('Annotation error:', error)
      setAnalysisError(error.message)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleSaveVersion = async () => {
    if (!documentHash || claims.length === 0) return
    try {
      const saved = await api.saveAnnotationVersion({
        document_hash: documentHash,
        brand_id: selectedBrandId || null,
        document_name: uploadedFile.name,
        annotations_json: JSON.stringify(claims),
        source: 'manual',
        parent_version_id: currentVersion?.id || null
      })
      setCurrentVersion(saved)
      setVersionList(prev => [saved, ...prev])
      setHasUnsavedChanges(false)
      logger.info({ event: 'version_saved', version: saved.version_number })
    } catch (err) {
      logger.error('Save version error:', err)
    }
  }

  const handleResetVersions = async () => {
    if (!documentHash) return
    try {
      await api.deleteVersionsByHash(documentHash)
      setCurrentVersion(null)
      setVersionList([])
      logger.info({ event: 'versions_reset', hash: documentHash })
      // Re-analyze to get a fresh v1
      handleAnalyze()
    } catch (err) {
      logger.error('Reset versions error:', err)
    }
  }

  const handleLoadVersion = async (versionNumber) => {
    if (!documentHash) return
    try {
      const version = await api.getVersionByNumber(documentHash, versionNumber, selectedBrandId)
      if (version) {
        const savedAnnotations = addGlobalIndices(
          JSON.parse(version.annotations_json).map(c => ({ ...c, status: c.status || 'pending' }))
        )
        setClaims(savedAnnotations)
        setCurrentVersion(version)
        setHasUnsavedChanges(false)
        logger.info({ event: 'version_loaded', version: version.version_number })
      }
    } catch (err) {
      logger.error('Load version error:', err)
    }
  }

  const handleCancelAnalysis = () => {
    cancelAnalysisRef.current = true
    setIsAnalyzing(false)
    setAnalysisComplete(false)
    setAnalysisProgress(0)
    setAnalysisStatus('Analyzing document...')
    setClaims([])
    setMatchingStats(null)
  }

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
    setHasUnsavedChanges(true)
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

    // Record brand pattern (implicit learning)
    if (selectedBrandId && claim.references?.length > 0) {
      claim.references.forEach(ref => {
        if (ref.text) {
          api.recordBrandPattern({
            brand_id: selectedBrandId,
            pattern_type: 'ref_association',
            pattern_json: JSON.stringify({
              reference: ref.text,
              claim_text: claim.text?.substring(0, 100),
              action: 'approved'
            }),
            strength_delta: 1
          }).catch(err => logger.error('Pattern record error:', err))
        }
      })
    }
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
    setHasUnsavedChanges(true)

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

    // Record negative brand pattern (implicit learning)
    if (selectedBrandId && claim.references?.length > 0) {
      claim.references.forEach(ref => {
        if (ref.text) {
          api.recordBrandPattern({
            brand_id: selectedBrandId,
            pattern_type: 'ref_association',
            pattern_json: JSON.stringify({
              reference: ref.text,
              claim_text: claim.text?.substring(0, 100),
              action: 'rejected'
            }),
            strength_delta: -1
          }).catch(err => logger.error('Pattern record error:', err))
        }
      })
    }
  }

  const handleClaimPositionUpdate = useCallback((claimId, newPosition, isFinal) => {
    setClaims(prev => prev.map(c =>
      c.id === claimId
        ? {
            ...c,
            position: {
              ...c.position,
              x: newPosition.x,
              y: newPosition.y,
              source: 'manual-drag'
            }
          }
        : c
    ))
    if (isFinal) {
      setHasUnsavedChanges(true)
      logger.info({ event: 'pin_moved', claimId, x: newPosition.x, y: newPosition.y })
    }
  }, [])

  const handleClaimDelete = useCallback((claimId) => {
    setClaims(prev => prev.filter(c => c.id !== claimId))
    setHasUnsavedChanges(true)
    logger.info({ event: 'annotation_deleted', claimId })
  }, [])

  const handleClaimUndo = useCallback((claimId) => {
    setClaims(prev => prev.map(c =>
      c.id === claimId ? { ...c, status: 'pending', rejectionType: undefined, correctedReferenceName: undefined } : c
    ))
    setHasUnsavedChanges(true)
  }, [])

  const handleRefChange = useCallback((claimId, updatedRefs) => {
    setClaims(prev => prev.map(c =>
      c.id === claimId ? { ...c, references: updatedRefs } : c
    ))
    setHasUnsavedChanges(true)
    logger.info({ event: 'reference_changed', claimId, refCount: updatedRefs.length })
  }, [])

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

  const handleViewRef = async (ref, claimText) => {
    if (!ref.id) return

    let targetPage = 1
    let excerpt = null
    let resolvedPage = false
    let resolutionReason = null

    // Tier 0: If the slide citation names journal pages (e.g. 680-690), map that printed page to the PDF page.
    try {
      const textData = await api.fetchReferenceText(ref.id)
      if (textData?.content_text) {
        const citationPageHint = resolveCitationPdfPage({
          citationText: ref.text,
          contentText: textData.content_text,
          pageBoundaries: textData.page_boundaries
        })

        if (citationPageHint?.pdfPage) {
          targetPage = citationPageHint.pdfPage
          resolvedPage = true
          resolutionReason = `citation-page:${citationPageHint.citationPageLabel}`
          logger.info('[ViewRef] Citation page mapped to PDF page', targetPage, 'for cited pages', citationPageHint.citationPageLabel)
        }

        // Tier 1: Content-text search — find the claim text in the reference PDF
        const normalize = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
        const normalizedClaim = normalize(claimText)
        const normalizedContent = normalize(textData.content_text)

        if (!resolvedPage) {
          const idx = normalizedContent.indexOf(normalizedClaim)
          if (idx >= 0) {
            targetPage = charOffsetToPage(idx, textData.page_boundaries) || 1
            const rawContent = textData.content_text
            const matchStart = rawContent.toLowerCase().indexOf(normalizedClaim)
            if (matchStart >= 0) {
              excerpt = rawContent.slice(matchStart, matchStart + claimText.length)
            }
            resolvedPage = true
            resolutionReason = 'claim-text-exact'
            logger.info('[ViewRef] Tier 1 exact match found on page', targetPage)
          } else {
            // Try keyword overlap: find the sentence with the most overlapping words
            const claimWords = new Set(normalizedClaim.split(/\s+/).filter(w => w.length > 3))
            if (claimWords.size > 0) {
              const sentences = textData.content_text.split(/[.!?\n]+/).filter(s => s.trim().length > 20)
              let bestSentence = null
              let bestScore = 0
              let bestSentenceIdx = -1

              for (const sentence of sentences) {
                const normalizedSentence = normalize(sentence)
                const sentenceWords = normalizedSentence.split(/\s+/).filter(w => w.length > 3)
                const overlap = sentenceWords.filter(w => claimWords.has(w)).length
                const score = overlap / claimWords.size
                if (score > bestScore) {
                  bestScore = score
                  bestSentence = sentence.trim()
                  bestSentenceIdx = textData.content_text.toLowerCase().indexOf(normalizedSentence)
                }
              }

              if (bestSentence && bestScore > 0.4 && bestSentenceIdx >= 0) {
                targetPage = charOffsetToPage(bestSentenceIdx, textData.page_boundaries) || 1
                excerpt = bestSentence
                resolvedPage = true
                resolutionReason = 'claim-text-keyword'
                logger.info('[ViewRef] Tier 1 keyword match found on page', targetPage, 'score:', bestScore.toFixed(2))
              }
            }
          }
        }
      }
    } catch {
      // Content search failed, continue to fact fallback
    }

    // Tier 2: Fact lookup fallback (only if page resolution failed entirely)
    const factBrandId = libraryBrandId || selectedBrandId || selectedBrand?.id || null
    if (!resolvedPage && factBrandId) {
      try {
        const factData = await api.fetchFacts(factBrandId, ref.id)
        if (factData?.facts?.length > 0) {
          const normalize = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
          const normalizedClaim = normalize(claimText)
          let bestFact = null
          let bestScore = 0

          for (const fact of factData.facts) {
            const normalizedFact = normalize(fact.text)
            let score = 0
            if (normalizedFact.includes(normalizedClaim) || normalizedClaim.includes(normalizedFact)) {
              score = Math.min(normalizedFact.length, normalizedClaim.length) / Math.max(normalizedFact.length, normalizedClaim.length)
            } else {
              const claimWords = new Set(normalizedClaim.split(/\s+/).filter(w => w.length > 3))
              const factWords = normalizedFact.split(/\s+/).filter(w => w.length > 3)
              const overlap = factWords.filter(w => claimWords.has(w)).length
              score = claimWords.size > 0 ? overlap / claimWords.size : 0
            }
            if (score > bestScore) {
              bestScore = score
              bestFact = fact
            }
          }

          if (bestFact && bestScore > 0.3 && bestFact.page) {
            targetPage = bestFact.page
            excerpt = bestFact.text
            resolvedPage = true
            resolutionReason = 'fact-fallback'
            logger.info('[ViewRef] Tier 2 fact match found on page', targetPage, 'score:', bestScore.toFixed(2))
          }
        }
      } catch (err) {
        logger.warn('[ViewRef] Tier 2 fact lookup failed:', err.message)
      }
    }

    setReferenceViewerData({
      referenceId: ref.id,
      page: targetPage,
      excerpt: excerpt || (!resolvedPage ? claimText : null),
      pageResolution: resolutionReason,
      citationPageLabel: ref.citationPageLabel || null
    })
  }

  // ===== Missed Claim Reporting =====

  const handlePinPlace = (position) => {
    setPendingPinPosition(position)
    setSelectionMode(false)
    setTextSelectionMode(false)
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
    setHasUnsavedChanges(true)
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
  const claimSummary = useMemo(() => summarizeAnnotationClaims(claims), [claims])
  const matchedRateLabel = `${claimSummary.onPageCount} on-page`

  const analysisMs = processingTime || 0
  const endToEndMs = analysisMs

  const claimDetectionRunCost = lastUsage?.cost || 0
  const totalRunAICost = claimDetectionRunCost

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
      return (a.globalIndex ?? 0) - (b.globalIndex ?? 0)
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

  const canAnalyze = uploadedFile && !isAnalyzing

  const selectedBrand = brands.find(b => b.id === selectedBrandId)

  return (
    <div className="page">
      <div className="header">
        <div className="headerLeft">
          <div className="titleSection">
            <h1 className="title">Annotation Activation</h1>
            <Badge variant="info">POC2</Badge>
          </div>
          <p className="subtitle" />
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
          {currentVersion && (
            <div className="versionNavGroup">
              <span className="versionBadge" title={`Saved ${currentVersion.created_at}`}>
                v{currentVersion.version_number}
              </span>
              {versionList.length > 1 && (
                <select
                  className="versionSelect"
                  value={currentVersion.version_number}
                  onChange={(e) => handleLoadVersion(parseInt(e.target.value, 10))}
                >
                  {versionList.map(v => (
                    <option key={v.id} value={v.version_number}>
                      v{v.version_number} — {v.source === 'ai' ? 'AI' : 'Edit'} — {new Date(v.created_at).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="saveVersionBtn"
                onClick={handleSaveVersion}
                disabled={!hasUnsavedChanges}
                title={hasUnsavedChanges ? 'Save as new version' : 'No changes'}
              >
                <Icon name="fileCheck" size={14} />
                Save
              </button>
              <button
                className="resetVersionBtn"
                onClick={handleResetVersions}
                title="Reset all versions for this document"
              >
                <Icon name="refreshCw" size={14} />
              </button>
            </div>
          )}
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

                    {/* AI Analysis Toggle */}
                    <div className="settingItem">
                      <label className="settingLabel">AI Analysis</label>
                      <div className="settingControl">
                        <label className="switchLabel">
                          <input
                            type="checkbox"
                            className="switchInput"
                            checked={enableAiQa}
                            onChange={(e) => setEnableAiQa(e.target.checked)}
                          />
                          <span className="switchTrack" />
                          <span className="switchStatus">{enableAiQa ? 'On' : 'Off'}</span>
                        </label>
                      </div>
                    </div>

                    {/* AI Model — only when AI Analysis is on */}
                    {enableAiQa && (
                      <div className="settingItem">
                        <label className="settingLabel">AI Model</label>
                        <span className="settingValue">{ACTIVE_MODEL_LABEL}</span>
                      </div>
                    )}
                  </div>
                }
              />

              {enableAiQa && (
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
              )}

              <Button
                variant="primary"
                size="large"
                onClick={handleAnalyze}
                disabled={!canAnalyze}
              >
                {isAnalyzing ? (
                  <>
                    <Spinner size="small" />
                    Annotating...
                  </>
                ) : (
                  <>
                    <Icon name="zap" size={18} />
                    Annotate Document
                  </>
                )}
              </Button>

              {analysisError && (
                <div className="analysisError">
                  <Icon name="alertCircle" size={16} />
                  <span>{analysisError}</span>
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
                              <span className="resultLabel">On-Page Annotations</span>
                              <span className="resultValue">{claimSummary.onPageCount}</span>
                            </div>
                            {claimSummary.aiFindCount > 0 && (
                              <div className="resultRow" style={{ color: 'var(--amber-9)' }}>
                                <span className="resultLabel">AI Finds</span>
                                <span className="resultValue">{claimSummary.aiFindCount}</span>
                              </div>
                            )}
                            {claimSummary.unreferencedCount > 0 && (
                              <div className="resultRow" style={{ color: 'var(--red-9)' }}>
                                <span className="resultLabel">Unreferenced Claims</span>
                                <span className="resultValue">{claimSummary.unreferencedCount}</span>
                              </div>
                            )}
                            <div className="resultRow">
                              <span className="resultLabel">Processing Time</span>
                              <span className="resultValue">{formatMinutes(analysisMs)}</span>
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
                          <span className="resultValue">{lastUsage?.modelDisplayName || 'PyMuPDF'}</span>
                        </div>
                        <div className="resultRow">
                          <span className="resultLabel">Claims Detected</span>
                          <span className="resultValue">{claims.length}</span>
                        </div>
                        <div className="resultRow">
                          <span className="resultLabel">On-Page Annotations</span>
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
                          <span className="resultValue">N/A</span>
                        </div>
                        <div className="divider" />
                        <div className="resultRow">
                          <span className="resultLabel">Claim Detection Cost</span>
                          <span className="resultValue">${claimDetectionRunCost.toFixed(4)}</span>
                        </div>
                        <div className="resultRow">
                          <span className="resultLabel">Reference Matching Cost</span>
                          <span className="resultValue">N/A</span>
                        </div>
                        <div className="resultRow">
                          <span className="resultLabel">Total Run AI Cost</span>
                          <span className="resultValue">${totalRunAICost.toFixed(4)}</span>
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
              analysisStatus={analysisStatus}
              elapsedSeconds={elapsedSeconds}
              onScanComplete={() => {}}
              claims={claims}
              missedClaims={displayMissedClaims}
              activeClaimId={activeClaimId}
              onClaimSelect={handleClaimSelect}
              onClaimPositionUpdate={handleClaimPositionUpdate}
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
                                    onViewRef={handleViewRef}
                                    onDelete={handleClaimDelete}
                                    onUndo={handleClaimUndo}
                                    onRefChange={handleRefChange}
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
                          onViewRef={handleViewRef}
                          onDelete={handleClaimDelete}
                                    onUndo={handleClaimUndo}
                          onRefChange={handleRefChange}
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
