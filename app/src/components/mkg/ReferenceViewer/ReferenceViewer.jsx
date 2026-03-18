import { useState, useRef, useEffect, useMemo } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import * as api from '@/services/api'
import Spinner from '@/components/atoms/Spinner/Spinner'
import Icon from '@/components/atoms/Icon/Icon'
import Button from '@/components/atoms/Button/Button'
import { logger } from '@/utils/logger'
import { convertPdfRectsToViewport, sortMarkersForNavigation } from '@/utils/markerCoords'
import styles from './ReferenceViewer.module.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

/**
 * Reference Viewer - renders reference PDF with PDF.js canvas and a pin marker at the excerpt location
 */
export default function ReferenceViewer({ referenceId, page, excerpt, markers = [] }) {
  const [pdfDoc, setPdfDoc] = useState(null)
  const [currentPage, setCurrentPage] = useState(page || 1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pinY, setPinY] = useState(null)
  const [highlightRects, setHighlightRects] = useState([])
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 })
  const [pageHeightPts, setPageHeightPts] = useState(0)
  const [fitScale, setFitScale] = useState(1)
  const [activeMarkerIndex, setActiveMarkerIndex] = useState(0)
  const canvasRef = useRef(null)
  const textLayerRef = useRef(null)
  const containerRef = useRef(null)

  const hasMarkers = markers.length > 0
  const sortedMarkers = useMemo(() => sortMarkersForNavigation(markers), [markers])
  const currentPageMarkers = useMemo(
    () => sortedMarkers.filter(m => m.page_number === currentPage),
    [sortedMarkers, currentPage]
  )
  const activeMarker = sortedMarkers[activeMarkerIndex] || null

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
        const scrollAreaHeight = containerRef.current?.clientHeight || 700
        const fitWidth = (containerWidth - 48) / baseViewport.width
        const fitHeight = (scrollAreaHeight - 32) / baseViewport.height
        const computedFitScale = Math.min(fitWidth, fitHeight, 2.0)
        const viewport = pdfPage.getViewport({ scale: computedFitScale })
        if (!cancelled) {
          setPageHeightPts(baseViewport.height)
          setFitScale(computedFitScale)
        }

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

        // Find excerpt Y position in this page (only when no markers — markers replace excerpt search)
        if (excerpt && !hasMarkers && !cancelled) {
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
                  const width = Math.max(6, (item.width || 0) * computedFitScale)
                  const height = Math.max(10, (item.height || 0) * computedFitScale)
                  const left = item.transform[4] * computedFitScale
                  const top = (baseViewport.height - item.transform[5]) * computedFitScale - height
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
  }, [pdfDoc, currentPage, excerpt, totalPages, hasMarkers])

  // Scroll pin into view when located (excerpt fallback mode)
  useEffect(() => {
    if (pinY !== null && containerRef.current) {
      containerRef.current.scrollTop = Math.max(0, pinY - containerRef.current.clientHeight / 3)
    }
  }, [pinY, canvasSize])

  // Scroll active marker into view
  useEffect(() => {
    if (!hasMarkers || !containerRef.current || !activeMarker) return
    if (activeMarker.page_number !== currentPage) return
    const topRect = convertPdfRectsToViewport(
      activeMarker.rects, activeMarker.page_height || pageHeightPts, fitScale
    )[0]
    if (topRect) {
      // Only scroll if content overflows the container
      if (containerRef.current.scrollHeight > containerRef.current.clientHeight) {
        containerRef.current.scrollTop = Math.max(0, topRect.top - containerRef.current.clientHeight / 3)
      }
    }
  }, [activeMarkerIndex, currentPage, pageHeightPts, fitScale, hasMarkers, activeMarker])

  // Navigate to active marker's page when marker index changes
  useEffect(() => {
    if (!activeMarker) return
    if (activeMarker.page_number !== currentPage) {
      setCurrentPage(activeMarker.page_number)
    }
  }, [activeMarkerIndex, activeMarker])

  function handlePrevMarker() {
    setActiveMarkerIndex(i => Math.max(0, i - 1))
  }

  function handleNextMarker() {
    setActiveMarkerIndex(i => Math.min(sortedMarkers.length - 1, i + 1))
  }

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <Spinner size="large" />
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.errorState}>
        <Icon name="alertCircle" size={32} />
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      {/* Excerpt banner (only in excerpt fallback mode) */}
      {excerpt && !hasMarkers && (
        <div className={styles.excerptBanner}>
          <Icon name="mapPin" size={13} />
          <span className={styles.excerptLabel}>Supporting text:</span>
          <span className={styles.excerptText}>&ldquo;{excerpt}&rdquo;</span>
        </div>
      )}

      {/* Marker navigation bar */}
      {hasMarkers && (
        <div className={styles.markerNav}>
          <Button variant="ghost" size="small" onClick={handlePrevMarker} disabled={activeMarkerIndex <= 0}>
            <Icon name="chevronLeft" size={14} />
          </Button>
          <span className={styles.markerNavLabel}>
            Evidence {activeMarkerIndex + 1} of {sortedMarkers.length}
          </span>
          <Button variant="ghost" size="small" onClick={handleNextMarker} disabled={activeMarkerIndex >= sortedMarkers.length - 1}>
            <Icon name="chevronRight" size={14} />
          </Button>
        </div>
      )}

      {/* PDF canvas + overlays */}
      <div
        ref={containerRef}
        className={styles.scrollArea}
      >
        <div className={styles.canvasWrapper} style={{ width: canvasSize.width }}>
          <canvas ref={canvasRef} className={styles.pdfCanvas} />
          <div
            ref={textLayerRef}
            className={`textLayer ${styles.textLayer}`}
          />

          {/* Numbered pin dots on page — positioned at highlight locations */}
          {hasMarkers && currentPageMarkers.length > 0 && (
            <div className={styles.evidenceOverlay}>
              {currentPageMarkers.map((marker) => {
                const isActive = sortedMarkers.indexOf(marker) === activeMarkerIndex
                const viewportRects = convertPdfRectsToViewport(
                  marker.rects, marker.page_height || pageHeightPts, fitScale
                )
                if (!viewportRects.length) return null
                // Anchor to the first substantial rect (skip tiny fragments)
                const maxW = Math.max(...viewportRects.map(r => r.width))
                const substantial = viewportRects.filter(r => r.width >= maxW * 0.5)
                const anchor = (substantial.length ? substantial : viewportRects)
                  .reduce((best, r) => (r.top < best.top ? r : best))
                return (
                  <div
                    key={marker.marker_id}
                    className={`${styles.markerPin} ${isActive ? styles.markerPinActive : styles.markerPinInactive}`}
                    style={{
                      left: Math.max(0, anchor.left - (anchor.left > canvasSize.width * 0.4 ? 6 : 22)),
                      top: anchor.top,
                    }}
                    onClick={() => setActiveMarkerIndex(sortedMarkers.indexOf(marker))}
                    title={marker.text ? marker.text.slice(0, 120) : `Evidence ${marker.label}`}
                  />
                )
              })}
            </div>
          )}

          {/* Text highlight overlay for matched supporting excerpt (fallback) */}
          {!hasMarkers && highlightRects.length > 0 && (
            <div className={styles.highlightOverlay}>
              {highlightRects.map((rect, idx) => (
                <div
                  key={`${rect.left}-${rect.top}-${idx}`}
                  className={styles.highlightRect}
                  style={{
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                  }}
                />
              ))}
            </div>
          )}

          {/* Amber pin marker in the left margin (fallback mode only) */}
          {!hasMarkers && pinY !== null && (
            <div
              title={excerpt}
              className={styles.pinMarker}
              style={{ top: pinY }}
            />
          )}
        </div>
      </div>

      {/* Page navigation */}
      {totalPages > 1 && (
        <div className={styles.pageNav}>
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
