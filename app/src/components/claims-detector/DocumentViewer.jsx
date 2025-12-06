import { useRef, useEffect, useState } from 'react'
import styles from './DocumentViewer.module.css'
import Icon from '@/components/atoms/Icon/Icon'
import Button from '@/components/atoms/Button/Button'
import ScannerOverlay from './ScannerOverlay'
import { CLAIM_TYPES } from '@/mocks/claims'

export default function DocumentViewer({
  document,
  claims = [],
  activeClaim,
  onClaimClick,
  isScanning = false,
  onScanComplete
}) {
  const contentRef = useRef(null)
  const [hoveredClaim, setHoveredClaim] = useState(null)
  const [showLegend, setShowLegend] = useState(false)

  useEffect(() => {
    if (activeClaim && contentRef.current) {
      const highlightEl = contentRef.current.querySelector(`[data-claim-id="${activeClaim}"]`)
      if (highlightEl) {
        highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [activeClaim])

  const getConfidenceClass = (confidence) => {
    if (confidence >= 0.8) return styles.confidenceHigh
    if (confidence >= 0.5) return styles.confidenceMedium
    return styles.confidenceLow
  }

  const renderHighlightedText = () => {
    if (!document) return ''
    if (claims.length === 0) return document.content

    let text = document.content
    const sortedClaims = [...claims].sort((a, b) => {
      const aIndex = text.indexOf(a.text)
      const bIndex = text.indexOf(b.text)
      return bIndex - aIndex
    })

    sortedClaims.forEach(claim => {
      const index = text.indexOf(claim.text)
      if (index !== -1) {
        const before = text.substring(0, index)
        const after = text.substring(index + claim.text.length)
        const isActive = activeClaim === claim.id
        const isHovered = hoveredClaim === claim.id
        const typeColor = CLAIM_TYPES[claim.type]?.color || '#666'

        const classes = [
          styles.highlight,
          getConfidenceClass(claim.confidence),
          isActive ? styles.activeHighlight : '',
          isHovered ? styles.hoveredHighlight : ''
        ].filter(Boolean).join(' ')

        text = `${before}<mark class="${classes}" data-claim-id="${claim.id}" data-claim-type="${claim.type}" style="--claim-color: ${typeColor}">${claim.text}</mark>${after}`
      }
    })

    return text
  }

  const handleTextClick = (e) => {
    const claimId = e.target.dataset?.claimId
    if (claimId) {
      onClaimClick?.(claimId)
    }
  }

  const handleTextHover = (e) => {
    const claimId = e.target.dataset?.claimId
    setHoveredClaim(claimId || null)
  }

  if (!document) {
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
      <div className={styles.header}>
        <div className={styles.fileInfo}>
          <Icon name="file" size={16} />
          <span className={styles.fileName}>{document.title}</span>
        </div>
        <div className={styles.toolbar}>
          <Button variant="ghost" size="small">
            <Icon name="zoomOut" size={14} />
          </Button>
          <span className={styles.zoom}>100%</span>
          <Button variant="ghost" size="small">
            <Icon name="zoomIn" size={14} />
          </Button>
        </div>
      </div>

      <div className={styles.contentWrapper}>
        <div
          className={styles.content}
          ref={contentRef}
        >
          <div
            className={styles.documentText}
            dangerouslySetInnerHTML={{ __html: renderHighlightedText() }}
            onClick={handleTextClick}
            onMouseOver={handleTextHover}
            onMouseOut={() => setHoveredClaim(null)}
          />
        </div>

        <ScannerOverlay
          isScanning={isScanning}
          onComplete={onScanComplete}
        />
      </div>

      {claims.length > 0 && (
        <div className={styles.footer}>
          <span className={styles.claimCount}>
            {claims.length} claims highlighted
          </span>
          <div className={styles.legendWrapper}>
            <button
              className={styles.legendToggle}
              onClick={() => setShowLegend(!showLegend)}
              aria-label="Show highlight colors"
            >
              <Icon name="info" size={14} />
              Highlights Legend
            </button>
            {showLegend && (
              <div className={styles.legendTooltip}>
                <div className={styles.legendTitle}>Highlight Colors</div>
                {Object.entries(CLAIM_TYPES).map(([key, config]) => (
                  <div key={key} className={styles.legendItem}>
                    <span
                      className={styles.legendDot}
                      style={{ backgroundColor: config.color }}
                    />
                    {config.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
