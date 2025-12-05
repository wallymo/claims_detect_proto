import { useState, useEffect } from 'react'
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
import { getRandomDocument } from '@/mocks/documents'
import { getClaimsForDocument, getCoreClaimsCount, getAIDiscoveredCount, CLAIM_TYPES } from '@/mocks/claims'

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
  { label: 'Novartis', onClick: () => {} },
  { label: 'Pfizer', onClick: () => {} },
  { label: 'Merck', onClick: () => {} },
  { divider: true },
  { label: 'Upload Custom...', icon: 'upload', onClick: () => {} }
]

const MODEL_OPTIONS = [
  { label: 'Gemini 3', onClick: () => {} },
  { label: 'Claude Opus 4.5', onClick: () => {} },
  { label: 'GPT-4o', onClick: () => {} }
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
  const [showModelComparison, setShowModelComparison] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setDemoMode(params.get('demo') === 'true')
  }, [])

  const handleFileUpload = (file) => {
    const mockDoc = getRandomDocument()
    setDocument(mockDoc)
    setUploadState('complete')
    setAnalysisComplete(false)
    setClaims([])
    setActiveClaim(null)
  }

  const handleBrandSelect = (brand) => {
    setSelectedBrand(brand)
  }

  const handleAnalyze = () => {
    if (!document || !selectedBrand) return
    setIsAnalyzing(true)
    setAnalysisComplete(false)
  }

  const handleScanComplete = () => {
    const mockClaims = getClaimsForDocument(document.id)
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

  const handleClaimClick = (claimId) => {
    setActiveClaim(claimId)
  }

  const handlePromptSave = (prompt) => {
    setMasterPrompt(prompt)
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
      if (!searchQuery) return true
      return c.text.toLowerCase().includes(searchQuery.toLowerCase())
    })
    .sort((a, b) => b.confidence - a.confidence)

  const approvedCount = claims.filter(c => c.status === 'approved').length
  const rejectedCount = claims.filter(c => c.status === 'rejected').length
  const pendingCount = claims.filter(c => c.status === 'pending').length

  const coreClaimsFound = claims.filter(c => c.source === 'core').length
  const totalCoreClaims = document?.coreClaims || 0
  const aiDiscoveredCount = claims.filter(c => c.source === 'ai_discovered').length

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
                  <label className="settingLabel">Brand Guidelines</label>
                  <DropdownMenu
                    trigger="button"
                    triggerLabel={selectedBrand || 'Select brand...'}
                    items={BRAND_OPTIONS.map(item => ({
                      ...item,
                      onClick: item.divider ? undefined : () => handleBrandSelect(item.label)
                    }))}
                    size="medium"
                  />
                </div>

                {!demoMode && (
                  <div className="settingItem">
                    <label className="settingLabel">AI Model</label>
                    <DropdownMenu
                      trigger="button"
                      triggerLabel={
                        selectedModel === 'gemini-3' ? 'Gemini 3' :
                        selectedModel === 'claude-opus' ? 'Claude Opus 4.5' : 'GPT-4o'
                      }
                      items={MODEL_OPTIONS.map(item => ({
                        ...item,
                        onClick: () => setSelectedModel(
                          item.label.toLowerCase().replace(' ', '-').replace('.', '')
                        )
                      }))}
                      size="medium"
                    />
                  </div>
                )}
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
                    <div className="resultValue">
                      <span className="resultNumber">{coreClaimsFound} of {totalCoreClaims}</span>
                      <div className="miniProgress">
                        <div
                          className="miniProgressBar"
                          style={{ width: `${(coreClaimsFound / totalCoreClaims) * 100}%` }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="aiDiscoveredRow">
                    <span className="resultLabel">AI-Discovered</span>
                    <span className="resultValue aiValue">+{aiDiscoveredCount} new</span>
                  </div>
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
                    <span className="metaItem">{
                      selectedModel === 'gemini-3' ? 'Gemini 3' :
                      selectedModel === 'claude-opus' ? 'Claude Opus 4.5' : 'GPT-4o'
                    }</span>
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
            onClaimClick={handleClaimClick}
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
                <div className="claimsSearch">
                  <Input
                    placeholder="Search claims..."
                    size="small"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              <div className="typeFilters">
                {Object.entries(CLAIM_TYPES).map(([key, config]) => (
                  <button
                    key={key}
                    className={`typeChip ${typeFilters.includes(key) ? 'active' : ''}`}
                    style={{ '--chip-color': config.color }}
                    onClick={() => {
                      setTypeFilters(prev =>
                        prev.includes(key)
                          ? prev.filter(t => t !== key)
                          : [...prev, key]
                      )
                    }}
                  >
                    {config.label}
                  </button>
                ))}
                {typeFilters.length > 0 && (
                  <button className="clearFilters" onClick={() => setTypeFilters([])}>
                    Clear
                  </button>
                )}
              </div>

              <Alert
                type="info"
                message="Click a claim to highlight it in the document. Use thumbs up/down to approve or reject."
                dismissible={true}
                size="small"
              />
            </>
          )}

          <div className="claimsList">
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
              <ClaimCard
                key={claim.id}
                claim={claim}
                isActive={activeClaim === claim.id}
                onApprove={handleClaimApprove}
                onReject={handleClaimReject}
                onSelect={() => handleClaimClick(claim.id)}
              />
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
    </div>
  )
}

export default App
