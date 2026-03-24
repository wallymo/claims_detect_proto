import { useState, useRef, useEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs'
import pdfjsWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import * as api from '@/services/api'
import Spinner from '@/components/atoms/Spinner/Spinner'
import Icon from '@/components/atoms/Icon/Icon'
import Button from '@/components/atoms/Button/Button'
import { logger } from '@/utils/logger'
import styles from './ReferenceViewer.module.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

function pdfRectToViewport(rect, fitScale) {
  return {
    left: rect.x0 * fitScale,
    top: rect.y0 * fitScale,
    width: (rect.x1 - rect.x0) * fitScale,
    height: (rect.y1 - rect.y0) * fitScale,
  }
}

/**
 * Reference Viewer — renders reference PDF with evidence suggestion sidebar,
 * accept/reject workflow, and manual draw mode for evidence boxes.
 */
export default function ReferenceViewer({ referenceId, page, excerpt, claimId, claimText }) {
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

  // Evidence suggestion state
  const [suggestions, setSuggestions] = useState([])
  const [acceptedEvidence, setAcceptedEvidence] = useState([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeSuggestionId, setActiveSuggestionId] = useState(null)
  const [drawMode, setDrawMode] = useState(false)
  const [drawStart, setDrawStart] = useState(null)
  const [drawingRect, setDrawingRect] = useState(null)
  const [editingBoxId, setEditingBoxId] = useState(null)
  const [resizing, setResizing] = useState(null) // { evidenceId, edge, startX, startY, originalRect }

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

  // Fetch accepted evidence on mount
  useEffect(() => {
    if (!claimId || !referenceId) return
    let cancelled = false
    async function loadAccepted() {
      try {
        const data = await api.fetchAcceptedEvidence(claimId, referenceId)
        if (!cancelled) setAcceptedEvidence(data.evidence || [])
      } catch (err) {
        logger.error('Failed to load accepted evidence:', err)
      }
    }
    loadAccepted()
    return () => { cancelled = true }
  }, [claimId, referenceId])

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

        // Excerpt highlighting
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
  }, [pdfDoc, currentPage, excerpt, totalPages])

  // Scroll pin into view
  useEffect(() => {
    if (pinY !== null && containerRef.current) {
      containerRef.current.scrollTop = Math.max(0, pinY - containerRef.current.clientHeight / 3)
    }
  }, [pinY, canvasSize])

  // Suggest evidence handler
  async function handleSuggestEvidence() {
    if (!claimId || !claimText || !referenceId) return
    setSuggestionsLoading(true)
    setSidebarOpen(true)
    try {
      const data = await api.generateEvidenceSuggestions({
        claim_text: claimText,
        claim_id: claimId,
        reference_id: referenceId,
      })
      setSuggestions(data.suggestions || [])
    } catch (err) {
      logger.error('Evidence suggestion failed:', err)
    } finally {
      setSuggestionsLoading(false)
    }
  }

  // Auto-run suggestions when PDF loads (if claim context available)
  useEffect(() => {
    if (pdfDoc && claimId && claimText && referenceId && suggestions.length === 0 && !suggestionsLoading) {
      handleSuggestEvidence()
    }
  }, [pdfDoc]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-analyze: clear cached suggestions and re-run
  async function handleReanalyze() {
    // Clear existing suggestions from state
    setSuggestions([])
    // Delete cached suggestions from DB so pipeline runs fresh
    try {
      await api.clearEvidenceSuggestions(claimId, referenceId)
    } catch {
      // OK if this fails — generateSuggestions will overwrite
    }
    handleSuggestEvidence()
  }

  async function handleAcceptSuggestion(suggestion) {
    try {
      await api.updateEvidenceSuggestionStatus(suggestion.suggestion_id, 'accepted')
      setSuggestions(prev => prev.map(s =>
        s.suggestion_id === suggestion.suggestion_id ? { ...s, status: 'accepted' } : s
      ))
      setAcceptedEvidence(prev => [...prev, {
        evidence_id: `ae_${suggestion.suggestion_id}`,
        claim_id: suggestion.claim_id,
        reference_id: suggestion.reference_id,
        page_number: suggestion.page_number,
        type: suggestion.type,
        rects: suggestion.rects,
        text: suggestion.text,
        origin: 'suggestion_accepted',
      }])
    } catch (err) {
      logger.error('Failed to accept suggestion:', err)
    }
  }

  async function handleUndoReject(suggestion) {
    try {
      await api.updateEvidenceSuggestionStatus(suggestion.suggestion_id, 'suggested')
      setSuggestions(prev => prev.map(s =>
        s.suggestion_id === suggestion.suggestion_id ? { ...s, status: 'suggested' } : s
      ))
    } catch (err) {
      logger.error('Failed to undo rejection:', err)
    }
  }

  async function handleRejectSuggestion(suggestion) {
    try {
      await api.updateEvidenceSuggestionStatus(suggestion.suggestion_id, 'rejected')
      setSuggestions(prev => prev.map(s =>
        s.suggestion_id === suggestion.suggestion_id ? { ...s, status: 'rejected' } : s
      ))
    } catch (err) {
      logger.error('Failed to reject suggestion:', err)
    }
  }

  function handleClickSuggestion(suggestion) {
    setActiveSuggestionId(suggestion.suggestion_id)
    if (suggestion.page_number !== currentPage) {
      setCurrentPage(suggestion.page_number)
    }
  }

  // Draw mode handlers
  function handleCanvasMouseDown(e) {
    if (!drawMode) return
    const wrapperRect = e.currentTarget.getBoundingClientRect()
    setDrawStart({ x: e.clientX - wrapperRect.left, y: e.clientY - wrapperRect.top })
    setDrawingRect(null)
  }

  function handleCanvasMouseMove(e) {
    if (!drawMode || !drawStart) return
    const wrapperRect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - wrapperRect.left
    const y = e.clientY - wrapperRect.top
    setDrawingRect({
      left: Math.min(drawStart.x, x),
      top: Math.min(drawStart.y, y),
      width: Math.abs(x - drawStart.x),
      height: Math.abs(y - drawStart.y),
    })
  }

  async function handleCanvasMouseUp() {
    if (!drawMode || !drawingRect) return
    const pdfRect = {
      x0: drawingRect.left / fitScale,
      y0: drawingRect.top / fitScale,
      x1: (drawingRect.left + drawingRect.width) / fitScale,
      y1: (drawingRect.top + drawingRect.height) / fitScale,
    }
    try {
      const data = await api.createManualEvidence({
        claim_id: claimId,
        reference_id: referenceId,
        page_number: currentPage,
        rects: [pdfRect],
        text: null,
      })
      if (data.evidence) {
        setAcceptedEvidence(prev => [...prev, { ...data.evidence, rects: [pdfRect] }])
      }
    } catch (err) {
      logger.error('Failed to save manual evidence:', err)
    }
    setDrawStart(null)
    setDrawingRect(null)
    setDrawMode(false)
    setSidebarOpen(true)
  }

  // Resize evidence box handlers
  function handleResizeStart(e, evidenceId, edge) {
    e.stopPropagation()
    e.preventDefault()
    const ev = acceptedEvidence.find(x => x.evidence_id === evidenceId)
    if (!ev || !ev.rects?.[0]) return
    const vp = pdfRectToViewport(ev.rects[0], fitScale)
    setResizing({
      evidenceId,
      edge,
      startX: e.clientX,
      startY: e.clientY,
      originalRect: { ...vp },
    })
  }

  useEffect(() => {
    if (!resizing) return
    function onMouseMove(e) {
      const dx = e.clientX - resizing.startX
      const dy = e.clientY - resizing.startY
      const r = { ...resizing.originalRect }
      if (resizing.edge.includes('n')) { r.top += dy; r.height -= dy }
      if (resizing.edge.includes('s')) { r.height += dy }
      if (resizing.edge.includes('w')) { r.left += dx; r.width -= dx }
      if (resizing.edge.includes('e')) { r.width += dx }
      // Enforce minimum size
      if (r.width < 20) r.width = 20
      if (r.height < 20) r.height = 20
      // Update accepted evidence rects in state (viewport → pdf coords)
      const pdfRect = {
        x0: r.left / fitScale,
        y0: r.top / fitScale,
        x1: (r.left + r.width) / fitScale,
        y1: (r.top + r.height) / fitScale,
      }
      setAcceptedEvidence(prev => prev.map(ev =>
        ev.evidence_id === resizing.evidenceId ? { ...ev, rects: [pdfRect] } : ev
      ))
    }
    function onMouseUp() {
      setResizing(null)
      setEditingBoxId(null)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [resizing, fitScale])

  function handleDeleteEvidence(evidenceId) {
    api.deleteAcceptedEvidence(evidenceId).catch(err =>
      logger.error('Failed to delete evidence:', err)
    )
    setAcceptedEvidence(prev => prev.filter(e => e.evidence_id !== evidenceId))
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

  const currentPageAccepted = acceptedEvidence.filter(e => e.page_number === currentPage)
  const activeSuggestion = suggestions.find(s => s.suggestion_id === activeSuggestionId)
  const showActiveSuggestionPreview = activeSuggestion && activeSuggestion.page_number === currentPage && activeSuggestion.status !== 'accepted'

  return (
    <div className={styles.container}>
      {/* Claim text header */}
      {claimText && (
        <div className={styles.claimHeader}>
          <div className={styles.claimHeaderContent}>
            <span className={styles.claimHeaderLabel}>Claim</span>
            <span className={styles.claimHeaderText} title={claimText}>{claimText}</span>
          </div>
          {!sidebarOpen && claimId && (
            <Button
              variant="ghost"
              size="small"
              onClick={() => setSidebarOpen(true)}
            >
              <Icon name="zap" size={14} />
            </Button>
          )}
        </div>
      )}

      {/* Split layout: PDF + sidebar */}
      <div className={styles.splitLayout}>
        {/* PDF panel */}
        <div className={styles.pdfPanel}>
          <div ref={containerRef} className={styles.scrollArea}>
            <div
              className={`${styles.canvasWrapper} ${drawMode ? styles.canvasWrapperDrawMode : ''}`}
              style={{ width: canvasSize.width }}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
            >
              <canvas ref={canvasRef} className={styles.pdfCanvas} />
              <div ref={textLayerRef} className={`textLayer ${styles.textLayer}`} />

              {/* Red evidence boxes for accepted evidence */}
              {currentPageAccepted.map((ev) => {
                const rects = Array.isArray(ev.rects) ? ev.rects : []
                const isEditing = editingBoxId === ev.evidence_id
                return rects.map((rect, ri) => {
                  const vp = pdfRectToViewport(rect, fitScale)
                  return (
                    <div
                      key={`${ev.evidence_id}-${ri}`}
                      className={`${styles.evidenceBox} ${isEditing ? styles.evidenceBoxEditing : ''}`}
                      style={{ left: vp.left, top: vp.top, width: vp.width, height: vp.height }}
                      onClick={(e) => { e.stopPropagation(); setEditingBoxId(isEditing ? null : ev.evidence_id) }}
                    >
                      {isEditing && (
                        <>
                          <div className={styles.resizeHandle} data-edge="nw" style={{ top: -4, left: -4 }} onMouseDown={(e) => handleResizeStart(e, ev.evidence_id, 'nw')} />
                          <div className={styles.resizeHandle} data-edge="ne" style={{ top: -4, right: -4 }} onMouseDown={(e) => handleResizeStart(e, ev.evidence_id, 'ne')} />
                          <div className={styles.resizeHandle} data-edge="sw" style={{ bottom: -4, left: -4 }} onMouseDown={(e) => handleResizeStart(e, ev.evidence_id, 'sw')} />
                          <div className={styles.resizeHandle} data-edge="se" style={{ bottom: -4, right: -4 }} onMouseDown={(e) => handleResizeStart(e, ev.evidence_id, 'se')} />
                          <div className={styles.resizeEdge} data-edge="n" style={{ top: -2, left: 4, right: 4, height: 4 }} onMouseDown={(e) => handleResizeStart(e, ev.evidence_id, 'n')} />
                          <div className={styles.resizeEdge} data-edge="s" style={{ bottom: -2, left: 4, right: 4, height: 4 }} onMouseDown={(e) => handleResizeStart(e, ev.evidence_id, 's')} />
                          <div className={styles.resizeEdge} data-edge="w" style={{ left: -2, top: 4, bottom: 4, width: 4 }} onMouseDown={(e) => handleResizeStart(e, ev.evidence_id, 'w')} />
                          <div className={styles.resizeEdge} data-edge="e" style={{ right: -2, top: 4, bottom: 4, width: 4 }} onMouseDown={(e) => handleResizeStart(e, ev.evidence_id, 'e')} />
                        </>
                      )}
                    </div>
                  )
                })
              })}

              {/* Dashed preview for active suggestion */}
              {activeSuggestionId && suggestions.filter(s => s.suggestion_id === activeSuggestionId && s.page_number === currentPage && s.status !== 'accepted').map(s =>
                (Array.isArray(s.rects) ? s.rects : []).map((rect, ri) => {
                  const vp = pdfRectToViewport(rect, fitScale)
                  if (vp.width < 1 || vp.height < 1) return null
                  return (
                    <div
                      key={`preview-${ri}`}
                      className={`${styles.evidenceBox} ${styles.evidenceBoxDashed}`}
                      style={{ left: vp.left, top: vp.top, width: vp.width, height: vp.height }}
                    />
                  )
                })
              )}

              {/* Drawing rectangle */}
              {drawingRect && (
                <div
                  className={styles.drawingRect}
                  style={{
                    left: drawingRect.left,
                    top: drawingRect.top,
                    width: drawingRect.width,
                    height: drawingRect.height,
                  }}
                />
              )}

              {/* Excerpt highlights (fallback) */}
              {highlightRects.length > 0 && (
                <div className={styles.highlightOverlay}>
                  {highlightRects.map((rect, idx) => (
                    <div
                      key={`${rect.left}-${rect.top}-${idx}`}
                      className={styles.highlightRect}
                      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                    />
                  ))}
                </div>
              )}

              {/* Amber pin marker (excerpt fallback) */}
              {pinY !== null && (
                <div title={excerpt} className={styles.pinMarker} style={{ top: pinY }} />
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

        {/* Suggestion sidebar */}
        {sidebarOpen && (
          <div className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
              <span>Evidence {suggestions.length > 0 ? `(${suggestions.length})` : ''}</span>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                {suggestions.length > 0 && (
                  <Button variant="ghost" size="small" onClick={handleReanalyze} disabled={suggestionsLoading} title="Re-analyze">
                    <Icon name="refreshCw" size={14} />
                  </Button>
                )}
                <Button variant="ghost" size="small" onClick={() => setSidebarOpen(false)}>
                  <Icon name="x" size={14} />
                </Button>
              </div>
            </div>
            <div className={styles.sidebarCards}>
              {/* AI suggestions */}
              {suggestionsLoading ? (
                <div className={styles.loadingState}><Spinner size="medium" /></div>
              ) : suggestions.length > 0 && (
                suggestions.map((s) => {
                  const isActive = s.suggestion_id === activeSuggestionId
                  const cardClass = [
                    styles.suggestionCard,
                    isActive && styles.suggestionCardActive,
                    s.status === 'accepted' && styles.suggestionCardAccepted,
                    s.status === 'rejected' && styles.suggestionCardRejected,
                  ].filter(Boolean).join(' ')

                  return (
                    <div key={s.suggestion_id} className={cardClass} onClick={() => handleClickSuggestion(s)}>
                      <div className={styles.suggestionMeta}>
                        <span className={styles.typeLabel}>{s.type === 'structured_box' || s.type === 'table' ? 'Data' : s.type === 'figure' || s.type === 'chart' || s.type === 'diagram' ? 'Visual' : 'Text'}</span>
                        <span className={styles.pageLabel}>p.{s.page_number}</span>
                      </div>
                      <div className={styles.suggestionSnippet}>
                        {s.text ? s.text.slice(0, 120) + (s.text.length > 120 ? '...' : '') : '(figure/image region)'}
                      </div>
                      {s.rationale && (
                        <div className={styles.suggestionRationale}>{s.rationale}</div>
                      )}
                      {s.location_annotation && (
                        <div className={styles.locationAnnotation}>
                          <Icon name="fileText" size={11} />
                          <span className={styles.locationAnnotationText}>{s.location_annotation}</span>
                        </div>
                      )}
                      {s.status === 'suggested' && (
                        <div className={styles.suggestionActions}>
                          <Button variant="secondary" size="small" onClick={(e) => { e.stopPropagation(); handleAcceptSuggestion(s) }}>
                            <Icon name="check" size={12} /> Accept
                          </Button>
                          <Button variant="ghost" size="small" onClick={(e) => { e.stopPropagation(); handleRejectSuggestion(s) }}>
                            <Icon name="x" size={12} /> Reject
                          </Button>
                        </div>
                      )}
                      {s.status === 'accepted' && (
                        <span style={{ fontSize: '11px', color: 'var(--green-7)', fontWeight: 500 }}>Accepted</span>
                      )}
                      {s.status === 'rejected' && (
                        <Button variant="ghost" size="small" onClick={(e) => { e.stopPropagation(); handleUndoReject(s) }}>
                          <Icon name="refreshCw" size={12} /> Undo
                        </Button>
                      )}
                    </div>
                  )
                })
              )}

              {/* Saved evidence */}
              {acceptedEvidence.length > 0 && (
                <>
                  <div className={styles.acceptedHeader}>
                    Saved Evidence ({acceptedEvidence.length})
                  </div>
                  {acceptedEvidence.map((ev) => (
                    <div
                      key={ev.evidence_id}
                      className={styles.acceptedCard}
                      onClick={() => {
                        if (ev.page_number !== currentPage) setCurrentPage(ev.page_number)
                      }}
                    >
                      <div className={styles.suggestionMeta}>
                        <span className={`${styles.strengthBadge} ${ev.origin === 'manual_user_box' ? styles.strengthManual : styles.strengthDirect}`}>
                          {ev.origin === 'manual_user_box' ? 'Manual' : 'Accepted'}
                        </span>
                        <span className={styles.pageLabel}>p.{ev.page_number}</span>
                      </div>
                      <div className={styles.suggestionSnippet}>
                        {ev.text ? ev.text.slice(0, 80) + (ev.text.length > 80 ? '...' : '') : '(drawn region)'}
                      </div>
                      {ev.location_annotation && (
                        <div className={styles.locationAnnotation}>
                          <Icon name="fileText" size={11} />
                          <span className={styles.locationAnnotationText}>{ev.location_annotation}</span>
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={(e) => { e.stopPropagation(); handleDeleteEvidence(ev.evidence_id) }}
                        style={{ marginTop: '4px' }}
                      >
                        <Icon name="trash" size={12} /> Remove
                      </Button>
                    </div>
                  ))}
                </>
              )}

              {suggestions.length === 0 && acceptedEvidence.length === 0 && !suggestionsLoading && (
                <p style={{ fontSize: '13px', color: 'var(--gray-6)', padding: '16px', textAlign: 'center' }}>
                  No evidence yet. Click &ldquo;Suggest Evidence&rdquo; or draw a manual box.
                </p>
              )}
            </div>

            {claimId && (
              <div className={styles.sidebarFooter}>
                <Button
                  variant={drawMode ? 'primary' : 'secondary'}
                  size="small"
                  onClick={() => setDrawMode(d => !d)}
                  style={{ width: '100%' }}
                >
                  <Icon name="edit" size={14} />
                  {drawMode ? 'Cancel Draw' : 'Draw Manual Box'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
