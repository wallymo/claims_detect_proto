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
  const [refSearch, setRefSearch] = useState('')

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

  const filteredRefs = [...referenceDocuments]
    .filter(r => !refSearch || r.name?.toLowerCase().includes(refSearch.toLowerCase()))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  return (
    <div className={styles.formContainer}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>Add Annotation</span>
        <span className={styles.headerMeta}>Page {position.page}</span>
      </div>

      <form className={styles.body} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label}>Reference</label>
          <div className={styles.refSearchWrapper}>
            <input
              className={styles.refSearchInput}
              type="text"
              placeholder="Search references..."
              value={refSearch}
              onChange={(e) => setRefSearch(e.target.value)}
            />
            {refSearch && (
              <button
                type="button"
                className={styles.refSearchClear}
                onClick={() => setRefSearch('')}
              >
                x
              </button>
            )}
          </div>
          <div className={styles.refList}>
            {filteredRefs.length === 0 && (
              <div className={styles.refEmpty}>No references found</div>
            )}
            {filteredRefs.map(ref => (
              <button
                key={ref.id}
                type="button"
                className={`${styles.refItem} ${referenceId === String(ref.id) ? styles.refItemSelected : ''}`}
                onClick={() => setReferenceId(referenceId === String(ref.id) ? '' : String(ref.id))}
              >
                <span className={styles.refItemName}>{ref.name}</span>
                {referenceId === String(ref.id) && <span className={styles.refItemCheck}>✓</span>}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="missedClaimText">
            Statement <span className={styles.required}>*</span>
          </label>
          <textarea
            id="missedClaimText"
            className={styles.textarea}
            rows={3}
            placeholder="The statement this reference supports..."
            value={claimText}
            onChange={(e) => setClaimText(e.target.value)}
          />
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
