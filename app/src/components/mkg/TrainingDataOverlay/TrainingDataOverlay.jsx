import styles from './TrainingDataOverlay.module.css'
import Icon from '@/components/atoms/Icon/Icon'
import Button from '@/components/atoms/Button/Button'

export default function TrainingDataOverlay({
  isOpen,
  onClose,
  sessions = [],
  onDeleteSession,
  onClearAll,
  onExport,
  hasActiveBrand
}) {
  if (!isOpen) return null

  const totalApproved = sessions.reduce((sum, s) => sum + (s.approved_claims?.length || 0), 0)

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.overlay}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Icon name="flask" size={18} />
            <span className={styles.title}>Training Data</span>
            {sessions.length > 0 && (
              <span className={styles.badge}>{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
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
                Run a document and review claims — approvals are automatically saved as training examples.
              </p>
            </div>
          )}

          {hasActiveBrand && sessions.length > 0 && (
            <>
              <div className={styles.summary}>
                <span>{totalApproved} approved claim{totalApproved !== 1 ? 's' : ''} across {sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
              </div>

              <div className={styles.sessionList}>
                {sessions.map(session => (
                  <div key={session.id} className={styles.sessionCard}>
                    <div className={styles.sessionInfo}>
                      <div className={styles.sessionName} title={session.document_name}>
                        <Icon name="fileText" size={13} />
                        <span>{session.label || session.document_name}</span>
                      </div>
                      <div className={styles.sessionMeta}>
                        <span>{session.approved_claims?.length || 0} approved</span>
                        <span>·</span>
                        <span>{new Date(session.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </div>
                    </div>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => onDeleteSession(session.id)}
                      title="Delete session"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {hasActiveBrand && sessions.length > 0 && (
          <div className={styles.footer}>
            <Button variant="ghost" size="small" onClick={onClearAll}>
              <Icon name="refreshCw" size={14} />
              Clear All Active
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
