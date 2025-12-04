import { useState } from 'react'
import styles from './ClaimCard.module.css'
import ProgressBar from '@/components/atoms/ProgressBar/ProgressBar'
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import Badge from '@/components/atoms/Badge/Badge'

const TYPE_LABELS = {
  efficacy: 'Efficacy',
  regulatory: 'Regulatory',
  comparative: 'Comparative',
  safety: 'Safety'
}

const TYPE_VARIANTS = {
  efficacy: 'info',
  regulatory: 'warning',
  comparative: 'neutral',
  safety: 'error'
}

export default function ClaimCard({
  claim,
  isActive = false,
  onApprove,
  onReject,
  onSelect,
  onFeedbackSubmit
}) {
  const [showFeedback, setShowFeedback] = useState(false)
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
    onFeedbackSubmit?.(claim.id, feedback)
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

  const cardClassName = [
    styles.claimCard,
    styles[claim.status],
    isActive ? styles.active : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={cardClassName} onClick={handleCardClick}>
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
          {claim.type && (
            <Badge variant={TYPE_VARIANTS[claim.type] || 'neutral'} size="small">
              {TYPE_LABELS[claim.type] || claim.type}
            </Badge>
          )}
          {claim.status !== 'pending' && (
            <Badge variant={claim.status === 'approved' ? 'success' : 'error'} size="small">
              {claim.status}
            </Badge>
          )}
        </div>
      </div>

      <div className={styles.claimText}>
        "{claim.text}"
      </div>

      {claim.location && (
        <div className={styles.location}>
          <Icon name="mapPin" size={14} />
          <span>Paragraph {claim.location.paragraph}</span>
        </div>
      )}

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

      {claim.status === 'rejected' && claim.feedback && (
        <div className={styles.rejectionReason}>
          <Icon name="info" size={14} />
          <span>{claim.feedback}</span>
        </div>
      )}
    </div>
  )
}
