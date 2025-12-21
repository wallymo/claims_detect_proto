import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import styles from './ScannerOverlay.module.css'
import AIParticles from './AIParticles'

export default function ScannerOverlay({
  isScanning = false,
  progress = 0, // External progress 0-100
  statusText = 'Analyzing document...',
  elapsedSeconds = 0,
  onComplete
}) {
  const [scanLineY, setScanLineY] = useState(0)
  const [showComplete, setShowComplete] = useState(false)

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
