import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import styles from './ScannerOverlay.module.css'
import AIParticles from './AIParticles'

export default function ScannerOverlay({
  isScanning = false,
  progress: externalProgress, // External progress 0-100 (for real API calls)
  mockDuration = 2500, // Duration for mock mode auto-completion
  statusText = 'Analyzing document...',
  elapsedSeconds = 0,
  onComplete
}) {
  const [scanLineY, setScanLineY] = useState(0)
  const [showComplete, setShowComplete] = useState(false)
  const [mockProgress, setMockProgress] = useState(0)

  // Use external progress if provided, otherwise use internal mock progress
  const progress = externalProgress !== undefined ? externalProgress : mockProgress

  // Mock mode: auto-increment progress when no external progress provided
  useEffect(() => {
    if (!isScanning || externalProgress !== undefined) {
      setMockProgress(0)
      return
    }

    const startTime = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const newProgress = Math.min((elapsed / mockDuration) * 100, 100)
      setMockProgress(newProgress)

      if (newProgress >= 100) {
        clearInterval(interval)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [isScanning, externalProgress, mockDuration])

  // Handle completion (works for both mock and real progress)
  useEffect(() => {
    if (progress >= 100 && isScanning) {
      setShowComplete(true)
      const timeout = setTimeout(() => {
        setShowComplete(false)
        onComplete?.()
      }, 600)
      return () => clearTimeout(timeout)
    }
  }, [progress, isScanning, onComplete])

  useEffect(() => {
    if (!isScanning) {
      setShowComplete(false)
    }
  }, [isScanning])

  if (!isScanning && !showComplete) return null

  return (
    <div className={styles.overlay}>
      {/* Scan line */}
      {!showComplete && (
        <motion.div
          className={styles.scanLine}
          initial={{ top: '0%' }}
          animate={{ top: '100%' }}
          transition={{
            duration: 1.2,
            repeat: Infinity,
            ease: 'linear'
          }}
          onUpdate={(latest) => {
            const topValue = parseFloat(latest.top)
            setScanLineY(topValue)
          }}
        />
      )}

      {/* AI Particles */}
      <AIParticles scanLineY={scanLineY} isActive={isScanning && !showComplete} />

      {/* Status display */}
      <div className={styles.statusContainer}>
        {showComplete ? (
          <span className={styles.checkmark}>✓</span>
        ) : (
          <p className={styles.statusText}>
            {statusText}
            {elapsedSeconds > 0 && <span className={styles.elapsed}> ({elapsedSeconds}s)</span>}
          </p>
        )}
      </div>
    </div>
  )
}
