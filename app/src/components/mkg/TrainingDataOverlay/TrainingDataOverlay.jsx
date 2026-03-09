import { useState } from 'react'
import styles from './TrainingDataOverlay.module.css'
import Icon from '@/components/atoms/Icon/Icon'
import Button from '@/components/atoms/Button/Button'

export default function TrainingDataOverlay({
  isOpen,
  onClose,
  sessions = [],
  onDeleteSession,
  onDeleteClaim,
  onClearAll,
  onExport,
  hasActiveBrand,
  ecosystemBrandCount = 0,
  ecosystemExampleCount = 0,
  promptInjectionText = ''
}) {
  const [showPromptPreview, setShowPromptPreview] = useState(false)
  const [expandedSessionId, setExpandedSessionId] = useState(null)

  if (!isOpen) return null

  const countByType = (claims) => {
    let approved = 0, rejected = 0, missed = 0
    for (const c of (claims || [])) {
      const type = c.type || 'Claim'
      if (type === 'FalsePositive') rejected++
      else if (type === 'MissedClaim') missed++
      else approved++
    }
    return { approved, rejected, missed }
  }

  const totals = sessions.reduce(
    (acc, s) => {
      const counts = countByType(s.approved_claims)
      acc.approved += counts.approved
      acc.rejected += counts.rejected
      acc.missed += counts.missed
      return acc
    },
    { approved: 0, rejected: 0, missed: 0 }
  )

  const normalizeClaimType = (type) => {
    if (type === 'MissedClaim' || type === 'FalsePositive') return type
    return 'Claim'
  }

  const toggleSessionExpanded = (sessionId) => {
    setExpandedSessionId(prev => (prev === sessionId ? null : sessionId))
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.overlay}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Icon name="flask" size={18} />
            <span className={styles.title}>Training Data</span>
            <span className={styles.versionBadge}>model 0.1</span>
            {sessions.length > 0 && (
              <span className={styles.badge}>{sessions.length} document{sessions.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className={styles.body}>
          {!hasActiveBrand && (
            <div className={styles.emptyState}>
              <Icon name="flask" size={32} />
              <p>Select a brand to view training data.</p>
            </div>
          )}

          {hasActiveBrand && sessions.length === 0 && (
            <div className={styles.emptyState}>
              <Icon name="flask" size={32} />
              <p>No training data yet.</p>
              <p className={styles.emptyHint}>
                Review claims in a document and approve/reject to build persistent, document-level training for this brand.
              </p>
              {ecosystemExampleCount > 0 && (
                <p className={styles.emptyHint}>
                  {ecosystemExampleCount} ecosystem example{ecosystemExampleCount !== 1 ? 's are' : ' is'} still available for brand-agnostic guidance.
                </p>
              )}
            </div>
          )}

          {hasActiveBrand && sessions.length > 0 && (
            <>
              <div className={styles.summary}>
                <span>
                  <span className={styles.countApproved}>{totals.approved} approved</span>
                  {' · '}
                  <span className={styles.countRejected}>{totals.rejected} rejected</span>
                  {' · '}
                  <span className={styles.countMissed}>{totals.missed} missed</span>
                  {' across '}
                  {sessions.length} document{sessions.length !== 1 ? 's' : ''}
                </span>
              </div>
              {ecosystemExampleCount > 0 && (
                <div className={styles.ecosystemSummary} title="Contributing to cross-brand learning">
                  <Icon name="gitCompare" size={12} />
                  <span>
                    <strong>{ecosystemBrandCount} contributing brand{ecosystemBrandCount !== 1 ? 's' : ''}</strong>
                    {' · '}
                    {ecosystemExampleCount} ecosystem example{ecosystemExampleCount !== 1 ? 's' : ''}
                  </span>
                </div>
              )}
              {promptInjectionText && (
                <>
                  <button
                    type="button"
                    className={styles.promptPreviewToggle}
                    onClick={() => setShowPromptPreview(prev => !prev)}
                  >
                    <Icon name={showPromptPreview ? 'chevronUp' : 'chevronDown'} size={12} />
                    <span>What the AI sees</span>
                  </button>
                  {showPromptPreview && (
                    <pre className={styles.promptPreviewContent}>{promptInjectionText}</pre>
                  )}
                </>
              )}

              <div className={styles.sessionList}>
                {sessions.map(session => {
                  const sessionCardId = session.id || session.document_key
                  const isExpanded = expandedSessionId === sessionCardId
                  const claims = Array.isArray(session.approved_claims) ? session.approved_claims : []
                  const sessionCounts = countByType(claims)
                  return (
                    <div key={sessionCardId} className={styles.sessionCard}>
                      <div
                        className={styles.sessionCardHeader}
                        onClick={() => toggleSessionExpanded(sessionCardId)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            toggleSessionExpanded(sessionCardId)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className={styles.sessionInfo}>
                          <div className={styles.sessionName} title={session.document_name}>
                            <Icon name="fileText" size={13} />
                            <span className={styles.sessionLabel}>{session.label || session.document_name}</span>
                            {session.label?.startsWith('Seeded:') && (
                              <span className={styles.seededBadge}>Seeded</span>
                            )}
                          </div>
                          <div className={styles.sessionMeta}>
                            <span>{sessionCounts.approved} approved</span>
                            {sessionCounts.rejected > 0 && <><span>·</span><span>{sessionCounts.rejected} rejected</span></>}
                            {sessionCounts.missed > 0 && <><span>·</span><span>{sessionCounts.missed} missed</span></>}
                            <span>·</span>
                            <span>{new Date(session.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                          </div>
                        </div>
                        <div className={styles.sessionActions}>
                          <button
                            className={styles.chevronBtn}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggleSessionExpanded(sessionCardId)
                            }}
                            title={isExpanded ? 'Collapse claims' : 'Expand claims'}
                          >
                            <Icon name={isExpanded ? 'chevronUp' : 'chevronDown'} size={14} />
                          </button>
                          <button
                            className={styles.deleteBtn}
                            onClick={(event) => {
                              event.stopPropagation()
                              onDeleteSession(sessionCardId)
                            }}
                            title="Delete document training"
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </div>
                      </div>
                      {isExpanded && claims.length > 0 && (
                        <div className={styles.claimDetailList}>
                          {claims.map((claim, claimIndex) => {
                            const claimType = normalizeClaimType(claim?.type)
                            return (
                              <div key={`${sessionCardId}-claim-${claimIndex}`} className={styles.claimDetailRow}>
                                <span className={styles.claimTypeBadge} data-type={claimType}>{claimType}</span>
                                <div className={styles.claimDetailBody}>
                                  <div className={styles.claimDetailText} title={claim?.text || ''}>
                                    {claim?.text || ''}
                                  </div>
                                  {claim?.reference?.name && (
                                    <div className={styles.claimDetailRef} title={claim.reference.name}>
                                      {claim.reference.name}
                                    </div>
                                  )}
                                  {claim?.annotation && (
                                    <div className={styles.claimDetailAnnotation} title={claim.annotation}>
                                      {claim.annotation}
                                    </div>
                                  )}
                                </div>
                                {onDeleteClaim && (
                                  <button
                                    className={styles.claimDeleteBtn}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      onDeleteClaim(sessionCardId, claimIndex)
                                    }}
                                    title="Delete claim"
                                  >
                                    <Icon name="trash" size={12} />
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {hasActiveBrand && sessions.length > 0 && (
          <div className={styles.footer}>
            <Button variant="ghost" size="small" onClick={onClearAll}>
              <Icon name="refreshCw" size={14} />
              Clear Brand Data
            </Button>
            <Button variant="secondary" size="small" onClick={onExport}>
              <Icon name="fileText" size={14} />
              Export JSONL
            </Button>
          </div>
        )}
      </div>
    </>
  )
}
