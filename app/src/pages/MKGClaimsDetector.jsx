import { useState, useRef, useEffect } from 'react'
import '../App.css'
import './MKGClaimsDetector.css'
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import Spinner from '@/components/atoms/Spinner/Spinner'
import Badge from '@/components/atoms/Badge/Badge'
import AccordionItem from '@/components/molecules/AccordionItem/AccordionItem'
import Input from '@/components/atoms/Input/Input'
import DropdownMenu from '@/components/molecules/DropdownMenu/DropdownMenu'
import PDFViewer from '@/components/mkg/PDFViewer'
import ClaimCard from '@/components/claims-detector/ClaimCard'
import { analyzeDocument, checkGeminiConnection, ALL_CLAIMS_PROMPT_USER, MEDICATION_PROMPT_USER } from '@/services/gemini'
import { enrichClaimsWithPositions, addGlobalIndices } from '@/utils/textMatcher'

// AI Model options - SSOT
const MODEL_OPTIONS = [
  { id: 'gemini-3-pro', label: 'Google Gemini 3 Pro' },
  { id: 'claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { id: 'gpt-4o', label: 'OpenAI GPT-4o' }
]

// Prompt options for Claim Focus dropdown
const PROMPT_OPTIONS = [
  { id: 'all-claims', label: 'All Claims', promptKey: 'all' },
  { id: 'disease-state', label: 'Disease State', promptKey: 'disease' },
  { id: 'medication', label: 'Medication', promptKey: 'drug' }
]

// Maps promptKey to user-facing prompt text
const PROMPT_DISPLAY_TEXT = {
  'all': ALL_CLAIMS_PROMPT_USER,
  'disease': ALL_CLAIMS_PROMPT_USER, // Uses All Claims for now
  'drug': MEDICATION_PROMPT_USER
}

export default function MKGClaimsDetector() {
  // Document state
  const [uploadedFile, setUploadedFile] = useState(null)
  const [uploadState, setUploadState] = useState('empty') // empty, uploading, complete
  const fileInputRef = useRef(null)

  // Analysis state
  const [selectedModel, setSelectedModel] = useState('gemini-3-pro')
  const [selectedPrompt, setSelectedPrompt] = useState('all-claims')
  const [editablePrompt, setEditablePrompt] = useState('')
  const [isEditingPrompt, setIsEditingPrompt] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisComplete, setAnalysisComplete] = useState(false)
  const [analysisError, setAnalysisError] = useState(null)
  const [processingTime, setProcessingTime] = useState(0)
  const [analysisProgress, setAnalysisProgress] = useState(0)
  const [analysisStatus, setAnalysisStatus] = useState('')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Claims state
  const [claims, setClaims] = useState([])
  const [activeClaimId, setActiveClaimId] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all') // all, pending, approved, rejected
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState('high-low')
  const [showClaimPins, setShowClaimPins] = useState(true)
  const [showPinHighlights, setShowPinHighlights] = useState(false)

  // Cost tracking state
  const [lastUsage, setLastUsage] = useState(null) // { model, modelDisplayName, inputTokens, outputTokens, cost }
  const [totalCost, setTotalCost] = useState(0)

  // Text extraction state
  const [extractedPages, setExtractedPages] = useState([])

  const claimsListRef = useRef(null)
  const claimsPanelRef = useRef(null)

  // Load total cost from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('gemini_total_cost')
    if (saved) {
      setTotalCost(parseFloat(saved))
    }
  }, [])

  // Ensure any externally-set claims always carry stable global indices
  useEffect(() => {
    setClaims(prev => {
      if (!prev.length) return prev
      const missing = prev.some(c => !c.globalIndex)
      if (!missing) return prev
      return addGlobalIndices(prev)
    })
  }, [])

  // Sync editable prompt when Claim Focus changes
  useEffect(() => {
    const promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
    setEditablePrompt(PROMPT_DISPLAY_TEXT[promptKey] || PROMPT_DISPLAY_TEXT['all'])
    setIsEditingPrompt(false) // Exit edit mode on dropdown change
  }, [selectedPrompt])

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

  // Get default prompt for current selection (for cancel/reset)
  const getDefaultPrompt = () => {
    const promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'
    return PROMPT_DISPLAY_TEXT[promptKey] || PROMPT_DISPLAY_TEXT['all']
  }

  const handleCancelEdit = () => {
    setEditablePrompt(getDefaultPrompt())
    setIsEditingPrompt(false)
  }

  // Handle text extraction from PDFViewer
  const handleTextExtracted = (pages) => {
    setExtractedPages(pages)
  }

  // Handle real file upload
  const handleFileSelect = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.includes('pdf')) {
      setAnalysisError('Please upload a PDF file')
      return
    }

    setUploadState('uploading')
    setAnalysisError(null)

    // Simulate brief upload progress for UX
    setTimeout(() => {
      setUploadedFile(file)
      setUploadState('complete')
      setAnalysisComplete(false)
      setClaims([])
    }, 500)
  }

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleRemoveDocument = () => {
    setUploadedFile(null)
    setUploadState('empty')
    setClaims([])
    setAnalysisComplete(false)
    setAnalysisError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Analyze document with Gemini
  const handleAnalyze = async () => {
    if (!uploadedFile) return

    setIsAnalyzing(true)
    setAnalysisComplete(false)
    setAnalysisError(null)
    setAnalysisProgress(0)
    setAnalysisStatus('Starting...')
    const startTime = Date.now()

    try {
      // First check connection
      setAnalysisProgress(5)
      setAnalysisStatus('Checking connection...')
      const connectionCheck = await checkGeminiConnection()
      if (!connectionCheck.connected) {
        throw new Error(`Gemini API not connected: ${connectionCheck.error}`)
      }

      // Get promptKey from selected prompt
      const promptKey = PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.promptKey || 'all'

      // Analyze the document with progress tracking
      const result = await analyzeDocument(uploadedFile, (progress, status) => {
        setAnalysisProgress(progress)
        setAnalysisStatus(status)
      }, promptKey, editablePrompt)

      if (!result.success) {
        throw new Error(result.error || 'Analysis failed')
      }

      // Gemini now returns positions directly (x/y as % of page)
      // Only fall back to text matching if positions are missing
      const claimsNeedingPositions = result.claims.filter(c => !c.position)
      const claimsWithPositions = claimsNeedingPositions.length > 0 && extractedPages.length > 0
        ? enrichClaimsWithPositions(result.claims, extractedPages)
        : result.claims

      setClaims(addGlobalIndices(claimsWithPositions))

      if (claimsNeedingPositions.length === 0) {
        console.log('✅ All claims have positions from Gemini - no text matching needed')
      } else {
        console.log(`⚠️ ${claimsNeedingPositions.length}/${result.claims.length} claims missing positions, using text matching fallback`)
      }
      setProcessingTime(Date.now() - startTime)

      // Track usage and cost
      if (result.usage) {
        setLastUsage(result.usage)
        const newTotal = totalCost + result.usage.cost
        setTotalCost(newTotal)
        localStorage.setItem('gemini_total_cost', newTotal.toString())
      }

      setAnalysisProgress(100)
      setAnalysisStatus('Complete')
      setAnalysisComplete(true)
    } catch (error) {
      console.error('Analysis error:', error)
      setAnalysisError(error.message)
    } finally {
      setIsAnalyzing(false)
    }
  }

  // Fallback: If Gemini didn't return positions, enrich when text extraction completes
  useEffect(() => {
    if (!analysisComplete || extractedPages.length === 0) return

    setClaims(prev => {
      if (!prev.length) return prev
      // Only re-enrich if claims are missing positions or have fallback positions
      // Skip if positions came from Gemini (they won't have a 'source' property)
      const needsReposition = prev.some(c => !c.position || c.position?.source === 'fallback')
      if (!needsReposition) return prev

      console.log('🔄 Re-enriching claim positions from text extraction...')

      // Preserve existing globalIndex, only refresh positions
      const refreshed = enrichClaimsWithPositions(prev, extractedPages)
      const withIndexes = refreshed.map(claim => {
        const existing = prev.find(c => c.id === claim.id)
        return { ...claim, globalIndex: existing?.globalIndex }
      })

      // If any claim still lacks a globalIndex, assign fresh sequential indices
      const missingIndex = withIndexes.some(c => !c.globalIndex)
      return missingIndex ? addGlobalIndices(withIndexes) : withIndexes
    })
  }, [analysisComplete, extractedPages])

  // Claim actions
  const handleClaimApprove = (claimId) => {
    setClaims(prev =>
      prev.map(c => c.id === claimId ? { ...c, status: 'approved' } : c)
    )
  }

  const handleClaimReject = (claimId, feedback) => {
    setClaims(prev =>
      prev.map(c => c.id === claimId ? { ...c, status: 'rejected', feedback } : c)
    )
  }

  const handleClaimSelect = (claimId) => {
    setActiveClaimId(claimId)
    // Scroll claim card into view if selecting from PDF
    if (claimId && claimsListRef.current) {
      const cardEl = claimsListRef.current.querySelector(`[data-claim-id="${claimId}"]`)
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }

  // Confidence tier counts
  const highConfidenceClaims = claims.filter(c => c.confidence >= 0.9)
  const mediumConfidenceClaims = claims.filter(c => c.confidence >= 0.7 && c.confidence < 0.9)
  const lowConfidenceClaims = claims.filter(c => c.confidence < 0.7)

  // Status counts
  const pendingCount = claims.filter(c => c.status === 'pending').length
  const approvedCount = claims.filter(c => c.status === 'approved').length
  const rejectedCount = claims.filter(c => c.status === 'rejected').length
  const anchoredCount = claims.filter(c => c.position?.source === 'extracted').length
  const fallbackCount = claims.filter(c => c.position?.source === 'fallback').length

  // Filter and sort claims
  const displayedClaims = claims
    .filter(c => {
      // Status filter
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      // Search filter
      if (searchQuery && !c.text.toLowerCase().includes(searchQuery.toLowerCase())) return false
      return true
    })
    .sort((a, b) => sortOrder === 'high-low'
      ? b.confidence - a.confidence
      : a.confidence - b.confidence
    )

  const canAnalyze = uploadedFile && !isAnalyzing

  return (
    <div className="page">
      <div className="header">
        <div className="titleSection">
          <h1 className="title">MKG Claims Detector</h1>
          <Badge variant="info">POC</Badge>
        </div>
        <p className="subtitle">
          AI-powered reference matching for pharmaceutical MLR submissions
        </p>
      </div>

      <div className="workbench">
        {/* Config Panel */}
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
                  <div className="uploadDropzone" onClick={handleUploadClick}>
                    <Icon name="upload" size={32} />
                    <p>Click to upload PDF</p>
                    <span className="uploadHint">or drag and drop</span>
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
            title="Claim Focus"
            defaultOpen={true}
            size="small"
            content={
              <div className="settingsContent">
                <DropdownMenu
                  trigger="button"
                  triggerLabel={PROMPT_OPTIONS.find(p => p.id === selectedPrompt)?.label || 'All Claims'}
                  items={PROMPT_OPTIONS.map(item => ({
                    ...item,
                    onClick: () => setSelectedPrompt(item.id)
                  }))}
                  size="medium"
                />
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
                    <button
                      className="promptIconBtn"
                      onClick={() => setIsEditingPrompt(true)}
                      title="Edit prompt"
                    >
                      <Icon name="edit" size={14} />
                    </button>
                  ) : (
                    <div className="promptEditActions">
                      <button
                        className="promptIconBtn promptSaveBtn"
                        onClick={() => setIsEditingPrompt(false)}
                        title="Save"
                      >
                        <Icon name="check" size={14} />
                      </button>
                      <button
                        className="promptIconBtn promptCancelBtn"
                        onClick={handleCancelEdit}
                        title="Cancel"
                      >
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

          <AccordionItem
            title="Settings"
            defaultOpen={true}
            size="small"
            content={
              <div className="settingsContent">
                <div className="settingItem">
                  <label className="settingLabel">AI Model (Testing Only)</label>
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

          <Button
            variant="primary"
            size="large"
            onClick={handleAnalyze}
            disabled={!canAnalyze}
          >
            {isAnalyzing ? (
              <>
                <Spinner size="small" />
                Analyzing...
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

          {analysisComplete && (
            <>
              <AccordionItem
                title="Results Summary"
                defaultOpen={true}
                size="small"
                content={
                  <div className="resultsSummary">
                    <div className="resultRow">
                      <span className="resultLabel">Total Claims Found</span>
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
                  </div>
                }
              />
              <AccordionItem
                title="Model Performance"
                defaultOpen={true}
                size="small"
                content={
                  <div className="modelPerformance">
                    <div className="resultRow">
                      <span className="resultLabel">Model</span>
                      <span className="resultValue">{lastUsage?.modelDisplayName || 'Gemini 3 Pro'}</span>
                    </div>
                    <div className="resultRow">
                      <span className="resultLabel">Time</span>
                      <span className="resultValue">{(processingTime / 1000).toFixed(1)}s</span>
                    </div>
                    <div className="resultRow">
                      <span className="resultLabel">Run Cost</span>
                      <span className="resultValue">${lastUsage?.cost?.toFixed(4) || '0.0000'}</span>
                    </div>
                    <div className="divider" />
                    <div className="resultRow totalCost">
                      <span className="resultLabel">Tracked Spend</span>
                      <span className="resultValue">${totalCost.toFixed(4)}</span>
                    </div>
                  </div>
                }
              />
            </>
          )}
        </div>

        {/* Document Viewer Panel */}
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
            activeClaimId={activeClaimId}
            onClaimSelect={handleClaimSelect}
            onTextExtracted={handleTextExtracted}
            claimsPanelRef={claimsPanelRef}
            showPins={showClaimPins}
            onTogglePins={() => setShowClaimPins(prev => !prev)}
            showBoxes={showPinHighlights}
            onToggleBoxes={() => setShowPinHighlights(prev => !prev)}
          />
        </div>

        {/* Claims Panel */}
        <div className="claimsPanel" ref={claimsPanelRef}>
          <div className="claimsPanelHeader">
            <h2 className="claimsPanelTitle">
              Claims
              {claims.length > 0 && (
                <Badge variant="neutral">{claims.length}</Badge>
              )}
            </h2>
          </div>

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

            {isAnalyzing && (
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
                <ClaimCard
                  claim={claim}
                  isActive={activeClaimId === claim.id}
                  onApprove={handleClaimApprove}
                  onReject={handleClaimReject}
                  onSelect={() => handleClaimSelect(claim.id)}
                  hideType={true}
                  hideSource={true}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
