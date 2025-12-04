import { useState } from 'react'
import styles from './ModelComparison.module.css'
import Tabs from '@/components/molecules/Tabs/Tabs'
import StatCard from '@/components/molecules/StatCard/StatCard'
import Button from '@/components/atoms/Button/Button'
import Icon from '@/components/atoms/Icon/Icon'
import Badge from '@/components/atoms/Badge/Badge'
import Spinner from '@/components/atoms/Spinner/Spinner'

const MODELS = [
  { id: 'gemini-3', name: 'Gemini 3', icon: 'zap' },
  { id: 'claude-opus', name: 'Claude Opus 4.5', icon: 'cpu' },
  { id: 'gpt-4o', name: 'GPT-4o', icon: 'brain' }
]

export default function ModelComparison({
  results = {},
  isRunning = false,
  onRunAllModels,
  onSelectModel
}) {
  const [activeTab, setActiveTab] = useState(0)

  const tabs = MODELS.map(model => ({
    label: model.name,
    content: (
      <ModelResultsPanel
        model={model}
        results={results[model.id]}
        isRunning={isRunning}
        onSelect={() => onSelectModel?.(model.id)}
      />
    )
  }))

  const hasResults = Object.keys(results).length > 0

  return (
    <div className={styles.modelComparison}>
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <Icon name="settings" size={20} />
          <h3 className={styles.title}>Model Comparison (Demo Mode)</h3>
          <Badge variant="warning">Internal Only</Badge>
        </div>
        <Button
          variant="primary"
          size="small"
          onClick={onRunAllModels}
          disabled={isRunning}
        >
          {isRunning ? (
            <>
              <Spinner size="small" />
              Running...
            </>
          ) : (
            <>
              <Icon name="play" size={16} />
              Run All Models
            </>
          )}
        </Button>
      </div>

      <Tabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
        variant="boxed"
      />

      {hasResults && (
        <div className={styles.comparisonGrid}>
          <h4 className={styles.sectionTitle}>Side-by-Side Comparison</h4>
          <div className={styles.gridContainer}>
            {MODELS.map(model => (
              <div key={model.id} className={styles.modelColumn}>
                <div className={styles.columnHeader}>
                  <span className={styles.modelName}>{model.name}</span>
                  {results[model.id] && (
                    <Badge variant="neutral">
                      {results[model.id].claims?.length || 0} claims
                    </Badge>
                  )}
                </div>
                <div className={styles.claimsList}>
                  {results[model.id]?.claims?.slice(0, 5).map((claim, idx) => (
                    <div key={idx} className={styles.claimItem}>
                      <span className={styles.claimIcon}>
                        {claim.matched ? '✓' : claim.missed ? '✗' : '⚠'}
                      </span>
                      <span className={styles.claimText}>
                        {claim.text.substring(0, 50)}...
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className={styles.legend}>
            <span><span className={styles.legendIcon}>✓</span> Found (matches human)</span>
            <span><span className={styles.legendIcon}>✗</span> Missed</span>
            <span><span className={styles.legendIcon}>⚠</span> Found (human didn't mark)</span>
          </div>
        </div>
      )}
    </div>
  )
}

function ModelResultsPanel({ model, results, isRunning, onSelect }) {
  if (isRunning) {
    return (
      <div className={styles.loadingPanel}>
        <Spinner size="large" />
        <p>Analyzing with {model.name}...</p>
      </div>
    )
  }

  if (!results) {
    return (
      <div className={styles.emptyPanel}>
        <Icon name="inbox" size={48} />
        <p>No results yet. Click "Run All Models" to compare.</p>
      </div>
    )
  }

  return (
    <div className={styles.resultsPanel}>
      <div className={styles.metricsGrid}>
        <StatCard
          label="Claims Found"
          value={results.claims?.length || 0}
          size="small"
        />
        <StatCard
          label="Precision"
          value={`${Math.round((results.metrics?.precision || 0) * 100)}%`}
          trend={results.metrics?.precision >= 0.8 ? 'up' : 'neutral'}
          size="small"
        />
        <StatCard
          label="Recall"
          value={`${Math.round((results.metrics?.recall || 0) * 100)}%`}
          trend={results.metrics?.recall >= 0.7 ? 'up' : 'neutral'}
          size="small"
        />
        <StatCard
          label="F1 Score"
          value={(results.metrics?.f1Score || 0).toFixed(2)}
          trend={results.metrics?.f1Score >= 0.7 ? 'up' : 'down'}
          size="small"
        />
        <StatCard
          label="Time"
          value={`${((results.metrics?.processingTimeMs || 0) / 1000).toFixed(1)}s`}
          size="small"
        />
        <StatCard
          label="Est. Cost"
          value={`$${(results.metrics?.estimatedCost || 0).toFixed(3)}`}
          size="small"
        />
      </div>

      <div className={styles.panelActions}>
        <Button
          variant="secondary"
          size="small"
          onClick={onSelect}
        >
          <Icon name="check" size={16} />
          Use This Model
        </Button>
      </div>
    </div>
  )
}
