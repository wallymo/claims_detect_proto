import { useMemo, useState } from 'react'
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
  onRemove,
  onSelect,
  onViewSource,
  brandReferences = [],
  trainingExamples = []
}) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [showReferencePreview, setShowReferencePreview] = useState(false)
  const [rejectionType, setRejectionType] = useState('false_positive')
  const [refSearch, setRefSearch] = useState('')
  const [selectedRefId, setSelectedRefId] = useState(null)

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

  const learnedPatternMatch = useMemo(() => {
    const normalize = (text) => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase()
    const normalizedClaimText = normalize(claim?.text)

    if (!normalizedClaimText || trainingExamples.length === 0) {
      return { hasSameBrandMatch: false, hasCrossBrandMatch: false }
    }

    let hasSameBrandMatch = false
    let hasCrossBrandMatch = false

    for (const example of trainingExamples) {
      const normalizedExampleText = normalize(example?.text)
      if (!normalizedExampleText) continue

      const isMatch = (
        normalizedClaimText === normalizedExampleText ||
        normalizedClaimText.includes(normalizedExampleText) ||
        normalizedExampleText.includes(normalizedClaimText)
      )

      if (!isMatch) continue

      if (example?.source_brand_id) {
        hasCrossBrandMatch = true
        break
      }

      hasSameBrandMatch = true
    }

    return { hasSameBrandMatch, hasCrossBrandMatch }
  }, [claim?.text, trainingExamples])

  const handleApprove = (e) => {
    e.stopPropagation()
    onApprove?.(claim.id)
  }

  const handleReject = (e) => {
    e.stopPropagation()
    setShowFeedback(true)
    setRejectionType('false_positive')
    setRefSearch('')
    setSelectedRefId(null)
  }

  const handleSubmitFeedback = (e) => {
    e.stopPropagation()
    const needsRef = rejectionType === 'wrong_reference' || rejectionType === 'missing_reference'
    onReject?.(claim.id, {
      rejectionType,
      correctedReferenceId: needsRef ? selectedRefId : null
    })
    setShowFeedback(false)
    setRejectionType('false_positive')
    setRefSearch('')
    setSelectedRefId(null)
  }

  const handleCancelFeedback = (e) => {
    e.stopPropagation()
    setShowFeedback(false)
    setRejectionType('false_positive')
    setRefSearch('')
    setSelectedRefId(null)
  }

  const handleCardClick = () => {
    onSelect?.()
  }

  const toggleReferencePreview = (e) => {
    e.stopPropagation()
    setShowReferencePreview(!showReferencePreview)
  }

  const isMissed = claim.status === 'missed'

  const cardClassName = [
    styles.claimCard,
    styles[claim.status],
    isActive ? styles.active : '',
    isMissed ? styles.missedClaim : (claim.matched ? styles.matched : styles.unmatched)
  ].filter(Boolean).join(' ')

  const needsRefPicker = rejectionType === 'wrong_reference' || rejectionType === 'missing_reference'
  const filteredRefs = brandReferences.filter(r =>
    !refSearch || r.name?.toLowerCase().includes(refSearch.toLowerCase())
  )

  const rejectionTypeLabels = {
    false_positive: { label: 'False positive', desc: "This isn't actually a claim" },
    wrong_reference: { label: 'Wrong reference', desc: 'Claim is valid, but wrong reference was matched' },
    correct_reference_wrong_location: { label: 'Correct reference wrong location', desc: 'Reference is correct, but the page/location excerpt is wrong' },
    missing_reference: { label: 'Missing reference', desc: 'This claim needs a reference that was not matched' }
  }

  return (
    <div className={cardClassName} onClick={handleCardClick}>
      {/* Header with confidence */}
      <div className={styles.header}>
        {isMissed ? (
          <div className={styles.missedLabel}>
            <Icon name="alertCircle" size={14} />
            <span>Manually Reported</span>
          </div>
        ) : (
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
        )}

        <div className={styles.badges}>
          {claim.page && (
            <span className={styles.pageBadge}>
              <Icon name="fileText" size={12} />
              {isMissed
                ? `${claim.missedIndex ? `M${claim.missedIndex} · ` : ''}Pg ${claim.page}`
                : `${(claim.globalIndex ?? parseInt(claim.id?.replace(/\D/g, ''), 10)) ? `#${claim.globalIndex ?? parseInt(claim.id?.replace(/\D/g, ''), 10)} · ` : ''}Pg ${claim.page}`
              }
            </span>
          )}
          {learnedPatternMatch.hasCrossBrandMatch ? (
            <span className={`${styles.learnedBadge} ${styles.crossBrand}`}>
              Cross-brand learned
            </span>
          ) : learnedPatternMatch.hasSameBrandMatch ? (
            <span className={styles.learnedBadge}>
              Learned pattern
            </span>
          ) : null}
          {isMissed ? (
            <span className={styles.missedBadge}>Missed</span>
          ) : claim.status !== 'pending' ? (
            <Badge variant={claim.status === 'approved' ? 'success' : 'error'} size="small">
              {claim.status}
            </Badge>
          ) : null}
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
      {isMissed ? (
        <div className={styles.actions}>
          <Button
            variant="ghost"
            size="small"
            onClick={(e) => { e.stopPropagation(); onRemove?.(claim.id) }}
          >
            <Icon name="trash" size={14} />
            Remove
          </Button>
        </div>
      ) : claim.status === 'pending' && !showFeedback ? (
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
      ) : null}

      {/* Rejection form */}
      {showFeedback && (
        <div className={styles.feedbackForm} onClick={e => e.stopPropagation()}>
          <div className={styles.feedbackLabel}>Why are you rejecting this?</div>

          <div className={styles.rejectionOptions}>
            {Object.entries(rejectionTypeLabels).map(([key, { label, desc }]) => (
              <label key={key} className={styles.rejectionOption}>
                <input
                  type="radio"
                  name={`rejection-${claim.id}`}
                  value={key}
                  checked={rejectionType === key}
                  onChange={() => { setRejectionType(key); setSelectedRefId(null) }}
                />
                <div className={styles.rejectionOptionText}>
                  <span className={styles.rejectionOptionLabel}>{label}</span>
                  <span className={styles.rejectionOptionDesc}>{desc}</span>
                </div>
              </label>
            ))}
          </div>

          {/* Reference picker for wrong/missing reference */}
          {needsRefPicker && (
            <div className={styles.refPickerSection}>
              <div className={styles.refPickerLabel}>
                {rejectionType === 'wrong_reference' ? 'Select the correct reference:' : 'Select the missing reference:'}
              </div>
              <div className={styles.refPickerSearchWrapper}>
                <Icon name="search" size={13} className={styles.refPickerSearchIcon} />
                <input
                  className={styles.refPickerSearch}
                  type="text"
                  placeholder="Search references..."
                  value={refSearch}
                  onChange={e => setRefSearch(e.target.value)}
                  onClick={e => e.stopPropagation()}
                />
                {refSearch && (
                  <button
                    className={styles.refPickerClear}
                    onClick={e => { e.stopPropagation(); setRefSearch('') }}
                    type="button"
                    aria-label="Clear search"
                  >
                    <Icon name="x" size={12} />
                  </button>
                )}
              </div>
              <div className={styles.refPickerList}>
                {filteredRefs.length === 0 && (
                  <div className={styles.refPickerEmpty}>
                    <Icon name="fileSearch" size={16} />
                    <span>No references found</span>
                  </div>
                )}
                {filteredRefs.map(ref => (
                  <button
                    key={ref.id}
                    className={`${styles.refPickerItem} ${selectedRefId === ref.id ? styles.refPickerItemSelected : ''}`}
                    onClick={e => { e.stopPropagation(); setSelectedRefId(ref.id) }}
                    type="button"
                  >
                    <Icon name="fileText" size={12} />
                    <span>{ref.name}</span>
                    {selectedRefId === ref.id && <Icon name="check" size={12} />}
                  </button>
                ))}
              </div>
            </div>
          )}

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
              disabled={needsRefPicker && !selectedRefId}
            >
              Submit
            </Button>
          </div>
        </div>
      )}

      {/* Rejection reason */}
      {claim.status === 'rejected' && claim.rejectionType && (
        <div className={styles.rejectionReason}>
          <Icon name="info" size={14} />
          <span>
            {rejectionTypeLabels[claim.rejectionType]?.label || 'Rejected'}
            {claim.correctedReferenceName ? ` → ${claim.correctedReferenceName}` : ''}
          </span>
        </div>
      )}
    </div>
  )
}
