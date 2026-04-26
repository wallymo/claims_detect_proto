import { Fragment, useMemo, useState } from 'react'
import styles from './MKGClaimCard.module.css'
import ProgressBar from '@/components/atoms/ProgressBar/ProgressBar'
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import Badge from '@/components/atoms/Badge/Badge'

const normalizeInlineText = (value) => String(value || '').replace(/\s+/g, ' ').trim()

const normalizeReferenceId = (value) => {
  const normalizedValue = String(value ?? '').trim()
  return normalizedValue ? normalizedValue : null
}

const typeLabel = (type) => {
  const normalizedType = String(type || 'text').toLowerCase()

  if (normalizedType === 'structured_box') return 'Data'
  if (normalizedType === 'figure' || normalizedType === 'chart' || normalizedType === 'diagram') return 'Visual'
  if (normalizedType === 'manual_box') return 'Manual'
  return 'Text'
}

const claimTypeLabel = (type) => {
  const normalizedType = String(type || '').toLowerCase()
  if (normalizedType === 'bullet') return 'bullet'
  if (normalizedType === 'image') return 'image'
  if (normalizedType === 'table') return 'table'
  if (normalizedType === 'text') return 'text'
  return null
}

const buildAcceptedEvidenceText = (evidence) => {
  const annotation = normalizeInlineText(evidence.location_annotation)
  if (annotation) return annotation

  const pageLabel = evidence.page_number != null && String(evidence.page_number).trim()
    ? String(evidence.page_number).trim()
    : '?'

  return `Page ${pageLabel}${evidence.type ? ` · ${typeLabel(evidence.type)}` : ''}`
}

const compareAcceptedEvidence = (a, b) => (
  a.sortPage - b.sortPage ||
  a.sortCreatedAt - b.sortCreatedAt ||
  a.sortIndex - b.sortIndex
)

export default function MKGClaimCard({
  claim,
  isActive = false,
  onApprove,
  onReject,
  onRemove,
  onDelete,
  onUndo,
  onRefChange,
  onSelect,
  onViewRef,
  acceptedEvidence = [],
  onDeleteAcceptedEvidence,
  brandReferences = [],
  trainingExamples = [],
  onChildEvidenceClick
}) {
  const [showFeedback, setShowFeedback] = useState(false)
  const [rejectionType, setRejectionType] = useState('false_positive')
  const [refSearch, setRefSearch] = useState('')
  const [selectedRefId, setSelectedRefId] = useState(null)
  const [showRefEditor, setShowRefEditor] = useState(false)
  const [childrenExpanded, setChildrenExpanded] = useState(false)

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

  const handleDelete = (e) => {
    e.stopPropagation()
    onDelete?.(claim.id)
  }

  const handleRefSwap = (refIndex, newRef) => {
    const updatedRefs = [...(claim.references || [])]
    updatedRefs[refIndex] = {
      ...updatedRefs[refIndex],
      id: newRef.id,
      text: newRef.name ?? newRef.display_alias ?? newRef.filename,
      name: newRef.name ?? newRef.display_alias ?? newRef.filename,
      swapped: true
    }
    onRefChange?.(claim.id, updatedRefs)
    setShowRefEditor(false)
  }

  const handleRefAdd = (newRef) => {
    const updatedRefs = [
      ...(claim.references || []),
      {
        number: (claim.references?.length || 0) + 1,
        id: newRef.id,
        text: newRef.name ?? newRef.display_alias ?? newRef.filename,
        name: newRef.name ?? newRef.display_alias ?? newRef.filename,
        added: true
      }
    ]
    onRefChange?.(claim.id, updatedRefs)
    setShowRefEditor(false)
  }

  const isMissed = claim.status === 'missed'

  const cardClassName = [
    styles.claimCard,
    styles[claim.status],
    isActive ? styles.active : '',
    isMissed ? styles.missedClaim : (claim.matched ? styles.matched : styles.unmatched)
  ].filter(Boolean).join(' ')

  const needsRefPicker = rejectionType === 'wrong_reference' || rejectionType === 'missing_reference'
  const filteredRefs = brandReferences
    .filter(r => !refSearch || r.name?.toLowerCase().includes(refSearch.toLowerCase()))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  const rejectionTypeLabels = {
    false_positive: { label: 'False positive', desc: "This isn't actually a claim" },
    wrong_reference: { label: 'Wrong reference', desc: 'Claim is valid, but wrong reference was matched' },
    correct_reference_wrong_location: { label: 'Correct reference wrong location', desc: 'Reference is correct, but the page/location excerpt is wrong' },
    missing_reference: { label: 'Missing reference', desc: 'This claim needs a reference that was not matched' }
  }
  const displayStatement = String(claim.statement || claim.text || claim.claim || '').trim()
  const displaySuperscripts = Array.isArray(claim.superscripts) ? claim.superscripts : claim.refNumbers
  const references = useMemo(
    () => (Array.isArray(claim.references) ? claim.references : []),
    [claim.references]
  )

  const { acceptedEvidenceByReferenceIndex, orphanAcceptedEvidence } = useMemo(() => {
    if (!Array.isArray(acceptedEvidence) || acceptedEvidence.length === 0) {
      return {
        acceptedEvidenceByReferenceIndex: new Map(),
        orphanAcceptedEvidence: []
      }
    }

    const firstReferenceIndexById = new Map()
    references.forEach((ref, index) => {
      const referenceKey = normalizeReferenceId(ref.id)
      if (referenceKey && !firstReferenceIndexById.has(referenceKey)) {
        firstReferenceIndexById.set(referenceKey, index)
      }
    })

    const acceptedEvidenceRows = acceptedEvidence
      .map((evidence, index) => {
        const referenceKey = normalizeReferenceId(evidence.reference_id)
        const createdAtTime = evidence.created_at ? Date.parse(evidence.created_at) : Number.NaN

        return {
          ...evidence,
          displayText: buildAcceptedEvidenceText(evidence),
          referenceIndex: referenceKey && firstReferenceIndexById.has(referenceKey)
            ? firstReferenceIndexById.get(referenceKey)
            : null,
          sortIndex: index,
          sortPage: Number.isFinite(Number(evidence.page_number)) ? Number(evidence.page_number) : Number.POSITIVE_INFINITY,
          sortCreatedAt: Number.isNaN(createdAtTime) ? Number.POSITIVE_INFINITY : createdAtTime
        }
      })
      .sort(compareAcceptedEvidence)

    const groupedEvidence = new Map()
    const orphanRows = []

    acceptedEvidenceRows.forEach((evidence) => {
      if (evidence.referenceIndex == null) {
        orphanRows.push(evidence)
        return
      }

      const groupedRows = groupedEvidence.get(evidence.referenceIndex) || []
      groupedRows.push(evidence)
      groupedEvidence.set(evidence.referenceIndex, groupedRows)
    })

    return {
      acceptedEvidenceByReferenceIndex: groupedEvidence,
      orphanAcceptedEvidence: orphanRows
    }
  }, [acceptedEvidence, references])

  const renderAcceptedEvidenceChild = (evidence) => (
    <div
      key={evidence.evidence_id}
      className={`${styles.refCallout} ${styles.refCalloutChild}`}
      title={evidence.displayText}
    >
      <span className={styles.refChildArrow}>{'\u21B3'}</span>
      <span className={styles.refText}>{evidence.displayText}</span>
      {onDeleteAcceptedEvidence && (
        <button
          type="button"
          className={styles.refCalloutDelete}
          onClick={(e) => {
            e.stopPropagation()
            onDeleteAcceptedEvidence(evidence.evidence_id)
          }}
          aria-label="Delete accepted evidence"
          title="Delete accepted evidence"
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  )

  const renderReferenceCallouts = () => references.map((ref, i) => {
    const isLinked = !!ref.id
    const refText = String(ref.text || '').trim() || `Reference ${ref.number} not found on page`
    const refClaimType = claimTypeLabel(ref.claim_type)
    const locatorText = ref.locator?.location_annotation
      ? ref.locator.location_annotation.replace(/\//g, ' · ')
      : null
    const childEvidence = acceptedEvidenceByReferenceIndex.get(i) || []
    const handleLocatorClick = isLinked
      ? (e) => { e.stopPropagation(); onViewRef?.(ref, displayStatement) }
      : undefined

    return (
      <Fragment key={ref.id ?? i}>
        <div
          className={`${styles.refCallout} ${isLinked ? styles.refCalloutClickable : ''}`}
          onClick={handleLocatorClick}
          title={isLinked ? (ref.locator ? `View evidence: ${ref.locator.location_annotation || ref.locator.page_number}` : 'View source document') : 'Source document not in library'}
        >
          <span className={styles.refNumber}>{ref.number}.</span>
          {refClaimType && <span className={styles.refClaimType}>[{refClaimType}]</span>}
          <span className={styles.refText}>{refText}</span>
          {isLinked && <Icon name="fileSearch" size={12} className={styles.refViewIcon} />}
        </div>
        {locatorText && (
          <div
            className={`${styles.refCallout} ${styles.refCalloutChild} ${styles.refCalloutEvidenceLink} ${isLinked ? styles.refCalloutClickable : ''}`}
            onClick={handleLocatorClick}
            title={ref.locator?.snippet || ref.locator?.location_annotation || 'View evidence location'}
          >
            <span className={styles.refChildArrow}>{'\u21B3'}</span>
            <Icon name="fileSearch" size={11} />
            <span className={styles.refText}>{locatorText}</span>
          </div>
        )}
        {childEvidence.map(renderAcceptedEvidenceChild)}
      </Fragment>
    )
  })

  const hasOrphanAcceptedEvidence = orphanAcceptedEvidence.length > 0
  const hasReferenceCallouts = references.length > 0 || hasOrphanAcceptedEvidence

  return (
    <div className={cardClassName} onClick={handleCardClick}>
      {/* Header with confidence */}
      <div className={styles.header}>
        {!isMissed && (
          <div className={styles.cardActions}>
            <button
              className={styles.undoBtn}
              onClick={(e) => { e.stopPropagation(); onUndo?.(claim.id) }}
              title={claim.status !== 'pending' ? 'Undo — reset to pending' : 'Undo changes'}
            >
              <Icon name="refreshCw" size={12} />
            </button>
            <button
              className={styles.deleteBtn}
              onClick={handleDelete}
              title="Remove annotation"
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        )}
        {isMissed ? (
          <div className={styles.missedLabel}>
            <Icon name="alertCircle" size={14} />
            <span>Manually Reported</span>
          </div>
        ) : claim.source === 'ai-find' ? (
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
        ) : null}

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
          {(claim.source === 'ai-find' || claim.matchTier === 'ai-find') && (
            <span className={styles.sourceBadgeAiFind}>AI Found</span>
          )}
          {claim.globalSpot && (
            <span className={styles.sourceBadgeGlobal}>Global</span>
          )}
          {claim.source === 'global-reference' && (
            <span className={styles.sourceBadgeGlobalReference}>Global reference</span>
          )}
          {claim.childClaims?.length > 0 && (
            <button
              className={styles.childClaimsToggle}
              onClick={(e) => { e.stopPropagation(); setChildrenExpanded(!childrenExpanded) }}
              title={childrenExpanded ? 'Hide linked claims' : 'Show linked claims'}
            >
              <Icon name={childrenExpanded ? 'chevronDown' : 'chevronRight'} size={12} />
              {claim.childClaims.length} claim{claim.childClaims.length !== 1 ? 's' : ''} linked
            </button>
          )}
          {learnedPatternMatch.hasCrossBrandMatch ? (
            <span
              className={`${styles.trainingIcon} ${styles.crossBrand}`}
              title="Cross-brand training match"
            >
              <Icon name="fileCheck" size={14} />
            </span>
          ) : learnedPatternMatch.hasSameBrandMatch ? (
            <span className={styles.trainingIcon} title="Training-verified claim">
              <Icon name="fileCheck" size={14} />
            </span>
          ) : null}
          {isMissed ? (
            <span className={styles.missedBadge}>Missed</span>
          ) : (claim.status === 'approved' || claim.status === 'rejected') ? (
            <Badge variant={claim.status === 'approved' ? 'success' : 'error'} size="small">
              {claim.status}
            </Badge>
          ) : null}
        </div>
      </div>

      {/* Claim text */}
      <div className={styles.claimText}>
        "{displayStatement}"
      </div>

      {Array.isArray(displaySuperscripts) && displaySuperscripts.length > 0 && (
        <div className={styles.referenceSection}>
          <div className={styles.referenceHeader}>
            <Icon name="fileText" size={14} />
            <span className={styles.referenceLabel}>Superscripts:</span>
            <span className={styles.referenceName}>{displaySuperscripts.join(', ')}</span>
            {!showRefEditor && (
              <button
                className={styles.editRefBtn}
                onClick={(e) => { e.stopPropagation(); setShowRefEditor(true) }}
                title="Edit references"
              >
                <Icon name="edit" size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Reference callouts */}
      {hasReferenceCallouts && (
        <div className={styles.refCallouts}>
          {renderReferenceCallouts()}
          {hasOrphanAcceptedEvidence && (
            <>
              <div className={`${styles.refCallout} ${styles.refCalloutGroupLabel}`}>
                <span className={styles.refText}>(Other evidence)</span>
              </div>
              {orphanAcceptedEvidence.map(renderAcceptedEvidenceChild)}
            </>
          )}
        </div>
      )}

      {/* Child claims from global annotation deep linking */}
      {claim.childClaims?.length > 0 && childrenExpanded && (
        <div className={styles.childClaimsSection}>
          {claim.childClaims.map((cc) => (
            <div key={cc.id} className={styles.childClaimRow}>
              <div className={styles.childClaimText}>{cc.text}</div>
              {cc.evidence ? (
                <button
                  className={styles.evidenceBadge}
                  onClick={(e) => { e.stopPropagation(); onChildEvidenceClick?.(cc) }}
                  title={`Page ${cc.evidence.page_number} — ${cc.evidence.type}`}
                >
                  <Icon name="fileText" size={10} />
                  Pg {cc.evidence.page_number}
                  <span className={styles.evidenceType}>{cc.evidence.type}</span>
                </button>
              ) : (
                <span className={styles.noEvidence}>No evidence found</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Inline reference editor */}
      {showRefEditor && (
        <div className={styles.refEditor} onClick={(e) => e.stopPropagation()}>
          <div className={styles.refEditorHeader}>
            <span className={styles.refEditorTitle}>Edit References</span>
            <button className={styles.refEditorClose} onClick={() => setShowRefEditor(false)}>
              <Icon name="x" size={14} />
            </button>
          </div>
          {brandReferences.length > 0 ? (
            <div className={styles.refEditorList}>
              {brandReferences.map(ref => {
                const isAlreadyLinked = claim.references?.some(r => r.id === ref.id)
                return (
                  <div
                    key={ref.id}
                    className={`${styles.refEditorItem} ${isAlreadyLinked ? styles.refEditorItemLinked : ''}`}
                  >
                    <span className={styles.refEditorItemName}>
                      {ref.name ?? ref.display_alias ?? ref.filename}
                    </span>
                    <div className={styles.refEditorItemActions}>
                      {!isAlreadyLinked && (
                        <>
                          {claim.references?.length > 0 && (
                            <button
                              className={styles.refEditorSwapBtn}
                              onClick={() => handleRefSwap(0, ref)}
                              title="Replace first reference"
                            >
                              Swap
                            </button>
                          )}
                          <button
                            className={styles.refEditorAddBtn}
                            onClick={() => handleRefAdd(ref)}
                            title="Add this reference"
                          >
                            Add
                          </button>
                        </>
                      )}
                      {isAlreadyLinked && (
                        <span className={styles.refEditorLinkedBadge}>Linked</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className={styles.refEditorEmpty}>No brand references available. Upload references in the Library tab.</p>
          )}
        </div>
      )}

      {/* Legacy single reference fallback (MKG/MKG2) */}
      {!Array.isArray(claim.references) && claim.matched && claim.reference && (
        <div className={styles.referenceSection}>
          <div className={styles.referenceHeader}>
            <Icon name="link" size={14} />
            <span className={styles.referenceLabel}>Reference:</span>
            <span className={styles.referenceName}>{claim.reference.name}</span>
          </div>
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
          <button className={styles.approveBtn} onClick={handleApprove}>
            <Icon name="thumbsUp" size={14} />
            Approve
          </button>
          <button className={styles.rejectBtn} onClick={handleReject}>
            <Icon name="thumbsDown" size={14} />
            Reject
          </button>
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
