import { useState } from 'react'
import styles from './MissedClaimForm.module.css'

export default function MissedClaimForm({
  position,
  referenceDocuments = [],
  onSubmit,
  onCancel
}) {
  const [claimText, setClaimText] = useState('')
  const [referenceId, setReferenceId] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!claimText.trim()) return

    const selectedRef = referenceDocuments.find(r => String(r.id) === referenceId)

    onSubmit({
      text: claimText.trim(),
      referenceId: referenceId || null,
      referenceName: selectedRef?.name || null,
      supportingText: null
    })
  }

  return (
    <div className={styles.formContainer}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Report Missed Claim</span>
        <span className={styles.headerMeta}>Page {position.page}</span>
      </div>

      <form className={styles.body} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="missedClaimText">
            Claim text <span className={styles.required}>*</span>
          </label>
          <textarea
            id="missedClaimText"
            className={styles.textarea}
            rows={3}
            placeholder="Type or paste the missed claim..."
            value={claimText}
            onChange={(e) => setClaimText(e.target.value)}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="missedClaimRef">
            Reference
          </label>
          <select
            id="missedClaimRef"
            className={styles.select}
            value={referenceId}
            onChange={(e) => setReferenceId(e.target.value)}
          >
            <option value="">Select reference...</option>
            {referenceDocuments.map(ref => (
              <option key={ref.id} value={ref.id}>{ref.name}</option>
            ))}
          </select>
        </div>

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={styles.submitBtn}
            disabled={!claimText.trim()}
          >
            Submit
          </button>
        </div>
      </form>
    </div>
  )
}
