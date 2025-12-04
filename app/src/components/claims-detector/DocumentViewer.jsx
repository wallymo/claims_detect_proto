import { useRef, useEffect } from 'react'
import styles from './DocumentViewer.module.css'
import Icon from '@/components/atoms/Icon/Icon'
import Spinner from '@/components/atoms/Spinner/Spinner'
import Button from '@/components/atoms/Button/Button'

const SAMPLE_DOCUMENT_TEXT = `Introduction

This document presents clinical findings for our new pharmaceutical treatment designed to address chronic inflammatory conditions. The data presented herein represents findings from multiple Phase III clinical trials conducted across 45 research centers.

Clinical Efficacy

Our primary endpoint analysis demonstrates significant therapeutic benefit. Reduces symptoms by 50% in clinical trials conducted over 12 weeks with 500 participants. This represents a meaningful improvement over existing standard-of-care treatments.

The treatment has achieved regulatory milestone status. FDA approved for ages 18 and older with no major contraindications. This approval followed an expedited review process based on breakthrough therapy designation.

Comparative Analysis

In head-to-head studies against market leaders, the results were compelling. Outperforms leading competitor by 35% in efficacy measures. These findings were consistent across all demographic subgroups analyzed.

Patient satisfaction scores also showed marked improvement, with 87% of participants reporting positive outcomes compared to 62% in the control group.

Safety Profile

The treatment demonstrates a favorable safety profile overall. May cause mild side effects in less than 5% of patients. The most common adverse events were headache (3.2%), nausea (1.8%), and fatigue (1.4%), all of which resolved without intervention.

No serious adverse events were attributed to the treatment in any of the clinical trials. Long-term follow-up studies are ongoing to monitor extended safety outcomes.

Quality of Life Outcomes

Beyond clinical measures, patient-reported outcomes were encouraging. Clinically proven to improve quality of life scores. The SF-36 health survey showed statistically significant improvements in both physical and mental health composite scores.

Patients reported improved ability to perform daily activities, better sleep quality, and reduced pain interference with work and social activities.

Conclusions

This treatment represents a significant advancement in the management of chronic inflammatory conditions, offering both superior efficacy and an excellent safety profile.`

export default function DocumentViewer({
  file,
  claims = [],
  activeClaim,
  onClaimClick,
  isLoading = false
}) {
  const contentRef = useRef(null)

  useEffect(() => {
    if (activeClaim && contentRef.current) {
      const highlightEl = contentRef.current.querySelector(`[data-claim-id="${activeClaim}"]`)
      if (highlightEl) {
        highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [activeClaim])

  const getConfidenceClass = (confidence) => {
    if (confidence >= 0.8) return styles.highlightHigh
    if (confidence >= 0.5) return styles.highlightMedium
    return styles.highlightLow
  }

  const renderHighlightedText = () => {
    if (claims.length === 0) return SAMPLE_DOCUMENT_TEXT

    let text = SAMPLE_DOCUMENT_TEXT
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
        const confidenceClass = getConfidenceClass(claim.confidence)
        const activeClass = isActive ? styles.activeHighlight : ''

        text = `${before}<mark class="${styles.highlight} ${confidenceClass} ${activeClass}" data-claim-id="${claim.id}">${claim.text}</mark>${after}`
      }
    })

    return text
  }

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

  if (isLoading) {
    return (
      <div className={styles.documentViewer}>
        <div className={styles.loadingState}>
          <Spinner size="large" />
          <p>Processing document...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.documentViewer}>
      <div className={styles.header}>
        <div className={styles.fileInfo}>
          <Icon name="file" size={16} />
          <span className={styles.fileName}>{file.name}</span>
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

      <div className={styles.content} ref={contentRef}>
        <div
          className={styles.documentText}
          dangerouslySetInnerHTML={{ __html: renderHighlightedText() }}
          onClick={(e) => {
            const claimId = e.target.dataset?.claimId
            if (claimId) {
              onClaimClick?.(claimId)
            }
          }}
        />
      </div>

      {claims.length > 0 && (
        <div className={styles.footer}>
          <span className={styles.claimCount}>
            {claims.length} claims highlighted
          </span>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendHigh}`}></span>
              High
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendMedium}`}></span>
              Medium
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendLow}`}></span>
              Low
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
