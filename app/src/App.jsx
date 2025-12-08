import { useState, useEffect, useRef } from 'react'
import './App.css'
import FileUpload from '@/components/molecules/FileUpload/FileUpload'
import DropdownMenu from '@/components/molecules/DropdownMenu/DropdownMenu'
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import Alert from '@/components/molecules/Alert/Alert'
import Spinner from '@/components/atoms/Spinner/Spinner'
import Badge from '@/components/atoms/Badge/Badge'
import StatCard from '@/components/molecules/StatCard/StatCard'
import AccordionItem from '@/components/molecules/AccordionItem/AccordionItem'
import Tabs from '@/components/molecules/Tabs/Tabs'
import Input from '@/components/atoms/Input/Input'
import ClaimCard from '@/components/claims-detector/ClaimCard'
import DocumentViewer from '@/components/claims-detector/DocumentViewer'
import PromptEditor from '@/components/claims-detector/PromptEditor'
import ModelComparison from '@/components/claims-detector/ModelComparison'
import Toggle from '@/components/atoms/Toggle/Toggle'
import { getRandomDocument, getAIAnalysisDocument } from '@/mocks/documents'
import { getClaimsForDocument, getCoreClaimsCount, getAIDiscoveredCount, getAIAnalysisClaims, CLAIM_TYPES } from '@/mocks/claims'

const MOCK_CLAIMS = [
  {
    id: 'claim_001',
    text: 'Reduces symptoms by 50% in clinical trials conducted over 12 weeks with 500 participants',
    confidence: 0.92,
    location: { paragraph: 3, charStart: 145, charEnd: 198 },
    status: 'pending',
    type: 'efficacy'
  },
  {
    id: 'claim_002',
    text: 'FDA approved for ages 18 and older with no major contraindications',
    confidence: 0.88,
    location: { paragraph: 5, charStart: 220, charEnd: 285 },
    status: 'pending',
    type: 'regulatory'
  },
  {
    id: 'claim_003',
    text: 'Outperforms leading competitor by 35% in efficacy measures',
    confidence: 0.78,
    location: { paragraph: 7, charStart: 340, charEnd: 395 },
    status: 'pending',
    type: 'comparative'
  },
  {
    id: 'claim_004',
    text: 'May cause mild side effects in less than 5% of patients',
    confidence: 0.65,
    location: { paragraph: 12, charStart: 580, charEnd: 635 },
    status: 'pending',
    type: 'safety'
  },
  {
    id: 'claim_005',
    text: 'Clinically proven to improve quality of life scores',
    confidence: 0.54,
    location: { paragraph: 15, charStart: 720, charEnd: 770 },
    status: 'pending',
    type: 'efficacy'
  }
]

const BRAND_OPTIONS = [
  { label: 'Novartis' },
  { label: 'Pfizer' },
  { label: 'Merck' },
  { label: 'Amgen' },
  { label: 'Johnson & Johnson' },
  { label: 'AI Analysis', icon: 'zap', iconColor: '#F59E0B' },
  { divider: true },
  { label: 'Upload Custom...', icon: 'upload' }
]

const MODEL_OPTIONS = [
  { id: 'gemini-3', label: 'Google Gemini 3' },
  { id: 'claude-opus', label: 'Claude Opus 4.5' },
  { id: 'gpt-4o', label: 'OpenAI GPT-4o' }
]

function App() {
  const [demoMode, setDemoMode] = useState(false)
  const [uploadState, setUploadState] = useState('empty')
  const [document, setDocument] = useState(null)
  const [selectedBrand, setSelectedBrand] = useState(null)
  const [selectedModel, setSelectedModel] = useState('gemini-3')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [claims, setClaims] = useState([])
  const [analysisComplete, setAnalysisComplete] = useState(false)
  const [processingTime, setProcessingTime] = useState(0)
  const [masterPrompt, setMasterPrompt] = useState('')
  const [activeClaim, setActiveClaim] = useState(null)
  const [claimFilter, setClaimFilter] = useState('all')
  const [typeFilters, setTypeFilters] = useState([])
  const [sourceFilter, setSourceFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState('high-low')
  const [showModelComparison, setShowModelComparison] = useState(false)
  const [aiDiscoveryEnabled, setAiDiscoveryEnabled] = useState(true)
  const [showAIOnly, setShowAIOnly] = useState(false)
  const [showCustomBrandModal, setShowCustomBrandModal] = useState(false)
  const [customBrand, setCustomBrand] = useState({ name: '', description: '' })
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

  const handleFileUpload = (file) => {
    const mockDoc = getRandomDocument()
    setDocument(mockDoc)
    setUploadState('complete')
    setAnalysisComplete(false)
    setClaims([])
    setActiveClaim(null)
  }

  const handleBrandSelect = (brand) => {
    if (brand === 'Upload Custom...') {
      setShowCustomBrandModal(true)
      return
    }
    setSelectedBrand(brand)
  }

  const handleCustomBrandSave = () => {
    if (customBrand.name.trim()) {
      setSelectedBrand(customBrand.name)
      setShowCustomBrandModal(false)
      setCustomBrand({ name: '', description: '' })
    }
  }

  const handleAnalyze = () => {
    if (!document || !selectedBrand) return

    // For AI Analysis mode, swap to the AI Analysis document
    if (selectedBrand === 'AI Analysis') {
      setDocument(getAIAnalysisDocument())
    }

    setIsAnalyzing(true)
    setAnalysisComplete(false)
  }

  const handleScanComplete = () => {
    let mockClaims
    if (selectedBrand === 'AI Analysis') {
      // AI Analysis mode: use dedicated AI-only claims dataset
      mockClaims = getAIAnalysisClaims()
    } else {
      mockClaims = getClaimsForDocument(document.id)
      // Filter out AI-discovered claims if discovery is disabled
      if (!aiDiscoveryEnabled) {
        mockClaims = mockClaims.filter(c => c.source === 'core')
      }
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

  const handlePromptSave = (prompt) => {
    setMasterPrompt(prompt)
  }

  const handleDocumentClose = () => {
    setDocument(null)
    setUploadState('empty')
    setClaims([])
    setAnalysisComplete(false)
    setActiveClaim(null)
    setSelectedBrand(null)
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

  const canAnalyze = document && selectedBrand && !isAnalyzing

  const claimFilterTabs = [
    { label: `All (${claims.length})`, content: null },
    { label: `Pending (${pendingCount})`, content: null },
    { label: `Approved (${approvedCount})`, content: null },
    { label: `Rejected (${rejectedCount})`, content: null }
  ]

  return (
    <div className="page">
      <div className="header">
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
                onUpload={handleFileUpload}
                onRemove={handleDocumentClose}
                mockMode={true}
                mockFileName={document?.title || 'Clinical_Trial_Summary.pdf'}
              />
            }
          />

          <AccordionItem
            title="Settings"
            defaultOpen={true}
            size="small"
            content={
              <div className="settingsContent">
                <div className="settingItem">
                  <label className="settingLabel">Client Selection</label>
                  <DropdownMenu
                    trigger="button"
                    triggerLabel={selectedBrand || 'Select client...'}
                    items={BRAND_OPTIONS.map(item => ({
                      ...item,
                      onClick: item.divider ? undefined : () => handleBrandSelect(item.label)
                    }))}
                    size="medium"
                  />
                </div>

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
                  {selectedBrand === 'AI Analysis' ? (
                    <div className="aiDiscoveredRow">
                      <span className="resultLabel">AI-Discovered Claims</span>
                      <span className="resultValue aiValue">{claims.length}</span>
                    </div>
                  ) : (
                    <>
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
                    </>
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

          <PromptEditor onSave={handlePromptSave} />
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
            <h2 className="claimsPanelTitle">
              Claims
              {claims.length > 0 && (
                <Badge variant="neutral">{claims.length}</Badge>
              )}
            </h2>
          </div>

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
              onRunAllModels={() => console.log('Running all models')}
              onSelectModel={(model) => {
                setSelectedModel(model)
                setShowModelComparison(false)
              }}
            />
          </div>
        </div>
      )}

      {/* Custom Brand Modal */}
      {showCustomBrandModal && (
        <div className="modalOverlay" onClick={() => setShowCustomBrandModal(false)}>
          <div className="modalContent modalSmall" onClick={e => e.stopPropagation()}>
            <div className="modalHeader">
              <h2>Add Custom Brand</h2>
              <Button
                variant="ghost"
                size="small"
                onClick={() => setShowCustomBrandModal(false)}
              >
                <Icon name="x" size={20} />
              </Button>
            </div>
            <div className="modalBody">
              <div className="formField">
                <label className="formLabel">Client Name</label>
                <Input
                  placeholder="Enter client name..."
                  value={customBrand.name}
                  onChange={(e) => setCustomBrand(prev => ({ ...prev, name: e.target.value }))}
                  size="medium"
                />
              </div>
              <div className="formField">
                <label className="formLabel">Description</label>
                <textarea
                  className="formTextarea"
                  placeholder="Brief description of the brand guidelines..."
                  value={customBrand.description}
                  onChange={(e) => setCustomBrand(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                />
              </div>
              <div className="formField">
                <label className="formLabel">Claims Document</label>
                <FileUpload
                  accept=".pdf,.docx,.xlsx"
                  maxSize={10485760}
                  onUpload={(file) => console.log('Claims doc uploaded:', file.name)}
                />
              </div>
              <div className="modalActions">
                <Button
                  variant="secondary"
                  size="medium"
                  onClick={() => setShowCustomBrandModal(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="medium"
                  onClick={handleCustomBrandSave}
                  disabled={!customBrand.name.trim()}
                >
                  Save Brand
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
