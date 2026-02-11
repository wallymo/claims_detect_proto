import { useState } from 'react'
import styles from './MKGClaimCard.module.css'
import ProgressBar from '@/components/atoms/ProgressBar/ProgressBar'
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import Badge from '@/components/atoms/Badge/Badge'

export default function MKGClaimCard({
  claim,
  isActive = false,
  onApprove,
  onReject,
  onSelect,
  onViewSource
}) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [showReferencePreview, setShowReferencePreview] = useState(false)
  const [feedback, setFeedback] = useState('')

  const getConfidenceVariant = (confidence) => {
    if (confidence >= 0.8) return 'success'
    if (confidence >= 0.5) return 'warning'
    return 'error'
  }

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.8) return '#388E3C'
    if (confidence >= 0.5) return '#F57C00'
    return '#D32F2F'
  }

  const handleApprove = (e) => {
    e.stopPropagation()
    onApprove?.(claim.id)
  }

  const handleReject = (e) => {
    e.stopPropagation()
    setShowFeedback(true)
  }

  const handleSubmitFeedback = (e) => {
    e.stopPropagation()
    onReject?.(claim.id, feedback)
    setShowFeedback(false)
    setFeedback('')
  }

  const handleCancelFeedback = (e) => {
    e.stopPropagation()
    setShowFeedback(false)
    setFeedback('')
  }

  const handleCardClick = () => {
    onSelect?.()
  }

  const toggleReferencePreview = (e) => {
    e.stopPropagation()
    setShowReferencePreview(!showReferencePreview)
  }

  const cardClassName = [
    styles.claimCard,
    styles[claim.status],
    isActive ? styles.active : '',
    claim.matched ? styles.matched : styles.unmatched
  ].filter(Boolean).join(' ')

  return (
    <div className={cardClassName} onClick={handleCardClick}>
      {/* Header with confidence */}
      <div className={styles.header}>
        <div className={styles.confidenceSection}>
          <div className={styles.progressWrapper}>
            <ProgressBar
              value={claim.confidence * 100}
              max={100}
              size="small"
              variant={getConfidenceVariant(claim.confidence)}
            />
          </div>
          <span
            className={styles.confidenceValue}
            style={{ color: getConfidenceColor(claim.confidence) }}
          >
            {Math.round(claim.confidence * 100)}%
          </span>
        </div>

        <div className={styles.badges}>
          {claim.page && (
            <span className={styles.pageBadge}>
              <Icon name="fileText" size={12} />
              Pg {claim.page}
            </span>
          )}
          {claim.status !== 'pending' && (
            <Badge variant={claim.status === 'approved' ? 'success' : 'error'} size="small">
              {claim.status}
            </Badge>
          )}
        </div>
      </div>

      {/* Claim text */}
      <div className={styles.claimText}>
        "{claim.text}"
      </div>

      {/* Reference section */}
      {claim.matched && claim.reference && (
        <div className={styles.referenceSection}>
          <div className={styles.referenceHeader}>
            <Icon name="link" size={14} />
            <span className={styles.referenceLabel}>Reference:</span>
            <span className={styles.referenceName}>{claim.reference.name}</span>
            <button
              className={styles.infoButton}
              onClick={toggleReferencePreview}
              title="View supporting text"
            >
              <Icon name="info" size={14} />
            </button>
          </div>
          <div className={styles.referenceLocation}>
            {claim.reference.page && (
              <>
                <Icon name="mapPin" size={12} />
                <span>Page {claim.reference.page}</span>
              </>
            )}
            {onViewSource && (
              <button
                className={styles.viewSourceBtn}
                onClick={(e) => { e.stopPropagation(); onViewSource?.() }}
                title="View source document"
              >
                <Icon name="fileSearch" size={12} />
                View Source
              </button>
            )}
          </div>

          {/* Reference preview popup */}
          {showReferencePreview && claim.reference.excerpt && (
            <div className={styles.referencePreview}>
              <div className={styles.previewHeader}>
                <span>Supporting Text</span>
                <button onClick={toggleReferencePreview}>
                  <Icon name="x" size={14} />
                </button>
              </div>
              <div className={styles.previewContent}>
                "{claim.reference.excerpt}"
              </div>
            </div>
          )}
        </div>
      )}

      {/* Unmatched warning */}
      {!claim.matched && (
        <div className={styles.unmatchedWarning}>
          <Icon name="alertCircle" size={14} />
          <span>No reference found in knowledge base</span>
        </div>
      )}

      {/* Actions */}
      {claim.status === 'pending' && !showFeedback && (
        <div className={styles.actions}>
          <Button
            variant="ghost"
            size="small"
            onClick={handleApprove}
          >
            <Icon name="thumbsUp" size={16} />
            Approve
          </Button>
          <Button
            variant="ghost"
            size="small"
            onClick={handleReject}
          >
            <Icon name="thumbsDown" size={16} />
            Reject
          </Button>
        </div>
      )}

      {/* Feedback form */}
      {showFeedback && (
        <div className={styles.feedbackForm} onClick={e => e.stopPropagation()}>
          <label className={styles.feedbackLabel}>
            Why isn't this a claim? (optional)
          </label>
          <textarea
            className={styles.feedbackInput}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Enter reason for rejection..."
            rows={2}
          />
          <div className={styles.feedbackActions}>
            <Button
              variant="secondary"
              size="small"
              onClick={handleCancelFeedback}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="small"
              onClick={handleSubmitFeedback}
            >
              Submit
            </Button>
          </div>
        </div>
      )}

      {/* Rejection reason */}
      {claim.status === 'rejected' && claim.feedback && (
        <div className={styles.rejectionReason}>
          <Icon name="info" size={14} />
          <span>{claim.feedback}</span>
        </div>
      )}
    </div>
  )
}
