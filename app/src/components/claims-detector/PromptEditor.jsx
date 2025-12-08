import { useState, useEffect } from 'react'
import styles from './PromptEditor.module.css'
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import AccordionItem from '@/components/molecules/AccordionItem/AccordionItem'

const DEFAULT_PROMPT = `You are a pharmaceutical claims detector. Analyze the following document and identify all medical/regulatory claims that would require MLR (Medical, Legal, Regulatory) approval.

For each claim found, provide:
1. The exact text of the claim
2. A confidence score (0.0 to 1.0) indicating how certain you are this is a regulatory claim
3. The location in the document (paragraph number)

Return your response as a JSON array of claims.

A claim is any statement that:
- Makes a therapeutic or efficacy assertion
- References clinical trial data or statistics
- Compares to competitors or alternatives
- Makes safety or side effect statements
- References FDA approval or regulatory status

Document text:
{DOCUMENT_TEXT}

Brand guidelines context:
{BRAND_GUIDELINES}`

export default function PromptEditor({
  initialPrompt,
  onSave,
  onReset
}) {
  const [prompt, setPrompt] = useState(initialPrompt || DEFAULT_PROMPT)
  const [savedPrompt, setSavedPrompt] = useState(initialPrompt || DEFAULT_PROMPT)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    setHasChanges(prompt !== savedPrompt)
  }, [prompt, savedPrompt])

  const handleSave = () => {
    setSavedPrompt(prompt)
    onSave?.(prompt)
    setHasChanges(false)
  }

  const handleReset = () => {
    setPrompt(DEFAULT_PROMPT)
    setSavedPrompt(DEFAULT_PROMPT)
    onReset?.()
    setHasChanges(false)
  }

  const handleCancel = () => {
    setPrompt(savedPrompt)
    setHasChanges(false)
  }

  return (
    <div className={styles.promptEditor}>
      <AccordionItem
        title="Master AI Prompt"
        icon="settings"
        defaultOpen={false}
      >
        <div className={styles.content}>
          <div className={styles.header}>
            <span className={styles.hint}>
              Edit the prompt used to analyze documents. Use {'{DOCUMENT_TEXT}'} and {'{BRAND_GUIDELINES}'} as placeholders.
            </span>
            <Button
              variant="ghost"
              size="small"
              onClick={handleReset}
            >
              <Icon name="refreshCw" size={14} />
              Reset Default
            </Button>
          </div>

          <textarea
            className={styles.textarea}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={12}
          />

          <div className={styles.footer}>
            <div className={styles.charCount}>
              {prompt.length} characters
            </div>
            <div className={styles.actions}>
              {hasChanges && (
                <>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={handleCancel}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="small"
                    onClick={handleSave}
                  >
                    Save Changes
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </AccordionItem>
    </div>
  )
}
