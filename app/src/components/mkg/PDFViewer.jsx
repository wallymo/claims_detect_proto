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
  onScanComplete
}) {
  const [pdf, setPdf] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const canvasRef = useRef(null)
  const containerRef = useRef(null)

  // Load PDF when file changes
  useEffect(() => {
    if (!file) {
      setPdf(null)
      setTotalPages(0)
      setCurrentPage(1)
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

  const handlePrevPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1))
  }

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1))
  }

  const handleZoomIn = () => {
    setScale(prev => Math.min(2, prev + 0.25))
  }

  const handleZoomOut = () => {
    setScale(prev => Math.max(0.5, prev - 0.25))
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
          <Button variant="ghost" size="small" onClick={handleZoomIn} disabled={scale >= 2}>
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
        <div className={styles.content} ref={containerRef}>
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
            <canvas ref={canvasRef} className={styles.pdfCanvas} />
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
