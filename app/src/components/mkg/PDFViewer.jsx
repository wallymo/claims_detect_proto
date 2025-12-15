import { useState, useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import styles from './PDFViewer.module.css'
import Icon from '@/components/atoms/Icon/Icon'
import Button from '@/components/atoms/Button/Button'
import Spinner from '@/components/atoms/Spinner/Spinner'
import ScannerOverlay from '@/components/claims-detector/ScannerOverlay'

// Use unpkg CDN for worker (cdnjs doesn't have v5)
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.mjs`
console.log('PDF.js legacy build, version:', pdfjsLib.version)

export default function PDFViewer({
  file,
  onClose,
  isAnalyzing = false,
  analysisProgress = 0,
  analysisStatus = 'Analyzing document...',
  onScanComplete,
  claims = [],
  activeClaimId = null,
  onClaimSelect
}) {
  const [pdf, setPdf] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  // Pan state for drag navigation
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 })

  const canvasRef = useRef(null)
  const containerRef = useRef(null)

  // Helper for confidence-based marker colors
  const getConfidenceClass = (confidence) => {
    if (confidence >= 0.8) return styles.markerHigh
    if (confidence >= 0.5) return styles.markerMedium
    return styles.markerLow
  }

  // Filter claims for current page
  const currentPageClaims = claims.filter(c => c.page === currentPage)

  // Load PDF when file changes
  useEffect(() => {
    if (!file) {
      setPdf(null)
      setTotalPages(0)
      setCurrentPage(1)
      setPanX(0)
      setPanY(0)
      return
    }

    const loadPDF = async () => {
      console.log('Loading PDF:', file.name, file.size, 'bytes')
      setIsLoading(true)
      setError(null)

      try {
        const arrayBuffer = await file.arrayBuffer()
        console.log('Got arrayBuffer, size:', arrayBuffer.byteLength)
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
        console.log('Created loading task')
        const loadedPdf = await loadingTask.promise
        console.log('PDF loaded, pages:', loadedPdf.numPages)
        setPdf(loadedPdf)
        setTotalPages(loadedPdf.numPages)
        setCurrentPage(1)
        setPanX(0)
        setPanY(0)
      } catch (err) {
        console.error('PDF load error:', err)
        setError(`Failed to load PDF: ${err.message}`)
      } finally {
        setIsLoading(false)
      }
    }

    loadPDF()
  }, [file])

  // Render current page
  useEffect(() => {
    if (!pdf || !canvasRef.current) return

    const renderPage = async () => {
      try {
        const page = await pdf.getPage(currentPage)
        const canvas = canvasRef.current
        const context = canvas.getContext('2d')

        // Calculate scale to fit container width
        const containerWidth = containerRef.current?.clientWidth || 600
        const viewport = page.getViewport({ scale: 1 })
        const fitScale = (containerWidth - 48) / viewport.width
        const scaledViewport = page.getViewport({ scale: fitScale * scale })

        canvas.height = scaledViewport.height
        canvas.width = scaledViewport.width

        // Track canvas dimensions for pan bounds
        setCanvasDimensions({ width: scaledViewport.width, height: scaledViewport.height })

        await page.render({
          canvasContext: context,
          viewport: scaledViewport
        }).promise
      } catch (err) {
        console.error('Page render error:', err)
      }
    }

    renderPage()
  }, [pdf, currentPage, scale])

  // Reset pan when page changes
  useEffect(() => {
    setPanX(0)
    setPanY(0)
  }, [currentPage])

  // Navigate to claim's page when activeClaimId changes
  useEffect(() => {
    if (activeClaimId) {
      const claim = claims.find(c => c.id === activeClaimId)
      if (claim && claim.page !== currentPage) {
        setCurrentPage(claim.page)
      }
    }
  }, [activeClaimId, claims, currentPage])

  const handlePrevPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1))
  }

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1))
  }

  // Calculate pan bounds based on canvas vs container size
  const containerWidth = containerRef.current?.clientWidth || 600
  const containerHeight = containerRef.current?.clientHeight || 400
  const overflowX = Math.max(0, canvasDimensions.width - containerWidth + 48) // account for padding
  const overflowY = Math.max(0, canvasDimensions.height - containerHeight + 48)
  const maxPanX = overflowX / 2
  const maxPanY = overflowY / 2
  const canPan = overflowX > 0 || overflowY > 0

  // Clamp helper
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

  // Clamp pan to bounds for a given scale
  const clampPan = (x, y) => ({
    x: clamp(x, -maxPanX, maxPanX),
    y: clamp(y, -maxPanY, maxPanY)
  })

  const handleZoomIn = () => {
    const newScale = Math.min(3, scale + 0.25)
    const ratio = newScale / scale
    // Proportionally adjust pan to maintain focus area
    const newPan = clampPan(panX * ratio, panY * ratio)
    setPanX(newPan.x)
    setPanY(newPan.y)
    setScale(newScale)
  }

  const handleZoomOut = () => {
    const newScale = Math.max(0.5, scale - 0.25)
    const ratio = newScale / scale
    const newPan = clampPan(panX * ratio, panY * ratio)
    setPanX(newPan.x)
    setPanY(newPan.y)
    setScale(newScale)
    // Reset pan if we're back to fitting in container
    if (newScale <= 1.0) {
      setPanX(0)
      setPanY(0)
    }
  }

  // Drag handlers for panning
  const handleMouseDown = (e) => {
    if (!canPan) return
    e.preventDefault()
    setIsDragging(true)
    setDragStart({ x: e.clientX - panX, y: e.clientY - panY })
  }

  const handleMouseMove = (e) => {
    if (!isDragging) return
    const newPanX = e.clientX - dragStart.x
    const newPanY = e.clientY - dragStart.y
    setPanX(clamp(newPanX, -maxPanX, maxPanX))
    setPanY(clamp(newPanY, -maxPanY, maxPanY))
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleMouseLeave = () => {
    setIsDragging(false)
  }

  const handleMarkerClick = (e, claimId) => {
    e.stopPropagation()
    onClaimSelect?.(claimId)
  }

  const handleCanvasClick = (e) => {
    // Clear selection when clicking canvas (not a marker)
    if (e.target === canvasRef.current || e.target.classList.contains(styles.content)) {
      onClaimSelect?.(null)
    }
  }

  // Empty state - matches DocumentViewer
  if (!file) {
    return (
      <div className={styles.documentViewer}>
        <div className={styles.emptyState}>
          <Icon name="file" size={48} />
          <h3>No Document</h3>
          <p>Upload a document to preview it here</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.documentViewer}>
      {/* Header - matches DocumentViewer */}
      <div className={styles.header}>
        <div className={styles.fileInfo}>
          <Icon name="file" size={16} />
          <span className={styles.fileName}>{file.name}</span>
        </div>
        <div className={styles.toolbar}>
          <Button variant="ghost" size="small" onClick={handleZoomOut} disabled={scale <= 0.5}>
            <Icon name="zoomOut" size={14} />
          </Button>
          <span className={styles.zoom}>{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="small" onClick={handleZoomIn} disabled={scale >= 3}>
            <Icon name="zoomIn" size={14} />
          </Button>
          {onClose && (
            <Button variant="ghost" size="small" onClick={onClose}>
              <Icon name="x" size={16} />
            </Button>
          )}
        </div>
      </div>

      {/* Content wrapper - matches DocumentViewer */}
      <div className={styles.contentWrapper}>
        <div
          className={`${styles.content} ${canPan ? styles.canPan : ''} ${isDragging ? styles.dragging : ''}`}
          ref={containerRef}
          onClick={handleCanvasClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          {isLoading && (
            <div className={styles.loadingState}>
              <Spinner size="large" />
              <p>Loading PDF...</p>
            </div>
          )}

          {error && (
            <div className={styles.errorState}>
              <Icon name="alertCircle" size={48} />
              <p>{error}</p>
            </div>
          )}

          {!isLoading && !error && (
            <>
              <canvas
                ref={canvasRef}
                className={styles.pdfCanvas}
                style={{
                  transform: `translate(${panX}px, ${panY}px)`
                }}
              />
              {currentPageClaims.length > 0 && (
                <div
                  className={styles.markersLayer}
                  style={{
                    width: canvasDimensions.width,
                    height: canvasDimensions.height,
                    transform: `translate(${panX}px, ${panY}px)`
                  }}
                >
                  {currentPageClaims.map(claim => (
                    <button
                      key={claim.id}
                      className={`${styles.marker} ${getConfidenceClass(claim.confidence)} ${activeClaimId === claim.id ? styles.active : ''}`}
                      style={{
                        left: `${claim.position.x}%`,
                        top: `${claim.position.y}%`
                      }}
                      onClick={(e) => handleMarkerClick(e, claim.id)}
                      title={claim.text}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Scanner overlay */}
        <ScannerOverlay
          isScanning={isAnalyzing}
          progress={analysisProgress}
          statusText={analysisStatus}
          onComplete={onScanComplete}
        />
      </div>

      {/* Footer - page navigation */}
      {totalPages > 0 && (
        <div className={styles.footer}>
          {currentPageClaims.length > 0 && (
            <span className={styles.claimCount}>
              {currentPageClaims.length} claim{currentPageClaims.length !== 1 ? 's' : ''} on this page
            </span>
          )}
          <div className={styles.pageNav}>
            <Button variant="ghost" size="small" onClick={handlePrevPage} disabled={currentPage <= 1}>
              <Icon name="chevronLeft" size={14} />
            </Button>
            <span className={styles.pageInfo}>
              Page {currentPage} of {totalPages}
            </span>
            <Button variant="ghost" size="small" onClick={handleNextPage} disabled={currentPage >= totalPages}>
              <Icon name="chevronRight" size={14} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
