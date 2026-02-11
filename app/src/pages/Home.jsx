import { useState, useEffect, useRef } from 'react'
import '../App.css'
import FileUpload from '@/components/molecules/FileUpload/FileUpload'
import DropdownMenu from '@/components/molecules/DropdownMenu/DropdownMenu'
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import Spinner from '@/components/atoms/Spinner/Spinner'
import Badge from '@/components/atoms/Badge/Badge'
import StatCard from '@/components/molecules/StatCard/StatCard'
import AccordionItem from '@/components/molecules/AccordionItem/AccordionItem'
import Tabs from '@/components/molecules/Tabs/Tabs'
import Input from '@/components/atoms/Input/Input'
import ClaimCard from '@/components/claims-detector/ClaimCard'
import DocumentTypeSelector from '@/components/claims-detector/DocumentTypeSelector'
import DocumentViewer from '@/components/claims-detector/DocumentViewer'
import LibraryTab from '@/components/claims-detector/LibraryTab'
import PromptEditor from '@/components/claims-detector/PromptEditor'
import ModelComparison from '@/components/claims-detector/ModelComparison'
import Toggle from '@/components/atoms/Toggle/Toggle'
import { ThemeToggle } from '@/components/theme'
import { getDefaultDocument } from '@/mocks/documents'
import { getClaimsForDocument, CLAIM_TYPES } from '@/mocks/claims'

const MODEL_OPTIONS = [
  { id: 'gemini-3', label: 'Google Gemini 3' },
  { id: 'claude-opus', label: 'Claude Opus 4.5' },
  { id: 'gpt-4o', label: 'OpenAI GPT-4o' }
]

export default function Home() {
  const [demoMode, setDemoMode] = useState(false)
  const [uploadState, setUploadState] = useState('empty')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [document, setDocument] = useState(null)
  const [selectedDocType, setSelectedDocType] = useState(null)
  const [selectedModel, setSelectedModel] = useState('gemini-3')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [claims, setClaims] = useState([])
  const [analysisComplete, setAnalysisComplete] = useState(false)
  const [processingTime, setProcessingTime] = useState(0)
  const [activeClaim, setActiveClaim] = useState(null)
  const [claimFilter, setClaimFilter] = useState('all')
  const [typeFilters, setTypeFilters] = useState([])
  const [sourceFilter, setSourceFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState('high-low')
  const [showModelComparison, setShowModelComparison] = useState(false)
  const [aiDiscoveryEnabled, setAiDiscoveryEnabled] = useState(true)
  const [showAIOnly, setShowAIOnly] = useState(false)
  const [referenceDocuments, setReferenceDocuments] = useState([])
  const [rightPanelTab, setRightPanelTab] = useState(0)
  const claimsListRef = useRef(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setDemoMode(params.get('demo') === 'true')
  }, [])

  // Scroll to active claim card when clicking highlight in document
  useEffect(() => {
    if (activeClaim && claimsListRef.current) {
      // Delay to ensure DOM is fully rendered after state update
      const timer = setTimeout(() => {
        const cardEl = claimsListRef.current?.querySelector(`[data-claim-id="${activeClaim}"]`)
        if (cardEl) {
          const container = claimsListRef.current
          const containerRect = container.getBoundingClientRect()
          const cardRect = cardEl.getBoundingClientRect()
          // Calculate offset and subtract container padding to align card at top
          const containerPadding = parseFloat(getComputedStyle(container).paddingTop) || 0
          const scrollOffset = cardRect.top - containerRect.top + container.scrollTop - containerPadding
          container.scrollTo({ top: scrollOffset, behavior: 'smooth' })
        }
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [activeClaim])

  // Simulate realistic upload progress
  const simulateUpload = (onComplete) => {
    setUploadState('uploading')
    setUploadProgress(0)

    // Realistic progress: fast start, slow middle, fast finish
    const steps = [
      { target: 15, delay: 80 },
      { target: 35, delay: 120 },
      { target: 52, delay: 200 },
      { target: 68, delay: 180 },
      { target: 79, delay: 250 },
      { target: 88, delay: 150 },
      { target: 94, delay: 100 },
      { target: 100, delay: 60 },
    ]

    let i = 0
    const runStep = () => {
      if (i < steps.length) {
        setUploadProgress(steps[i].target)
        setTimeout(runStep, steps[i].delay)
        i++
      } else {
        setTimeout(() => {
          setUploadState('complete')
          onComplete?.()
        }, 150)
      }
    }

    setTimeout(runStep, 100)
  }

  const handleFileUpload = (file) => {
    simulateUpload(() => {
      setDocument(getDefaultDocument())
      setAnalysisComplete(false)
      setClaims([])
      setActiveClaim(null)
    })
  }

  const formatFileSize = (bytes) => {
    if (!bytes && bytes !== 0) return '0 Bytes'
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
  }

  const handleReferenceUpload = (file, name) => {
    if (!file) return
    const uploadedAt = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
    const nextDoc = {
      id: `ref-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: name.trim() || file.name,
      uploadedAt,
      size: formatFileSize(file.size)
    }
    setReferenceDocuments((prev) => [nextDoc, ...prev])
  }

  const handleReferenceRename = (docId, newName) => {
    setReferenceDocuments((prev) =>
      prev.map((doc) => (doc.id === docId ? { ...doc, name: newName } : doc))
    )
  }

  const handleReferenceDelete = (docId) => {
    setReferenceDocuments((prev) => prev.filter((doc) => doc.id !== docId))
  }

  const handleAnalyze = () => {
    if (!document || !selectedDocType) return
    setIsAnalyzing(true)
    setAnalysisComplete(false)
  }

  const handleScanComplete = () => {
    let mockClaims = getClaimsForDocument(document.id)
    // Filter out AI-discovered claims if discovery is disabled
    if (!aiDiscoveryEnabled) {
      mockClaims = mockClaims.filter(c => c.source === 'core')
    }
    setClaims(mockClaims)
    setProcessingTime(2340)
    setIsAnalyzing(false)
    setAnalysisComplete(true)
  }

  const handleClaimApprove = (claimId) => {
    setClaims(prev =>
      prev.map(c =>
        c.id === claimId ? { ...c, status: 'approved' } : c
      )
    )
  }

  const handleClaimReject = (claimId, feedback) => {
    setClaims(prev =>
      prev.map(c =>
        c.id === claimId ? { ...c, status: 'rejected', feedback } : c
      )
    )
  }

  const handleClaimTypeChange = (claimId, newType) => {
    setClaims(prev =>
      prev.map(c =>
        c.id === claimId ? { ...c, type: newType } : c
      )
    )
  }

  const [shouldFlashHighlight, setShouldFlashHighlight] = useState(false)

  const handleClaimClick = (claimId) => {
    setActiveClaim(claimId)
    setShouldFlashHighlight(false) // Clicked from document, no flash
  }

  const handleCardClick = (claimId) => {
    setActiveClaim(claimId)
    setShouldFlashHighlight(true) // Clicked from card, flash to guide user
  }


  const handleDocumentClose = () => {
    setDocument(null)
    setUploadState('empty')
    setClaims([])
    setAnalysisComplete(false)
    setActiveClaim(null)
    setSelectedDocType(null)
    setClaimFilter('all')
    setTypeFilters([])
    setSourceFilter('all')
    setSearchQuery('')
    setShowAIOnly(false)
  }

  const filteredClaims = claims
    .filter(c => {
      if (claimFilter === 'all') return true
      return c.status === claimFilter
    })
    .filter(c => {
      if (typeFilters.length === 0) return true
      return typeFilters.includes(c.type)
    })
    .filter(c => {
      if (sourceFilter === 'all') return true
      return c.source === sourceFilter
    })
    .filter(c => {
      if (!showAIOnly) return true
      return c.source === 'ai_discovered'
    })
    .filter(c => {
      if (!searchQuery) return true
      return c.text.toLowerCase().includes(searchQuery.toLowerCase())
    })
    .sort((a, b) => sortOrder === 'high-low'
      ? b.confidence - a.confidence
      : a.confidence - b.confidence
    )

  const approvedCount = claims.filter(c => c.status === 'approved').length
  const rejectedCount = claims.filter(c => c.status === 'rejected').length
  const pendingCount = claims.filter(c => c.status === 'pending').length

  const coreClaimsFound = claims.filter(c => c.source === 'core').length
  const aiDiscoveredCount = claims.filter(c => c.source === 'ai_discovered').length

  // Count claims by type for unavailable chip styling
  const claimCountsByType = Object.keys(CLAIM_TYPES).reduce((acc, type) => {
    acc[type] = claims.filter(c => c.type === type).length
    return acc
  }, {})

  const canAnalyze = document && selectedDocType && !isAnalyzing

  const claimFilterTabs = [
    { label: `All (${claims.length})`, content: null },
    { label: `Pending (${pendingCount})`, content: null },
    { label: `Approved (${approvedCount})`, content: null },
    { label: `Rejected (${rejectedCount})`, content: null }
  ]

  return (
    <div className="page">
      <div className="header">
        <div className="headerLeft">
          <div className="titleSection">
            <h1 className="title">Claims Detector</h1>
            <Badge variant="info">POC</Badge>
            {demoMode && (
              <>
                <Badge variant="warning">Demo Mode</Badge>
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => setShowModelComparison(true)}
                >
                  <Icon name="settings" size={16} />
                  Compare Models
                </Button>
              </>
            )}
          </div>
          <p className="subtitle">
            AI-powered detection of medical and regulatory claims in pharmaceutical documents
          </p>
        </div>
        <div className="headerRight">
          <ThemeToggle />
        </div>
      </div>

      <div className="workbench">
        {/* Config Panel */}
        <div className="configPanel">
          <AccordionItem
            title="Document"
            defaultOpen={true}
            size="small"
            content={
              <FileUpload
                accept=".pdf,.docx"
                maxSize={10485760}
                state={uploadState}
                uploadProgress={uploadProgress}
                onUpload={handleFileUpload}
                onRemove={handleDocumentClose}
                mockMode={true}
                mockFileName="CardioMax_Clinical_Trial_Summary.pdf"
              />
            }
          />

          <AccordionItem
            title="Settings"
            defaultOpen={true}
            size="small"
            content={
              <div className="settingsContent">
                <DocumentTypeSelector
                  selectedType={selectedDocType}
                  onTypeSelect={setSelectedDocType}
                />

                {!demoMode && (
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
                )}

                <div className="settingItem">
                  <label className="settingLabel">AI Discovery</label>
                  <div className="toggleRow">
                    <Toggle
                      checked={aiDiscoveryEnabled}
                      onChange={(e) => setAiDiscoveryEnabled(e.target.checked)}
                      size="small"
                    />
                    <span className={`toggleStatus ${aiDiscoveryEnabled ? 'active' : ''}`}>
                      {aiDiscoveryEnabled ? 'Enhanced Search' : 'Core Claims Only'}
                    </span>
                  </div>
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

          {analysisComplete && (
            <AccordionItem
              title="Results Summary"
              defaultOpen={true}
              size="small"
              content={
                <div className="resultsSummary">
                  <div className="coreClaimsRow">
                    <span className="resultLabel">Core Claims Found</span>
                    <span className="resultValue resultNumber">{coreClaimsFound}</span>
                  </div>
                  {aiDiscoveryEnabled && aiDiscoveredCount > 0 && (
                    <div className="aiDiscoveredRow">
                      <span className="resultLabel">AI-Discovered</span>
                      <span className="resultValue aiValue">+{aiDiscoveredCount}</span>
                    </div>
                  )}
                  <div className="divider" />
                  <div className="statusRow">
                    <StatCard label="Approved" value={approvedCount} size="small" trend={approvedCount > 0 ? 'up' : 'neutral'} />
                    <StatCard label="Rejected" value={rejectedCount} size="small" trend={rejectedCount > 0 ? 'down' : 'neutral'} />
                    <StatCard label="Pending" value={pendingCount} size="small" />
                  </div>
                  <div className="metaRow">
                    <span className="metaItem">
                      <Icon name="zap" size={14} />
                      {(processingTime / 1000).toFixed(1)}s
                    </span>
                    <span className="metaDot">•</span>
                    <span className="metaItem">{MODEL_OPTIONS.find(m => m.id === selectedModel)?.label}</span>
                  </div>
                </div>
              }
            />
          )}

          <PromptEditor />
        </div>

        {/* Document Viewer Panel */}
        <div className="documentPanel">
          <DocumentViewer
            document={document}
            claims={claims}
            activeClaim={activeClaim}
            shouldFlash={shouldFlashHighlight}
            onClaimClick={handleClaimClick}
            onClose={handleDocumentClose}
            isScanning={isAnalyzing}
            onScanComplete={handleScanComplete}
          />
        </div>

        {/* Claims Panel */}
        <div className="claimsPanel">
          <div className="claimsPanelHeader">
            <Tabs
              tabs={[
                { label: 'Claims', content: null },
                { label: 'Library', content: null }
              ]}
              variant="underlined"
              size="small"
              defaultActiveIndex={rightPanelTab}
              onChange={(index) => setRightPanelTab(index)}
              showPanels={false}
            />
          </div>

          <div className="claimsPanelBody">
            {rightPanelTab === 0 ? (
              <>
                {analysisComplete && (
                  <>
                    <div className="claimsFilterBar">
                      <Tabs
                        tabs={claimFilterTabs}
                        variant="underlined"
                        size="small"
                        defaultActiveIndex={0}
                        onChange={(index) => {
                          const filters = ['all', 'pending', 'approved', 'rejected']
                          setClaimFilter(filters[index])
                        }}
                      />
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

                    <div className="typeFilters">
                      {/* AI filter chip with distinct styling */}
                      {aiDiscoveryEnabled && aiDiscoveredCount > 0 && (
                        <button
                          className={`typeChip aiChip ${showAIOnly ? 'active' : ''}`}
                          onClick={() => setShowAIOnly(!showAIOnly)}
                        >
                          ✦ AI
                        </button>
                      )}
                      {Object.entries(CLAIM_TYPES).map(([key, config]) => {
                        const isUnavailable = claimCountsByType[key] === 0
                        return (
                          <button
                            key={key}
                            className={`typeChip ${typeFilters.includes(key) ? 'active' : ''} ${isUnavailable ? 'unavailable' : ''}`}
                            style={{ '--chip-color': config.color }}
                            onClick={() => {
                              if (isUnavailable) return
                              setTypeFilters(prev =>
                                prev.includes(key)
                                  ? prev.filter(t => t !== key)
                                  : [...prev, key]
                              )
                            }}
                            disabled={isUnavailable}
                          >
                            {config.label}
                          </button>
                        )
                      })}
                      {(typeFilters.length > 0 || showAIOnly) && (
                        <button className="clearFilters" onClick={() => { setTypeFilters([]); setShowAIOnly(false) }}>
                          Clear
                        </button>
                      )}
                    </div>
                  </>
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

                  {analysisComplete && filteredClaims.length === 0 && (
                    <div className="claimsEmptyState">
                      <Icon name="search" size={48} />
                      <p>No claims match your filter</p>
                    </div>
                  )}

                  {analysisComplete && filteredClaims.map(claim => (
                    <div key={claim.id} data-claim-id={claim.id}>
                      <ClaimCard
                        claim={claim}
                        isActive={activeClaim === claim.id}
                        onApprove={handleClaimApprove}
                        onReject={handleClaimReject}
                        onSelect={() => handleCardClick(claim.id)}
                        onTypeChange={handleClaimTypeChange}
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <LibraryTab
                documents={referenceDocuments}
                onUpload={handleReferenceUpload}
                onRename={handleReferenceRename}
                onDelete={handleReferenceDelete}
              />
            )}
          </div>
        </div>
      </div>

      {/* Model Comparison Modal */}
      {showModelComparison && (
        <div className="modalOverlay" onClick={() => setShowModelComparison(false)}>
          <div className="modalContent" onClick={e => e.stopPropagation()}>
            <div className="modalHeader">
              <h2>Model Comparison</h2>
              <Button
                variant="ghost"
                size="small"
                onClick={() => setShowModelComparison(false)}
              >
                <Icon name="x" size={20} />
              </Button>
            </div>
            <ModelComparison
              onRunAllModels={() => {}}
              onSelectModel={(model) => {
                setSelectedModel(model)
                setShowModelComparison(false)
              }}
            />
          </div>
        </div>
      )}

    </div>
  )
}
